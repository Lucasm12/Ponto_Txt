/**
 * utils.js — funções auxiliares genéricas usadas em toda a aplicação.
 * Exposto globalmente em window.Utils para manter os scripts simples (sem bundler).
 */
(function (global) {
  "use strict";

  /** Formata bytes em KB/MB/GB legível. */
  function formatBytes(bytes) {
    if (bytes === 0 || bytes == null) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const value = bytes / Math.pow(1024, i);
    return `${value.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
  }

  /** Formata um Date (ou timestamp) para "dd/mm/aaaa hh:mm:ss" (pt-BR). */
  function formatDateTime(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return "-";
    return d.toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  }

  function formatDateShort(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("pt-BR");
  }

  /** Formata número com separador de milhar pt-BR. */
  function formatNumber(n, decimals = 0) {
    if (n == null || isNaN(n)) return "-";
    return Number(n).toLocaleString("pt-BR", {
      minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    });
  }

  function formatPercent(n, decimals = 1) {
    if (n == null || isNaN(n)) return "-";
    return `${Number(n).toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}%`;
  }

  /** Escapa HTML para evitar XSS ao injetar texto de dados do usuário. */
  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /** Debounce clássico. */
  function debounce(fn, wait = 250) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  /** Gera um id curto o suficiente para uso em chaves de histórico/DOM. */
  function uid(prefix = "id") {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /** Dispara o download de um Blob com o nome de arquivo informado. */
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /** Lê um File como texto, reportando progresso (0-100) via callback. */
  function readFileAsText(file, onProgress) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onprogress = (e) => {
        if (onProgress) {
          const pct = e.lengthComputable ? Math.round((e.loaded / e.total) * 100) : null;
          onProgress(pct);
        }
      };
      reader.onerror = () => reject(reader.error || new Error("Falha ao ler o arquivo."));
      reader.onload = () => {
        if (onProgress) onProgress(100);
        resolve(String(reader.result));
      };
      // Tenta UTF-8; a maioria dos arquivos de sistemas legados brasileiros
      // também funciona bem porque os campos relevantes são numéricos/ASCII.
      reader.readAsText(file, "UTF-8");
    });
  }

  function clamp(n, min, max) {
    return Math.min(Math.max(n, min), max);
  }

  function sum(arr) {
    return arr.reduce((a, b) => a + (Number(b) || 0), 0);
  }

  function average(arr) {
    return arr.length ? sum(arr) / arr.length : 0;
  }

  /** Agrupa um array de objetos por uma função de chave, retornando um Map. */
  function groupBy(arr, keyFn) {
    const map = new Map();
    for (const item of arr) {
      const key = keyFn(item);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return map;
  }

  /** Valida se dia/mês/ano formam uma data real e plausível (1970-2099). */
  function isPlausibleDate(day, month, year) {
    day = Number(day); month = Number(month); year = Number(year);
    if (year < 1970 || year > 2099) return false;
    if (month < 1 || month > 12) return false;
    const daysInMonth = new Date(year, month, 0).getDate();
    if (day < 1 || day > daysInMonth) return false;
    return true;
  }

  /** Converte "DDMMAAAA" em objeto Date (meia-noite local). Retorna null se inválido. */
  function parseDDMMYYYY(str) {
    if (!str || str.length !== 8) return null;
    const day = str.slice(0, 2), month = str.slice(2, 4), year = str.slice(4, 8);
    if (!isPlausibleDate(day, month, year)) return null;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  /** Converte "HHMM" em "HH:MM" com validação básica. */
  function parseHHMM(str) {
    if (!str || str.length < 4) return null;
    const h = Number(str.slice(0, 2)), m = Number(str.slice(2, 4));
    if (h > 23 || m > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  /** Constrói uma string CSV a partir de colunas + linhas (com escaping correto). */
  function toCSV(columns, rows, delimiter = ";") {
    const escapeField = (v) => {
      if (v == null) v = "";
      v = String(v);
      if (v.includes(delimiter) || v.includes('"') || v.includes("\n")) {
        v = `"${v.replace(/"/g, '""')}"`;
      }
      return v;
    };
    const header = columns.map((c) => escapeField(c.label)).join(delimiter);
    const lines = rows.map((row) => columns.map((c) => escapeField(row[c.key])).join(delimiter));
    return [header, ...lines].join("\r\n");
  }

  global.Utils = {
    formatBytes, formatDateTime, formatDateShort, formatNumber, formatPercent,
    escapeHtml, debounce, uid, downloadBlob, readFileAsText, clamp,
    sum, average, groupBy, isPlausibleDate, parseDDMMYYYY, parseHHMM, toCSV,
  };
})(window);
