/**
 * afdParser.js — parser especializado para o "AFD" (Arquivo Fonte de Dados),
 * o formato usado por Relógios/Registradores Eletrônicos de Ponto (REP)
 * brasileiros para exportar as marcações de ponto dos trabalhadores.
 *
 * Estrutura geral (identificada a partir do próprio conteúdo do arquivo):
 *   - Cada linha começa com um NSR (Número Sequencial de Registro) de 9 dígitos,
 *     seguido de 1 dígito que identifica o TIPO do registro.
 *   - A última linha (tipo 9, com NSR "999999999") é o rodapé/trailer.
 *   - Tipos relevantes para este relatório:
 *       1/2 = Cabeçalho do arquivo / identificação de empresa (usado só para
 *             exibir o nome da empresa no relatório)
 *       3/5 = Marcação de ponto (compacta/completa): data, hora e
 *             identificador (e nome, quando presente) do trabalhador
 *   Demais tipos (4, 6, 9) não são necessários para este relatório e são
 *   ignorados na leitura.
 *
 * Este parser não gera um dashboard genérico de tabelas/gráficos — em vez
 * disso, expõe `attendance` (funcionários, meses disponíveis e as marcações
 * já limpas) para que o AttendanceView monte, sob demanda, um "Espelho de
 * Ponto" mensal por funcionário, no estilo dos relatórios de ponto comuns.
 */
(function (global) {
  "use strict";

  const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

  function monthKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
  function monthLabel(date) { return `${MESES[date.getMonth()]}/${date.getFullYear()}`; }

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
   * preenchimento após o nome, corrompendo os dados extraídos.
   */
  function extractDateTime(str) {
    const m = /^(\d{8})(\d{4})/.exec(str);
    if (!m) return null;
    const date = Utils.parseDDMMYYYY(m[1]);
    if (!date) return null;
    const time = Utils.parseHHMM(m[2]);
    return { date, time, index: 0, length: 12 };
  }

  /** A partir do restante da linha (após data/hora), tenta achar identificador+nome do trabalhador. */
  function extractIdName(rest) {
    // Ex.: "I013160471194ALEX V N TEOTONIO                  0000010022543886252"
    const m = rest.match(/^([A-Z])?(\d{9,14})([\s\S]*)$/);
    if (!m) return { workerId: null, name: null };

    const workerId = m[2];
    const tailRaw = m[3] || "";
    const nameMatch = tailRaw.match(/^\s*([A-ZÀ-Ü0-9.'&\-\/ ]{3,80}?)\s{2,}/);
    return { workerId, name: nameMatch ? nameMatch[1].trim() : null };
  }

  /**
   * Extrai o nome da empresa de uma string de campos com padding fixo.
   * Divide por 2+ espaços (o separador entre campos de largura fixa no AFD)
   * e usa o primeiro trecho que pareça um nome — evita "colar" o nome com o
   * endereço, que normalmente vem no campo seguinte.
   */
  function extractCompanyName(str) {
    const parts = str.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      const m = part.match(/[A-ZÀ-Ü&][A-ZÀ-Ü0-9°º&.,'\-\/ ]{4,}/);
      if (m) return m[0].trim();
    }
    return null;
  }

  function formatCnpjCpf(digits) {
    if (digits.length === 14) return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
    if (digits.length === 11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    return digits;
  }

  // ------------------------------------------------------------------
  // Parse principal
  // ------------------------------------------------------------------
  function parse(content, fileName) {
    const rawLines = content.split(/\r\n|\n|\r/);
    const lines = rawLines.filter((l) => l.length > 0);

    const punches = [];   // { workerId, nome, data (Date), hora }
    let companyName = null;
    let companyDoc = null;

    for (const line of lines) {
      if (!/^\d{9}\d/.test(line)) continue;
      const type = line.slice(9, 10);
      const rest = line.slice(10);

      if (type === "3" || type === "5") {
        const dt = extractDateTime(rest);
        if (!dt) continue;
        const { workerId, name } = extractIdName(rest.slice(dt.index + dt.length));
        if (!workerId || !dt.time) continue;
        punches.push({ workerId, nome: name, data: dt.date, hora: dt.time });
        continue;
      }

      if ((type === "1" || type === "2") && !companyName) {
        const dt = extractDateTime(rest);
        const searchArea = dt ? rest.slice(dt.index + dt.length) : rest;
        const found = extractCompanyName(searchArea.length > 5 ? searchArea : rest);
        if (found) companyName = found;
        const docMatch = searchArea.match(/\d{11,14}/);
        if (docMatch) companyDoc = formatCnpjCpf(docMatch[0]);
      }
    }

    // ---------------- Funcionários (nome mais recente por identificador) ----------------
    const employeeMap = new Map();
    for (const p of punches) {
      if (!employeeMap.has(p.workerId)) employeeMap.set(p.workerId, { id: p.workerId, nome: p.nome || null });
      if (p.nome) employeeMap.get(p.workerId).nome = p.nome;
    }
    // Identificadores sem nenhum nome identificado em nenhuma marcação (comuns em
    // registros compactos/REP-P) são ignorados: sem nome, não há como o usuário
    // reconhecer o funcionário na lista.
    const employees = Array.from(employeeMap.values())
      .filter((e) => e.nome)
      .map((e) => ({ id: e.id, nome: e.nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

    // ---------------- Meses disponíveis ----------------
    const monthsMap = new Map();
    for (const p of punches) {
      const key = monthKey(p.data);
      if (!monthsMap.has(key)) monthsMap.set(key, monthLabel(p.data));
    }
    const months = Array.from(monthsMap.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.key.localeCompare(b.key));

    return {
      format: "AFD",
      formatDescription: "Arquivo Fonte de Dados (REP) — registro eletrônico de ponto",
      confidence: detect(content),
      stats: [],
      charts: [],
      sections: [],
      attendance: {
        companyName: companyName || "-",
        companyDoc: companyDoc || null,
        employees,
        months,
        // Datas serializadas em ISO para sobreviver ao histórico (LocalStorage).
        punches: punches.map((p) => ({ workerId: p.workerId, dataISO: p.data.toISOString(), hora: p.hora })),
      },
    };
  }

  global.ParserRegistry.register({
    name: "afd-rep",
    label: "AFD — Registro Eletrônico de Ponto",
    detect,
    parse,
  });
})(window);
