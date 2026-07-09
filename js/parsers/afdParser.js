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
 *       3   = Marcação de ponto: data, hora e PIS do trabalhador (sem nome)
 *       5   = Cadastro/alteração de funcionário: data, hora, PIS e nome —
 *             não é uma batida de ponto, só a fonte do nome de cada PIS
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

  /**
   * Campos fixos após DATA+HORA, conforme layout da Portaria 671:
   *   Tipo 3 (marcação):            PIS(12) + CRC(4)
   *   Tipo 5 (cadastro/alteração):  TIPO_ALTERACAO(1) + PIS(12) + NOME(52) + campos finais(19, ignorados)
   * O PIS tem largura fixa de 12 dígitos — usar regex "gulosa" de tamanho
   * variável aqui faz o parser engolir dígitos do CRC (hexadecimal, tipo 3)
   * para dentro do PIS sempre que o CRC começa com 0-9, corrompendo o
   * identificador do trabalhador.
   * O NOME também é largura fixa (52 chars, preenchido com espaços à
   * direita) — confirmado batendo o padding de várias linhas reais do AFD.
   * Pegar "o resto da linha" faz o parser incluir os campos finais (que vêm
   * colados após o padding) dentro do nome exibido.
   */
  function extractPis3(after) {
    const pis = after.slice(0, 12);
    return /^\d{12}$/.test(pis) ? pis : null;
  }

  function extractIdName5(after) {
    const pis = after.slice(1, 13);
    if (!/^\d{12}$/.test(pis)) return { workerId: null, name: null };
    const name = after.slice(13, 13 + 52).trim() || null;
    return { workerId: pis, name };
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

    const punches = [];   // { workerId, data (Date), hora } — apenas marcações reais (tipo 3)
    const employeeNames = new Map(); // workerId (PIS) -> nome, alimentado pelos cadastros (tipo 5)
    let companyName = null;
    let companyDoc = null;

    for (const line of lines) {
      if (!/^\d{9}\d/.test(line)) continue;
      const type = line.slice(9, 10);
      const rest = line.slice(10);

      if (type === "3") {
        const dt = extractDateTime(rest);
        if (!dt || !dt.time) continue;
        const workerId = extractPis3(rest.slice(dt.index + dt.length));
        if (!workerId) continue;
        punches.push({ workerId, data: dt.date, hora: dt.time });
        continue;
      }

      if (type === "5") {
        // Cadastro/alteração de funcionário — não é uma batida de ponto,
        // então não entra em `punches`; só fornece o nome associado ao PIS.
        const dt = extractDateTime(rest);
        if (!dt) continue;
        const { workerId, name } = extractIdName5(rest.slice(dt.index + dt.length));
        if (workerId && name) employeeNames.set(workerId, name);
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

    // ---------------- Funcionários (nome vem dos registros de cadastro, tipo 5) ----------------
    // PIS com marcações (tipo 3) mas sem nenhum cadastro correspondente (comum em
    // arquivos parciais) são ignorados: sem nome, não há como o usuário
    // reconhecer o funcionário na lista.
    const workersWithPunches = new Set(punches.map((p) => p.workerId));
    const employees = Array.from(employeeNames.entries())
      .filter(([workerId]) => workersWithPunches.has(workerId))
      .map(([workerId, nome]) => ({ id: workerId, nome }))
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
