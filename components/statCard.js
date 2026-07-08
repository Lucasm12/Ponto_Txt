/**
 * statCard.js — componente visual de indicador (KPI) usado no topo do relatório.
 */
(function (global) {
  "use strict";

  /** @returns {string} HTML do card. */
  function renderStatCard({ label, value, icon, color = "primary" }) {
    return `
      <div class="col-6 col-md-4 col-xl-2">
        <div class="ti-card stat-card h-100">
          <div class="stat-icon bg-${color}-subtle text-${color}">
            <i class="bi ${icon || "bi-graph-up"}"></i>
          </div>
          <div class="min-w-0">
            <div class="stat-value text-truncate" title="${Utils.escapeHtml(String(value))}">${Utils.escapeHtml(String(value))}</div>
            <div class="stat-label text-truncate">${Utils.escapeHtml(label)}</div>
          </div>
        </div>
      </div>`;
  }

  function renderStatRow(stats) {
    if (!stats || !stats.length) return "";
    return `<div class="row g-3 mb-4">${stats.map(renderStatCard).join("")}</div>`;
  }

  global.StatCard = { renderStatCard, renderStatRow };
})(window);
