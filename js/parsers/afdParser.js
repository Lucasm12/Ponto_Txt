/**
 * afdParser.js — parser especializado para o "AFD" (Arquivo Fonte de Dados),
 * o formato usado por Relógios/Registradores Eletrônicos de Ponto (REP)
 * brasileiros para exportar as marcações de ponto dos trabalhadores.
 *
 * Estrutura geral (identificada a partir do próprio conteúdo do arquivo):
 *   - Cada linha começa com um NSR (Número Sequencial de Registro) de 9 dígitos,
 *     seguido de 1 dígito que identifica o TIPO do registro.
 *   - A última linha (tipo 9, com NSR "999999999") é o rodapé/trailer com totais.
 *   - Tipos observados neste arquivo:
 *       1 = Cabeçalho do arquivo (dados do empregador/REP)
 *       2 = Identificação de empresa/estabelecimento (quando o REP é usado por
 *           mais de um estabelecimento/empregador ao longo do tempo)
 *       3 = Marcação de ponto em formato compacto (REP antigo/REP-P): data,
 *           hora e identificador do trabalhador, sem nome
 *       4 = Ajuste de data/hora do relógio do equipamento
 *       5 = Marcação de ponto em formato completo (REP-C): data, hora, tipo
 *           de evento, identificador e nome do trabalhador
 *       6 = Alteração de dados (variações do cadastro/marcações)
 *       9 = Rodapé com totais do arquivo
 *
 * Como os campos internos de cada tipo podem variar de fabricante para
 * fabricante, a extração é feita por reconhecimento de padrões (datas,
 * horas, blocos numéricos e blocos de texto), e não por posições de byte
 * fixas "às cegas" — isso torna o parser resiliente a pequenas variações,
 * e qualquer trecho que não seja reconhecido cai automaticamente na seção
 * de texto bruto, sem quebrar o relatório.
 */
