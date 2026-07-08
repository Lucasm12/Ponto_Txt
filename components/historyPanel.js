/**
 * historyPanel.js — lista de importações anteriores (offcanvas lateral e
 * lista rápida na tela inicial), lendo/gravando via HistoryStore.
 */
(function (global) {
  "use strict";

  function itemHtml(item) {
    return `
      <div class="history-item" data-id="${item.id}">
        <div class="d-flex justify-content-between align-items-start gap-2">
          <div class="min-w-0">
            <div class="fname text-truncate" title="${Utils.escapeHtml(item.fileName)}">
              <i class="bi bi-file-earmark-text me-1"></i>${Utils.escapeHtml(item.fileName)}
            </div>
            <div class="fmeta">
              ${Utils.formatDateTime(item.importedAt)} &middot; ${Utils.formatBytes(item.fileSize)} &middot;
              ${Utils.formatNumber(item.lineCount)} linhas
              ${item.truncated ? '<span class="badge text-bg-warning ms-1">amostra parcial</span>' : ""}
            </div>
          </div>
          <div class="d-flex gap-1 flex-shrink-0">
            <button class="btn btn-sm btn-outline-primary btn-open" title="Abrir relatório"><i class="bi bi-box-arrow-up-right"></i></button>
            <button class="btn btn-sm btn-outline-danger btn-remove" title="Remover"><i class="bi bi-trash3"></i></button>
          </div>
        </div>
      </div>`;
  }

  /**
   * Renderiza a lista completa (offcanvas) e a lista curta (tela inicial).
   * @param {{onOpen:function(item), onChange?:function}} handlers
   */
  function render(handlers) {
    const all = HistoryStore.getAll();

    // Lista completa (offcanvas)
    const fullList = document.getElementById("historyList");
    if (fullList) {
      fullList.innerHTML = all.length
        ? all.map(itemHtml).join("")
        : `<div class="text-center text-secondary py-5"><i class="bi bi-inbox fs-1 d-block mb-2"></i>Nenhuma importação registrada ainda.</div>`;
      wireButtons(fullList, all, handlers);
    }

    // Lista curta (tela inicial) — até 5 itens
    const recentList = document.getElementById("recentHistoryList");
    const emptyMsg = document.getElementById("recentHistoryEmpty");
    if (recentList) {
      const recent = all.slice(0, 5);
      recentList.querySelectorAll(".history-item").forEach((n) => n.remove());
      if (recent.length) {
        if (emptyMsg) emptyMsg.classList.add("d-none");
        recentList.insertAdjacentHTML("beforeend", recent.map(itemHtml).join(""));
        wireButtons(recentList, recent, handlers);
      } else if (emptyMsg) {
        emptyMsg.classList.remove("d-none");
      }
    }
  }

  function wireButtons(container, items, handlers) {
    container.querySelectorAll(".history-item").forEach((node) => {
      const id = node.dataset.id;
      const item = items.find((i) => i.id === id);
      node.querySelector(".btn-open").addEventListener("click", () => handlers.onOpen(item));
      node.querySelector(".fname").addEventListener("click", () => handlers.onOpen(item));
      node.querySelector(".btn-remove").addEventListener("click", (e) => {
        e.stopPropagation();
        Swal.fire({
          title: "Remover do histórico?", text: item.fileName, icon: "warning",
          showCancelButton: true, confirmButtonText: "Remover", cancelButtonText: "Cancelar",
          confirmButtonColor: "#dc3545",
        }).then((res) => {
          if (res.isConfirmed) {
            HistoryStore.remove(id);
            render(handlers);
            if (handlers.onChange) handlers.onChange();
          }
        });
      });
    });
  }

  function initClearButton(handlers) {
    const btn = document.getElementById("btnClearHistory");
    if (!btn) return;
    btn.addEventListener("click", () => {
      Swal.fire({
        title: "Limpar todo o histórico?", text: "Essa ação não pode ser desfeita.", icon: "warning",
        showCancelButton: true, confirmButtonText: "Limpar tudo", cancelButtonText: "Cancelar",
        confirmButtonColor: "#dc3545",
      }).then((res) => {
        if (res.isConfirmed) {
          HistoryStore.clear();
          render(handlers);
          Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Histórico limpo", showConfirmButton: false, timer: 1800 });
        }
      });
    });
  }

  global.HistoryPanel = { render, initClearButton };
})(window);
