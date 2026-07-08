/**
 * reportRenderer.js — recebe um ParsedDocument (produzido por qualquer
 * parser registrado) + metadados do arquivo, e monta o dashboard completo
 * dentro do container informado.
 */
(function (global) {
  "use strict";

  function renderHero(fileMeta, doc) {
    return `
      <div class="report-hero mb-4 d-print-none">
        <div class="d-flex flex-wrap justify-content-between align-items-start gap-3 position-relative">
          <div>
            <div class="d-flex align-items-center gap-2 mb-2">
              <i class="bi bi-file-earmark-check-fill fs-3"></i>
              <h1 class="h4 mb-0 fw-bold text-truncate" style="max-width:60vw;" title="${Utils.escapeHtml(fileMeta.fileName)}">${Utils.escapeHtml(fileMeta.fileName)}</h1>
            </div>
            <div class="d-flex flex-wrap gap-2">
              <span class="meta-pill"><i class="bi bi-diagram-3-fill"></i>${Utils.escapeHtml(doc.format)}</span>
              <span class="meta-pill"><i class="bi bi-calendar-check"></i>${Utils.formatDateTime(fileMeta.importedAt)}</span>
              <span class="meta-pill"><i class="bi bi-hdd"></i>${Utils.formatBytes(fileMeta.fileSize)}</span>
              <span class="meta-pill"><i class="bi bi-list-ol"></i>${Utils.formatNumber(fileMeta.lineCount)} linhas</span>
              <span class="meta-pill"><i class="bi bi-shield-check"></i>confiança ${Math.round((doc.confidence || 0) * 100)}%</span>
            </div>
            <p class="mb-0 mt-2 opacity-90 small">${Utils.escapeHtml(doc.formatDescription || "")}</p>
          </div>
          <div class="d-flex gap-2 flex-wrap">
            <button class="btn btn-light btn-sm" id="btnPrintReport"><i class="bi bi-printer me-1"></i>Imprimir / PDF</button>
          </div>
        </div>
      </div>`;
  }

  function renderChartsRow(charts) {
    if (!charts || !charts.length) return "";
    const cols = charts.map((c) => `
      <div class="col-12 col-lg-6">
        <div class="ti-card chart-card p-3 h-100">
          <h6 class="fw-700 mb-2"><i class="bi bi-bar-chart-fill text-primary me-1"></i>${Utils.escapeHtml(c.title)}</h6>
          <div style="height:280px;"><canvas id="${c.id}"></canvas></div>
        </div>
      </div>`).join("");
    return `<div class="row g-3 mb-4 d-print-none">${cols}</div>`;
  }

  function renderRawTextSection(body, content) {
    const lines = content.split("\n");
    const html = lines.map((l, i) => `<span class="ln">${i + 1}</span>${Utils.escapeHtml(l)}`).join("\n");
    body.innerHTML = `<div class="raw-text-box">${html}</div>`;
  }

  /**
   * @param {HTMLElement} container
   * @param {object} doc ParsedDocument retornado por um parser
   * @param {{fileName,fileSize,lineCount,importedAt}} fileMeta
   */
  function render(container, doc, fileMeta) {
    ChartsManager.destroyAll();
    container.innerHTML = "";

    if (doc.truncated) {
      container.insertAdjacentHTML("beforeend", `
        <div class="alert alert-warning d-flex align-items-center gap-2 d-print-none">
          <i class="bi bi-exclamation-triangle-fill fs-5"></i>
          <div>Este relatório foi reaberto do histórico em <b>modo resumido</b> (arquivo muito grande para guardar por completo no navegador). Reimporte o arquivo original para ver todos os registros.</div>
        </div>`);
    }

    container.insertAdjacentHTML("beforeend", renderHero(fileMeta, doc));
    container.insertAdjacentHTML("beforeend", StatCard.renderStatRow(doc.stats));
    container.insertAdjacentHTML("beforeend", renderChartsRow(doc.charts));

    const sectionsWrap = document.createElement("div");
    container.appendChild(sectionsWrap);

    (doc.sections || []).forEach((section) => {
      const { body, toolbar } = SectionCard.mountSectionCard(sectionsWrap, {
        id: `sec-${section.id}`, title: section.title, icon: section.icon,
        badge: section.type === "table" ? `${Utils.formatNumber(section.rows.length)} registro(s)` : null,
      });

      if (section.type === "table") {
        const table = TableComponent.mount(body, {
          columns: section.columns, rows: section.rows, numericStats: section.numericStats,
        });
        ExportManager.attachTableToolbar(toolbar, section, table);
      } else if (section.type === "text") {
        renderRawTextSection(body, section.content || "");
        ExportManager.attachTextToolbar(toolbar, section);
      }
    });

    // Gráficos são criados depois que os canvases já estão no DOM.
    (doc.charts || []).forEach((c) => ChartsManager.render(c.id, c));

    document.getElementById("btnPrintReport")?.addEventListener("click", () => ExportManager.printReport());
  }

  global.ReportRenderer = { render };
})(window);
