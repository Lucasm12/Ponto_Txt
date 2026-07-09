/**
 * storage.js — persistência local do histórico de importações (LocalStorage).
 *
 * Cada item guarda o documento já processado (ParsedDocument) para permitir
 * reabrir o relatório sem reimportar o arquivo. Para arquivos muito grandes,
 * o item é salvo em modo "resumido" (apenas estatísticas/gráficos + amostra
 * de linhas de cada tabela) para não estourar a cota do LocalStorage — nesse
 * caso o relatório reaberto avisa que os dados estão parciais.
 */
(function (global) {
  "use strict";

  const STORAGE_KEY = "txtinsight_history_v1";
  const MAX_ITEMS = 25;
  const MAX_FULL_SIZE = 3_000_000; // ~3MB de JSON por item antes de resumir
  const SAMPLE_ROWS = 300;

  function readRaw() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.warn("Histórico corrompido, reiniciando.", e);
      return [];
    }
  }

  function writeRaw(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  function getAll() {
    return readRaw().sort((a, b) => b.importedAt - a.importedAt);
  }

  function get(id) {
    return readRaw().find((i) => i.id === id) || null;
  }

  const MAX_ATTENDANCE_PUNCHES = 50000;

  /** Reduz um documento grande a uma versão amostrada, mantendo stats/gráficos completos. */
  function summarizeDocument(doc) {
    const clone = JSON.parse(JSON.stringify(doc));
    clone.truncated = true;
    clone.sections = (clone.sections || []).map((s) => {
      if (s.type === "table" && Array.isArray(s.rows) && s.rows.length > SAMPLE_ROWS) {
        return { ...s, rows: s.rows.slice(0, SAMPLE_ROWS), rowsTruncatedFrom: s.rows.length };
      }
      if (s.type === "text" && typeof s.content === "string" && s.content.length > 20000) {
        return { ...s, content: s.content.slice(0, 20000) + "\n\n... (conteúdo truncado no histórico)" };
      }
      return s;
    });
    if (clone.attendance && Array.isArray(clone.attendance.punches) && clone.attendance.punches.length > MAX_ATTENDANCE_PUNCHES) {
      clone.attendance.punches = clone.attendance.punches.slice(0, MAX_ATTENDANCE_PUNCHES);
    }
    return clone;
  }

  /**
   * Adiciona uma entrada ao histórico.
   * @param {{fileName:string,fileSize:number,lineCount:number,parserName:string,document:object}} entry
   * @returns {string} id gerado
   */
  function add(entry) {
    const list = readRaw();
    const id = Utils.uid("hist");
    let document = entry.document;
    let serialized = JSON.stringify(document);
    let truncated = false;

    if (serialized.length > MAX_FULL_SIZE) {
      document = summarizeDocument(document);
      truncated = true;
      serialized = JSON.stringify(document);
    }

    const item = {
      id,
      fileName: entry.fileName,
      fileSize: entry.fileSize,
      lineCount: entry.lineCount,
      parserName: entry.parserName,
      importedAt: Date.now(),
      truncated,
      document,
    };

    list.unshift(item);
    while (list.length > MAX_ITEMS) list.pop();

    try {
      writeRaw(list);
    } catch (e) {
      // Cota excedida mesmo após resumir — remove os itens mais antigos e tenta de novo.
      console.warn("LocalStorage cheio, removendo itens antigos.", e);
      while (list.length > 3) {
        list.pop();
        try { writeRaw(list); break; } catch (_) { /* tenta remover mais */ }
      }
    }
    return id;
  }

  function remove(id) {
    const list = readRaw().filter((i) => i.id !== id);
    writeRaw(list);
  }

  function clear() {
    localStorage.removeItem(STORAGE_KEY);
  }

  global.HistoryStore = { getAll, get, add, remove, clear };
})(window);
