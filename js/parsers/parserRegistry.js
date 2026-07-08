/**
 * parserRegistry.js — coração da arquitetura plugável de leitura de TXT.
 *
 * Cada "parser" é um objeto independente com a assinatura:
 *   {
 *     name: string,                                   // identificador único
 *     label: string,                                   // nome amigável exibido no relatório
 *     detect(content, fileName): number,                // retorna confiança 0..1
 *     parse(content, fileName): ParsedDocument           // retorna o documento estruturado
 *   }
 *
 * Para adicionar suporte a um novo tipo de arquivo TXT no futuro, basta criar
 * um novo arquivo em /js/parsers/, implementar essa interface e registrá-lo
 * com ParserRegistry.register(meuParser) — NENHUM outro arquivo da aplicação
 * precisa ser alterado.
 *
 * Formato do ParsedDocument retornado por parse():
 *   {
 *     format: string,                // rótulo curto do formato detectado
 *     formatDescription: string,     // frase explicativa
 *     confidence: number,            // 0..1
 *     stats: [{ label, value, icon, color }],
 *     charts: [{ id, title, type, labels:[], datasets:[{label,data:[]}] }],
 *     sections: [
 *       { id, title, icon, type:'table', columns:[{key,label,numeric?}], rows:[...], numericStats?:boolean },
 *       { id, title, icon, type:'text', content:string }
 *     ]
 *   }
 */
(function (global) {
  "use strict";

  const parsers = [];

  function register(parser) {
    if (!parser || typeof parser.detect !== "function" || typeof parser.parse !== "function") {
      throw new Error("Parser inválido: precisa implementar detect() e parse().");
    }
    parsers.push(parser);
  }

  /** Executa detect() de todos os parsers registrados e retorna o de maior confiança. */
  function detectBestParser(content, fileName) {
    let best = null;
    let bestScore = -1;
    for (const parser of parsers) {
      let score = 0;
      try {
        score = parser.detect(content, fileName) || 0;
      } catch (e) {
        console.warn(`[ParserRegistry] Falha ao detectar com "${parser.name}":`, e);
      }
      if (score > bestScore) {
        bestScore = score;
        best = parser;
      }
    }
    return { parser: best, score: bestScore };
  }

  function getAll() {
    return parsers.slice();
  }

  global.ParserRegistry = { register, detectBestParser, getAll };
})(window);
