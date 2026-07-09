/**
 * app.js — ponto de entrada da aplicação. Conecta os módulos: leitura de
 * arquivo, seleção de parser, renderização do relatório e navegação entre
 * a tela de importação e a de relatório.
 */
(function () {
  "use strict";

  const importView = document.getElementById("importView");
  const reportView = document.getElementById("reportView");
  const reportContainer = document.getElementById("reportContainer");
  const btnNewFile = document.getElementById("btnNewFile");
  const brandHome = document.getElementById("brandHome");

  function showImportView() {
    reportView.classList.add("d-none");
    importView.classList.remove("d-none");
    btnNewFile?.classList.add("d-none");
    document.title = "Leitor Inteligente de TXT · Dashboard de Relatórios";
  }

  function showReportView() {
    importView.classList.add("d-none");
    reportView.classList.remove("d-none");
    btnNewFile?.classList.remove("d-none");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** Processa o conteúdo textual de um arquivo recém-importado: detecta o parser, gera o documento e exibe. */
  function handleNewFile(file, content) {
    let picked;
    try {
      picked = ParserRegistry.detectBestParser(content, file.name);
    } catch (e) {
      FileHandler.hideLoading();
      Swal.fire({ icon: "error", title: "Erro ao identificar o formato", text: String(e.message || e) });
      return;
    }

    if (!picked.parser) {
      FileHandler.hideLoading();
      Swal.fire({ icon: "error", title: "Nenhum leitor disponível", text: "Não foi possível processar este arquivo." });
      return;
    }

    let doc;
    try {
      doc = picked.parser.parse(content, file.name);
    } catch (e) {
      console.error(e);
      FileHandler.hideLoading();
      Swal.fire({
        icon: "error", title: "Erro ao processar o arquivo",
        html: `O leitor <b>${Utils.escapeHtml(picked.parser.label)}</b> encontrou um problema:<br><code>${Utils.escapeHtml(String(e.message || e))}</code>`,
      });
      return;
    }

    const lineCount = content.split(/\r\n|\n|\r/).filter((l) => l.length > 0).length;
    const fileMeta = { fileName: file.name, fileSize: file.size, lineCount, importedAt: Date.now() };

    try {
      ReportRenderer.render(reportContainer, doc, fileMeta, showImportView);
    } catch (e) {
      console.error(e);
      FileHandler.hideLoading();
      Swal.fire({ icon: "error", title: "Erro ao montar o relatório", text: String(e.message || e) });
      return;
    }

    FileHandler.hideLoading();
    showReportView();
    Swal.fire({
      toast: true, position: "top-end", icon: "success",
      title: `Relatório gerado (${doc.format})`, showConfirmButton: false, timer: 2400, timerProgressBar: true,
    });
  }

  function init() {
    FileHandler.init({ onFile: handleNewFile });

    btnNewFile?.addEventListener("click", showImportView);
    brandHome?.addEventListener("click", (e) => { e.preventDefault(); showImportView(); });

    showImportView();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
