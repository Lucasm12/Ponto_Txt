/**
 * genericParsers.js — parsers de propósito geral, usados quando o arquivo
 * TXT não corresponde a um formato específico já conhecido (como o AFD).
 *
 * Registra três parsers independentes:
 *   - json:       arquivo é um JSON (objeto/array) ou JSON-lines
 *   - delimited:  arquivo tabular com delimitador (CSV, TSV, ";", "|")
 *   - keyvalue:   arquivo com pares "chave: valor" (um registro ou vários
 *                 blocos separados por linha em branco)
 */
(function (global) {
  "use strict";

  function nonEmptyLines(content) {
    return content.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);
  }

  // ============================================================
  // 1) JSON / JSON-lines
  // ============================================================
  function jsonDetect(content) {
    const trimmed = content.trim();
    if (!trimmed) return 0;
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try { JSON.parse(trimmed); return 0.97; } catch (_) { /* não é JSON válido de documento único */ }
    }
    // JSON-lines: cada linha é um objeto JSON independente.
    const lines = nonEmptyLines(content).slice(0, 50);
    if (!lines.length) return 0;
    let ok = 0;
    for (const l of lines) {
      try { const v = JSON.parse(l); if (v && typeof v === "object") ok++; } catch (_) { /* ignora */ }
    }
    return ok / lines.length > 0.9 ? 0.9 : 0;
  }

  function flattenObject(obj, prefix = "") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flattenObject(v, key));
      else out[key] = Array.isArray(v) ? v.join(", ") : v;
    }
    return out;
  }

  function jsonParse(content) {
    const trimmed = content.trim();
    let records = [];
    let mode = "documento único";
    try {
      const data = JSON.parse(trimmed);
      records = Array.isArray(data) ? data : [data];
    } catch (_) {
      mode = "JSON-lines";
      records = nonEmptyLines(content).map((l) => { try { return JSON.parse(l); } catch (_) { return { valor: l }; } });
    }

    const flatRows = records.map((r) => (r && typeof r === "object" ? flattenObject(r) : { valor: r }));
    const columnSet = new Set();
    flatRows.forEach((r) => Object.keys(r).forEach((k) => columnSet.add(k)));
    const columns = Array.from(columnSet).map((key) => ({
      key, label: key, numeric: flatRows.every((r) => r[key] == null || r[key] === "" || !isNaN(Number(r[key]))),
    }));

    return buildTabularDocument({
      format: "JSON", formatDescription: `Arquivo JSON (${mode}) com ${records.length} registro(s)`,
      confidence: jsonDetect(content), columns, rows: flatRows, sectionTitle: "Registros do JSON", icon: "bi-braces",
    });
  }

  // ============================================================
  // 2) Delimitado (CSV / TSV / ; / |)
  // ============================================================
  const CANDIDATE_DELIMITERS = [",", ";", "\t", "|"];

  function splitLine(line, delim) {
    // Split simples respeitando aspas duplas (suficiente para a maioria dos CSVs reais).
    const out = [];
    let cur = "", inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQuotes = !inQuotes; continue; }
      if (c === delim && !inQuotes) { out.push(cur); cur = ""; continue; }
      cur += c;
    }
    out.push(cur);
    return out;
  }

  function pickDelimiter(lines) {
    let best = null, bestScore = 0, bestCols = 0;
    for (const delim of CANDIDATE_DELIMITERS) {
      const counts = lines.map((l) => splitLine(l, delim).length);
      if (Math.max(...counts) <= 1) continue;
      const freq = {};
      counts.forEach((c) => (freq[c] = (freq[c] || 0) + 1));
      const mode = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
      const consistency = mode[1] / counts.length;
      const cols = Number(mode[0]);
      if (cols > 1 && consistency > bestScore) { bestScore = consistency; best = delim; bestCols = cols; }
    }
    return best ? { delim: best, consistency: bestScore, cols: bestCols } : null;
  }

  function delimitedDetect(content) {
    const lines = nonEmptyLines(content).slice(0, 300);
    if (lines.length < 2) return 0;
    const picked = pickDelimiter(lines);
    if (!picked || picked.consistency < 0.75) return 0;
    return Math.min(0.85, picked.consistency);
  }

  function guessIsHeaderRow(firstRowValues, sampleRows) {
    // Cabeçalho tende a ser texto não-numérico e diferente do padrão das demais linhas.
    const nonNumericRatio = firstRowValues.filter((v) => v.trim() !== "" && isNaN(Number(v.trim()))).length / firstRowValues.length;
    return nonNumericRatio >= 0.6;
  }

  function delimitedParse(content) {
    const lines = nonEmptyLines(content);
    const picked = pickDelimiter(lines) || { delim: ",", cols: splitLine(lines[0], ",").length };
    const split = lines.map((l) => splitLine(l, picked.delim).map((v) => v.trim()));

    const hasHeader = guessIsHeaderRow(split[0], split.slice(1, 20));
    const headerNames = hasHeader ? split[0] : split[0].map((_, i) => `Coluna ${i + 1}`);
    const dataRows = hasHeader ? split.slice(1) : split;

    const columns = headerNames.map((name, i) => ({
      key: `c${i}`, label: name || `Coluna ${i + 1}`,
      numeric: dataRows.every((r) => !r[i] || r[i] === "" || !isNaN(Number(r[i].replace(",", ".")))),
    }));

    const rows = dataRows.map((r) => {
      const obj = {};
      columns.forEach((c, i) => { obj[c.key] = r[i] != null ? r[i] : ""; });
      return obj;
    });

    const delimName = { ",": "vírgula", ";": "ponto e vírgula", "\t": "tabulação (TSV)", "|": "barra vertical" }[picked.delim];

    return buildTabularDocument({
      format: "Delimitado", formatDescription: `Arquivo tabular delimitado por "${delimName}" — ${hasHeader ? "com" : "sem"} cabeçalho detectado`,
      confidence: delimitedDetect(content), columns, rows, sectionTitle: "Dados importados", icon: "bi-table",
    });
  }

  // ============================================================
  // 3) Chave: Valor (um registro ou múltiplos blocos)
  // ============================================================
  const KV_LINE_RE = /^\s*([^\s:=][^:=]{0,60}?)\s*[:=]\s*(.+?)\s*$/;

  function keyValueDetect(content) {
    const lines = nonEmptyLines(content).slice(0, 300);
    if (lines.length < 2) return 0;
    const matches = lines.filter((l) => KV_LINE_RE.test(l)).length;
    const ratio = matches / lines.length;
    return ratio >= 0.7 ? Math.min(0.8, ratio) : 0;
  }

  function keyValueParse(content, fileName) {
    // Blocos separados por linha em branco viram "registros" de uma tabela.
    const rawBlocks = content.split(/\r?\n\s*\r?\n/).map((b) => nonEmptyLines(b)).filter((b) => b.length);
    const parsedBlocks = rawBlocks.map((blockLines) => {
      const obj = {};
      for (const line of blockLines) {
        const m = line.match(KV_LINE_RE);
        if (m) obj[m[1].trim()] = m[2].trim();
      }
      return obj;
    }).filter((o) => Object.keys(o).length);

    const multiRecord = parsedBlocks.length > 1;

    if (multiRecord) {
      const columnSet = new Set();
      parsedBlocks.forEach((b) => Object.keys(b).forEach((k) => columnSet.add(k)));
      const columns = Array.from(columnSet).map((key) => ({
        key, label: key, numeric: parsedBlocks.every((r) => r[key] == null || r[key] === "" || !isNaN(Number(String(r[key]).replace(",", ".")))),
      }));
      return buildTabularDocument({
        format: "Chave-Valor (múltiplos registros)",
        formatDescription: `${parsedBlocks.length} registro(s) no formato "chave: valor", separados por linhas em branco`,
        confidence: keyValueDetect(content), columns, rows: parsedBlocks, sectionTitle: "Registros", icon: "bi-list-columns-reversed",
      });
    }

    // Registro único → mostra como tabela de 2 colunas (Campo / Valor).
    const single = parsedBlocks[0] || {};
    const rows = Object.entries(single).map(([k, v]) => ({ campo: k, valor: v }));
    const stats = [
      { label: "Campos identificados", value: Utils.formatNumber(rows.length), icon: "bi-card-list", color: "primary" },
    ];
    return {
      format: "Chave-Valor", formatDescription: "Arquivo no formato \"chave: valor\"", confidence: keyValueDetect(content),
      stats, charts: [],
      sections: [{
        id: "kv", title: "Campos identificados", icon: "bi-list-columns-reversed", type: "table",
        columns: [{ key: "campo", label: "Campo" }, { key: "valor", label: "Valor" }], rows,
      }],
    };
  }

  // ============================================================
  // Utilitário compartilhado: monta um ParsedDocument para dados tabulares
  // (delimitado / JSON / chave-valor multi-registro) incluindo estatísticas
  // numéricas automáticas e um gráfico simples quando fizer sentido.
  // ============================================================
  function buildTabularDocument({ format, formatDescription, confidence, columns, rows, sectionTitle, icon }) {
    const numericCols = columns.filter((c) => c.numeric);
    const stats = [
      { label: "Linhas de dados", value: Utils.formatNumber(rows.length), icon: "bi-list-ol", color: "primary" },
      { label: "Colunas", value: Utils.formatNumber(columns.length), icon: "bi-layout-three-columns", color: "info" },
      { label: "Colunas numéricas", value: Utils.formatNumber(numericCols.length), icon: "bi-123", color: "success" },
    ];

    const charts = [];
    // Se existir uma coluna categórica de baixa cardinalidade, gera um gráfico de distribuição.
    const catCol = columns.find((c) => !c.numeric && new Set(rows.map((r) => r[c.key])).size > 1 && new Set(rows.map((r) => r[c.key])).size <= 15);
    if (catCol) {
      const groups = Utils.groupBy(rows, (r) => r[catCol.key] ?? "(vazio)");
      charts.push({
        id: "chartCategoria", title: `Distribuição por "${catCol.label}"`, type: "doughnut",
        labels: Array.from(groups.keys()), datasets: [{ label: "Quantidade", data: Array.from(groups.values()).map((g) => g.length) }],
      });
    }
    if (numericCols[0]) {
      const nc = numericCols[0];
      charts.push({
        id: "chartNumerico", title: `Valores de "${nc.label}" (primeiras 30 linhas)`, type: "bar",
        labels: rows.slice(0, 30).map((_, i) => `#${i + 1}`),
        datasets: [{ label: nc.label, data: rows.slice(0, 30).map((r) => Number(r[nc.key]) || 0) }],
      });
    }

    return {
      format, formatDescription, confidence, stats, charts,
      sections: [{ id: "main", title: sectionTitle, icon, type: "table", columns, rows, numericStats: numericCols.length > 0 }],
    };
  }

  global.ParserRegistry.register({ name: "json", label: "JSON", detect: jsonDetect, parse: jsonParse });
  global.ParserRegistry.register({ name: "delimited", label: "Tabular delimitado", detect: delimitedDetect, parse: delimitedParse });
  global.ParserRegistry.register({ name: "keyvalue", label: "Chave-Valor", detect: keyValueDetect, parse: keyValueParse });
})(window);