(function (global) {
  "use strict";

  const TYPE_LABELS = {
    "1": "Cabeçalho do arquivo",
    "2": "Identificação de empresa",
    "3": "Marcação de ponto (compacta)",
    "4": "Ajuste de relógio",
    "5": "Marcação de ponto (completa)",
    "6": "Alteração de registro",
    "9": "Rodapé (totais)",
  };

  const EVENT_LEGEND = {
    I: "Registro original (inclusão)",
    A: "Registro ajustado/alterado",
    E: "Registro excluído",
  };

  // ------------------------------------------------------------------
  // Detecção
  // ------------------------------------------------------------------
  function getLines(content) {
    return content.split(/\r\n|\n|\r/).filter((l) => l.length > 0);
  }

  function detect(content) {
    const lines = getLines(content);
    if (lines.length < 3) return 0;

    const sampleSize = Math.min(lines.length, 800);
    let matches = 0;
    for (let i = 0; i < sampleSize; i++) {
      if (/^\d{9}[1-9]/.test(lines[i])) matches++;
    }
    const ratio = matches / sampleSize;

    const lastLine = lines[lines.length - 1];
    const hasTrailer = /^999999999/.test(lastLine.trim());

    let score = ratio; // 0..1
    if (hasTrailer) score = Math.min(1, score + 0.15);
    // Exige uma taxa de acerto bem alta para não "roubar" arquivos genéricos
    // que por coincidência tenham prefixos numéricos.
    return ratio >= 0.85 ? score : 0;
  }

  // ------------------------------------------------------------------
  // Extração de tokens (heurística, aplicada linha a linha)
  // ------------------------------------------------------------------

  /**
   * Extrai data(8)+hora(4) do INÍCIO da string (campo fixo logo após NSR+tipo,
   * conforme o layout do AFD). Propositalmente NÃO varre o restante da linha:
   * em arquivos reais, buscar o padrão em qualquer posição faz o parser
   * "achar" datas falsas dentro de blocos numéricos como PIS/CPF e o
   * preenchimento após o nome, corrompendo o intervalo de datas e o
   * alinhamento da extração de identificador/nome que vem em seguida.
   */
  function extractDateTime(str) {
    const m = /^(\d{8})(\d{4})/.exec(str);
    if (!m) return null;
    const date = Utils.parseDDMMYYYY(m[1]);
    if (!date) return null;
    const time = Utils.parseHHMM(m[2]);
    return { date, dateStr: m[1], time, index: 0, length: 12 };
  }

  /** A partir do restante da linha (após data/hora), tenta achar evento+id+nome. */
  function extractEventIdName(rest) {
    // Ex.: "I013160471194ALEX V N TEOTONIO                  0000010022543886252"
    const m = rest.match(/^([A-Z])?(\d{9,14})([\s\S]*)$/);
    if (!m) return { eventChar: null, workerId: null, name: null, tail: rest.trim() };

    const eventChar = m[1] || null;
    const workerId = m[2];
    let tailRaw = m[3] || "";

    // Nome = trecho de texto em maiúsculas antes de 2+ espaços seguidos (padding fixo).
    const nameMatch = tailRaw.match(/^\s*([A-ZÀ-Ü0-9.'&\-\/ ]{3,80}?)\s{2,}([\s\S]*)$/);
    let name = null, tail = tailRaw.trim();
    if (nameMatch) {
      name = nameMatch[1].trim();
      tail = nameMatch[2].trim();
    }
    return { eventChar, workerId, name, tail };
  }

  /** Extrai blocos de texto "tipo nome/endereço" (maiúsculas) de uma string. */
  function extractTextBlocks(str) {
    const blocks = [];
    const re = /[A-ZÀ-Ü&][A-ZÀ-Ü0-9°º&.,'\-\/ ]{5,}/g;
    let m;
    while ((m = re.exec(str)) !== null) {
      const clean = m[0].replace(/\s{2,}/g, " ").trim();
      if (clean.length >= 5) blocks.push(clean);
    }
    return blocks;
  }

  function parseLine(line, lineNumber) {
    const nsr = line.slice(0, 9);
    const type = line.slice(9, 10);
    const rest = line.slice(10);
    return { lineNumber, nsr, type, rest, raw: line };
  }

  // ------------------------------------------------------------------
  // Parse principal
  // ------------------------------------------------------------------
  function parse(content, fileName) {
    const rawLines = content.split(/\r\n|\n|\r/);
    const lines = rawLines.filter((l) => l.length > 0);

    const punches = [];       // tipos 3 e 5 (marcações de ponto)
    const companies = [];     // tipos 1 e 2
    const clockAdjusts = [];  // tipo 4
    const otherRecords = [];  // tipo 6
    const unparsed = [];      // linhas que não bateram com o padrão esperado
    const typeCounts = {};    // contagem por tipo (1..9)
    let trailerRaw = null;

    let ln = 0;
    for (const line of lines) {
      ln++;
      if (!/^\d{9}\d/.test(line)) {
        unparsed.push({ lineNumber: ln, raw: line, reason: "Linha fora do padrão NSR+Tipo" });
        continue;
      }
      const rec = parseLine(line, ln);
      typeCounts[rec.type] = (typeCounts[rec.type] || 0) + 1;

      if (rec.nsr === "999999999" || rec.type === "9") {
        trailerRaw = rec.raw;
        continue;
      }

      if (rec.type === "3" || rec.type === "5") {
        const dt = extractDateTime(rec.rest);
        if (!dt) { unparsed.push({ lineNumber: ln, raw: line, reason: "Data/hora não reconhecida" }); continue; }
        const afterDt = rec.rest.slice(dt.index + dt.length);
        const { eventChar, workerId, name } = extractEventIdName(afterDt);
        punches.push({
          lineNumber: ln,
          nsr: rec.nsr,
          formato: rec.type === "5" ? "Completa (REP-C)" : "Compacta (REP-P)",
          data: dt.date,
          dataStr: Utils.formatDateShort(dt.date),
          hora: dt.time || "-",
          evento: eventChar || "-",
          eventoDescricao: eventChar ? (EVENT_LEGEND[eventChar] || eventChar) : "-",
          trabalhadorId: workerId || "-",
          trabalhadorNome: name || "(não informado)",
          raw: line,
        });
        continue;
      }

      if (rec.type === "1" || rec.type === "2") {
        const dt = extractDateTime(rec.rest);
        const searchArea = dt ? rec.rest.slice(dt.index + dt.length) : rec.rest;
        const blocks = extractTextBlocks(searchArea.length > 5 ? searchArea : rec.rest);
        const docMatch = rec.rest.match(/\d{11,14}/);
        companies.push({
          lineNumber: ln,
          nsr: rec.nsr,
          tipo: rec.type === "1" ? "Cabeçalho" : "Identificação de empresa",
          data: dt ? dt.date : null,
          dataStr: dt ? Utils.formatDateShort(dt.date) : "-",
          hora: dt ? dt.time || "-" : "-",
          documento: docMatch ? docMatch[0] : "-",
          nome: blocks[0] || "(não identificado)",
          endereco: blocks[1] || "-",
          raw: line,
        });
        continue;
      }

      if (rec.type === "4") {
        // Duas datas/horas adjacentes no início do registro: nova e anterior
        // (campos fixos — não variam de posição, então não variamos a busca).
        const found = [];
        const novo = extractDateTime(rec.rest);
        if (novo) {
          found.push({ date: novo.date, time: novo.time });
          const anterior = extractDateTime(rec.rest.slice(novo.index + novo.length));
          if (anterior) found.push({ date: anterior.date, time: anterior.time });
        }
        if (found.length === 0) { unparsed.push({ lineNumber: ln, raw: line, reason: "Ajuste sem datas reconhecíveis" }); continue; }
        clockAdjusts.push({
          lineNumber: ln,
          nsr: rec.nsr,
          dataNova: Utils.formatDateShort(found[0].date),
          horaNova: found[0].time || "-",
          dataAnterior: found[1] ? Utils.formatDateShort(found[1].date) : "-",
          horaAnterior: found[1] ? found[1].time || "-" : "-",
          raw: line,
        });
        continue;
      }

      if (rec.type === "6") {
        const dt = extractDateTime(rec.rest);
        if (dt) {
          const afterDt = rec.rest.slice(dt.index + dt.length);
          const { eventChar, workerId, name } = extractEventIdName(afterDt);
          otherRecords.push({
            lineNumber: ln, nsr: rec.nsr,
            data: Utils.formatDateShort(dt.date), hora: dt.time || "-",
            evento: eventChar || "-", trabalhadorId: workerId || "-",
            trabalhadorNome: name || "(não informado)", raw: line,
          });
        } else {
          otherRecords.push({ lineNumber: ln, nsr: rec.nsr, data: "-", hora: "-", evento: "-", trabalhadorId: "-", trabalhadorNome: "-", raw: line });
        }
        continue;
      }

      // Tipo reconhecido mas sem regra específica — guarda em "outros".
      otherRecords.push({ lineNumber: ln, nsr: rec.nsr, data: "-", hora: "-", evento: "-", trabalhadorId: "-", trabalhadorNome: `(tipo ${rec.type})`, raw: line });
    }

    // ---------------- Agregações ----------------
    const workerMap = new Map();
    for (const p of punches) {
      if (p.trabalhadorId === "-") continue;
      if (!workerMap.has(p.trabalhadorId)) {
        workerMap.set(p.trabalhadorId, { id: p.trabalhadorId, nome: p.trabalhadorNome, marcacoes: 0, primeira: p.data, ultima: p.data });
      }
      const w = workerMap.get(p.trabalhadorId);
      w.marcacoes++;
      if (p.trabalhadorNome && p.trabalhadorNome !== "(não informado)") w.nome = p.trabalhadorNome;
      if (p.data && (!w.primeira || p.data < w.primeira)) w.primeira = p.data;
      if (p.data && (!w.ultima || p.data > w.ultima)) w.ultima = p.data;
    }
    const workers = Array.from(workerMap.values()).map((w) => ({
      ...w, primeiraStr: w.primeira ? Utils.formatDateShort(w.primeira) : "-", ultimaStr: w.ultima ? Utils.formatDateShort(w.ultima) : "-",
    })).sort((a, b) => b.marcacoes - a.marcacoes);

    const validDates = punches.map((p) => p.data).filter(Boolean).sort((a, b) => a - b);
    const dateRange = validDates.length ? { min: validDates[0], max: validDates[validDates.length - 1] } : null;

    const perDayMap = Utils.groupBy(punches.filter((p) => p.data), (p) => p.dataStr);
    const perDay = Array.from(perDayMap.entries())
      .map(([data, arr]) => ({ data, qtd: arr.length, _sortKey: arr[0].data }))
      .sort((a, b) => a._sortKey - b._sortKey);

    const eventMap = Utils.groupBy(punches.filter((p) => p.evento !== "-"), (p) => p.evento);
    const eventDist = Array.from(eventMap.entries()).map(([ev, arr]) => ({ evento: ev, qtd: arr.length }));

    const typeDistLabels = Object.keys(typeCounts).sort();
    const typeDist = typeDistLabels.map((t) => ({ tipo: `Tipo ${t} — ${TYPE_LABELS[t] || "desconhecido"}`, qtd: typeCounts[t] }));

    // ---------------- Seções do relatório ----------------
    const sections = [];

    if (companies.length) {
      sections.push({
        id: "companies", title: "Empresas / Estabelecimentos identificados", icon: "bi-building",
        type: "table",
        columns: [
          { key: "nsr", label: "NSR" }, { key: "tipo", label: "Tipo" },
          { key: "dataStr", label: "Data" }, { key: "hora", label: "Hora" },
          { key: "documento", label: "CNPJ/CPF/CEI" }, { key: "nome", label: "Nome / Razão Social" },
          { key: "endereco", label: "Endereço" },
        ],
        rows: companies,
      });
    }

    sections.push({
      id: "workers", title: "Trabalhadores identificados", icon: "bi-people-fill",
      type: "table",
      columns: [
        { key: "id", label: "PIS/CPF/Matrícula" }, { key: "nome", label: "Nome" },
        { key: "marcacoes", label: "Qtd. Marcações", numeric: true },
        { key: "primeiraStr", label: "Primeira marcação" }, { key: "ultimaStr", label: "Última marcação" },
      ],
      rows: workers,
      numericStats: true,
    });

    sections.push({
      id: "punches", title: "Marcações de ponto", icon: "bi-fingerprint",
      type: "table",
      columns: [
        { key: "nsr", label: "NSR" }, { key: "formato", label: "Formato" },
        { key: "dataStr", label: "Data" }, { key: "hora", label: "Hora" },
        { key: "evento", label: "Evento" }, { key: "trabalhadorId", label: "Identificador" },
        { key: "trabalhadorNome", label: "Trabalhador" },
      ],
      rows: punches,
    });

    if (clockAdjusts.length) {
      sections.push({
        id: "adjusts", title: "Ajustes de relógio do equipamento", icon: "bi-clock-history",
        type: "table",
        columns: [
          { key: "nsr", label: "NSR" }, { key: "dataNova", label: "Nova data" }, { key: "horaNova", label: "Nova hora" },
          { key: "dataAnterior", label: "Data anterior" }, { key: "horaAnterior", label: "Hora anterior" },
        ],
        rows: clockAdjusts,
      });
    }

    if (otherRecords.length) {
      sections.push({
        id: "others", title: "Outros registros (tipo 6 / não classificados)", icon: "bi-list-check",
        type: "table",
        columns: [
          { key: "nsr", label: "NSR" }, { key: "data", label: "Data" }, { key: "hora", label: "Hora" },
          { key: "evento", label: "Evento" }, { key: "trabalhadorId", label: "Identificador" }, { key: "trabalhadorNome", label: "Descrição" },
        ],
        rows: otherRecords,
      });
    }

    if (unparsed.length) {
      const preview = unparsed.slice(0, 500).map((u) => `L${u.lineNumber}: ${u.raw}  [${u.reason}]`).join("\n");
      sections.push({
        id: "raw", title: `Linhas não estruturadas (${unparsed.length})`, icon: "bi-file-earmark-text",
        type: "text",
        content: preview + (unparsed.length > 500 ? `\n\n... e mais ${unparsed.length - 500} linha(s).` : ""),
      });
    }

    if (trailerRaw) {
      sections.push({
        id: "trailer", title: "Rodapé do arquivo (registro tipo 9)", icon: "bi-flag-fill",
        type: "text",
        content: trailerRaw + "\n\n(Os totais acima são exibidos como no arquivo original; os indicadores deste relatório são recalculados a partir da leitura completa do arquivo, para conferência.)",
      });
    }

    // ---------------- Estatísticas (KPIs) ----------------
    const stats = [
      { label: "Total de linhas", value: Utils.formatNumber(lines.length), icon: "bi-list-ol", color: "primary" },
      { label: "Marcações de ponto", value: Utils.formatNumber(punches.length), icon: "bi-fingerprint", color: "success" },
      { label: "Trabalhadores distintos", value: Utils.formatNumber(workers.length), icon: "bi-people-fill", color: "info" },
      { label: "Estabelecimentos", value: Utils.formatNumber(companies.length), icon: "bi-building", color: "warning" },
      { label: "Ajustes de relógio", value: Utils.formatNumber(clockAdjusts.length), icon: "bi-clock-history", color: "danger" },
      {
        label: "Período coberto",
        value: dateRange ? `${Utils.formatDateShort(dateRange.min)} — ${Utils.formatDateShort(dateRange.max)}` : "-",
        icon: "bi-calendar-range", color: "secondary",
      },
    ];

    // ---------------- Gráficos ----------------
    const charts = [
      {
        id: "chartTypeDist", title: "Distribuição por tipo de registro", type: "doughnut",
        labels: typeDist.map((t) => t.tipo), datasets: [{ label: "Quantidade", data: typeDist.map((t) => t.qtd) }],
      },
      {
        id: "chartPerDay", title: "Marcações por dia", type: "bar",
        labels: perDay.map((d) => d.data), datasets: [{ label: "Marcações", data: perDay.map((d) => d.qtd) }],
      },
      {
        id: "chartTopWorkers", title: "Top 10 trabalhadores por marcações", type: "bar", horizontal: true,
        labels: workers.slice(0, 10).map((w) => w.nome), datasets: [{ label: "Marcações", data: workers.slice(0, 10).map((w) => w.marcacoes) }],
      },
    ];
    if (eventDist.length) {
      charts.push({
        id: "chartEvents", title: "Distribuição por código de evento", type: "pie",
        labels: eventDist.map((e) => `${e.evento} (${EVENT_LEGEND[e.evento] || "?"})`),
        datasets: [{ label: "Quantidade", data: eventDist.map((e) => e.qtd) }],
      });
    }

    return {
      format: "AFD",
      formatDescription: "Arquivo Fonte de Dados (REP) — registro eletrônico de ponto",
      confidence: detect(content),
      stats,
      charts,
      sections,
    };
  }

  global.ParserRegistry.register({
    name: "afd-rep",
    label: "AFD — Registro Eletrônico de Ponto",
    detect,
    parse,
  });
})(window);
