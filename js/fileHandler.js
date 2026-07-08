/**
 * fileHandler.js — captura o arquivo (via clique ou drag-and-drop), valida
 * a extensão, lê o conteúdo com barra de progresso e entrega o texto para
 * o callback informado em init().
 */
(function (global) {
  "use strict";

  function isTxtFile(file) {
    if (!file) return false;
    const nameOk = /\.txt$/i.test(file.name);
    const typeOk = !file.type || file.type === "text/plain";
    return nameOk && typeOk || nameOk; // extensão manda; tipo é só reforço
  }

  /**
   * @param {{onFile: function(File, string content)}} handlers
   */
  function init(handlers) {
    const dropZone = document.getElementById("dropZone");
    const fileInput = document.getElementById("fileInput");
    const btnBrowse = document.getElementById("btnBrowse");

    const openPicker = () => fileInput.click();
    btnBrowse.addEventListener("click", openPicker);
    dropZone.addEventListener("click", (e) => { if (e.target === dropZone || dropZone.contains(e.target)) openPicker(); });

    fileInput.addEventListener("change", () => {
      if (fileInput.files[0]) processFile(fileInput.files[0], handlers);
      fileInput.value = ""; // permite reimportar o mesmo arquivo em seguida
    });

    ["dragenter", "dragover"].forEach((evt) =>
      dropZone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); dropZone.classList.add("dragover"); })
    );
    ["dragleave", "drop"].forEach((evt) =>
      dropZone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); dropZone.classList.remove("dragover"); })
    );
    dropZone.addEventListener("drop", (e) => {
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) processFile(file, handlers);
    });
  }

  async function processFile(file, handlers) {
    if (!isTxtFile(file)) {
      Swal.fire({
        icon: "error", title: "Formato não suportado",
        text: `"${file.name}" não parece ser um arquivo .txt. Selecione um arquivo de texto.`,
      });
      return;
    }
    if (file.size === 0) {
      Swal.fire({ icon: "warning", title: "Arquivo vazio", text: "O arquivo selecionado não contém dados." });
      return;
    }

    showLoading("Lendo arquivo...", 0);
    try {
      const content = await Utils.readFileAsText(file, (pct) => {
        if (pct != null) updateLoadingProgress(pct, `Lendo arquivo... ${pct}%`);
      });
      updateLoadingProgress(100, "Analisando estrutura do arquivo...");
      // pequeno respiro para o navegador pintar a UI antes do processamento pesado
      await new Promise((r) => setTimeout(r, 60));
      handlers.onFile(file, content);
    } catch (err) {
      console.error(err);
      hideLoading();
      Swal.fire({ icon: "error", title: "Falha ao ler o arquivo", text: String(err.message || err) });
    }
  }

  function showLoading(text, pct) {
    document.getElementById("loadingOverlay").classList.remove("d-none");
    document.getElementById("topProgress").classList.remove("d-none");
    updateLoadingProgress(pct, text);
  }
  function updateLoadingProgress(pct, text) {
    if (text) document.getElementById("loadingText").textContent = text;
    document.getElementById("loadingProgressBar").style.width = `${pct}%`;
  }
  function hideLoading() {
    document.getElementById("loadingOverlay").classList.add("d-none");
    document.getElementById("topProgress").classList.add("d-none");
  }

  global.FileHandler = { init, showLoading, updateLoadingProgress, hideLoading };
})(window);
