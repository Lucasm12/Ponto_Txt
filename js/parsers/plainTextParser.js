/**
 * plainTextParser.js — parser de último recurso (fallback).
 *
 * Sempre "detecta" com uma confiança baixa e fixa, garantindo que algum
 * parser sempre consiga processar o arquivo, mesmo que nenhum formato
 * estruturado tenha sido reconhecido pelos demais parsers. Ainda assim,
 * tenta extrair algumas estatísticas úteis do texto (contagem de palavras,
 * linha mais longa, palavras mais frequentes) para não entregar um
 * relatório vazio.
 */
(function (global) {
  "use strict";

  const STOPWORDS = new Set([
    "de", "da", "do", "das", "dos", "e", "a", "o", "as", "os", "em", "um", "uma",
    "para", "com", "não", "que", "por", "se", "na", "no", "nas", "nos", "ao", "aos",
    "the", "and", "or", "of", "to", "in", "is", "it",
  ]);

  function detect() {
    return 0.05; // menor prioridade possível — só vence quando nada mais reconhece o arquivo
  }

  function topWords(content, limit = 10) {
    const freq = new Map();
    const words = content.toLowerCase().match(/[a-zà-ú0-9]{3,}/g) || [];
    for (const w of words) {
      if (STOPWORDS.has(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
    return Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit);
  }

  function parse(content) {
    const lines = content.split(/\r\n|\n|\r/);
    const nonEmpty = lines.filter((l) => l.trim().length > 0);
    const words = content.match(/\S+/g) || [];
    const longest = lines.reduce((acc, l) => (l.length > acc.length ? l : acc), "");
    const words10 = topWords(content, 10);

    const numbered = lines.map((l, i) => `${String(i + 1).padStart(5, " ")}  ${l}`).join("\n");

    const charts = [];
    if (words10.length) {
      charts.push({
        id: "chartTopWords", title: "Palavras mais frequentes", type: "bar", horizontal: true,
        labels: words10.map((w) => w[0]), datasets: [{ label: "Ocorrências", data: words10.map((w) => w[1]) }],
      });
    }

    return {
      format: "Texto simples",
      formatDescription: "Não foi possível identificar uma estrutura tabular — exibindo como texto corrido, com estatísticas básicas.",
      confidence: detect(),
      stats: [
        { label: "Linhas totais", value: Utils.formatNumber(lines.length), icon: "bi-list-ol", color: "primary" },
        { label: "Linhas com conteúdo", value: Utils.formatNumber(nonEmpty.length), icon: "bi-card-text", color: "info" },
        { label: "Palavras", value: Utils.formatNumber(words.length), icon: "bi-alphabet", color: "success" },
        { label: "Caracteres", value: Utils.formatNumber(content.length), icon: "bi-fonts", color: "warning" },
        { label: "Linha mais longa", value: Utils.formatNumber(longest.length) + " car.", icon: "bi-text-left", color: "secondary" },
      ],
      charts,
      sections: [
        { id: "raw", title: "Conteúdo do arquivo", icon: "bi-file-earmark-text", type: "text", content: numbered },
      ],
    };
  }

  global.ParserRegistry.register({ name: "plaintext", label: "Texto simples", detect, parse });
})(window);
