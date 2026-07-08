/**
 * tableComponent.js — tabela genérica e reutilizável com busca, ordenação
 * por coluna, paginação e (opcionalmente) um resumo estatístico automático
 * das colunas numéricas (soma, média, mínimo, máximo).
 *
 * Uso:
 *   const table = TableComponent.mount(containerEl, { columns, rows, numericStats: true });
 *   table.getVisibleRows() // linhas atualmente filtradas/ordenadas (para exportação)
 */
(function (global) {
  "use strict";

  function computeColumnStats(columns, rows) {
    const numericCols = columns.filter((c) => c.numeric);
    return numericCols.map((c) => {
      const values = rows.map((r) => Number(r[c.key])).filter((v) => !isNaN(v));
      if (!values.length) return null;
      const total = Utils.sum(values);
      const avg = Utils.average(values);
      return {
        label: c.label, total, avg,
        min: Math.min(...values), max: Math.max(...values), count: values.length,
      };
    }).filter(Boolean);
  }

  function mount(container, options) {
    const state = {
      columns: options.columns || [],
      rows: options.rows || [],
      pageSize: options.pageSize || 15,
      page: 1,
      search: "",
      sortKey: null,
      sortDir: 1,
      numericStats: !!options.numericStats,
    };

    const root = document.createElement("div");
    root.innerHTML = `
      <div class="col-stats-row"></div>
      <div class="ti-table-toolbar">
        <div class="search-wrap">
          <i class="bi bi-search"></i>
          <input type="text" class="form-control form-control-sm" placeholder="Pesquisar nesta tabela...">
        </div>
        <select class="form-select form-select-sm w-auto pagesize-select">
          ${[10, 15, 25, 50, 100].map((n) => `<option value="${n}" ${n === state.pageSize ? "selected" : ""}>${n} / página</option>`).join("")}
        </select>
        <span class="badge text-bg-light border ms-auto result-count"></span>
      </div>
      <div class="ti-table-wrap">
        <table class="table table-sm table-hover align-middle ti-table">
          <thead><tr></tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <div class="ti-pagination-bar">
        <div class="small text-secondary page-info"></div>
        <nav><ul class="pagination pagination-sm mb-0 page-nav"></ul></nav>
      </div>`;
    container.appendChild(root);

    const els = {
      statsRow: root.querySelector(".col-stats-row"),
      search: root.querySelector(".search-wrap input"),
      pageSizeSelect: root.querySelector(".pagesize-select"),
      resultCount: root.querySelector(".result-count"),
      theadRow: root.querySelector("thead tr"),
      tbody: root.querySelector("tbody"),
      pageInfo: root.querySelector(".page-info"),
      pageNav: root.querySelector(".page-nav"),
    };

    function getFilteredRows() {
      if (!state.search.trim()) return state.rows;
      const q = state.search.toLowerCase();
      return state.rows.filter((row) =>
        state.columns.some((c) => String(row[c.key] ?? "").toLowerCase().includes(q))
      );
    }

    function getSortedRows(rows) {
      if (!state.sortKey) return rows;
      const col = state.columns.find((c) => c.key === state.sortKey);
      const copy = rows.slice();
      copy.sort((a, b) => {
        let va = a[state.sortKey], vb = b[state.sortKey];
        if (col && col.numeric) { va = Number(va) || 0; vb = Number(vb) || 0; return (va - vb) * state.sortDir; }
        va = String(va ?? "").toLowerCase(); vb = String(vb ?? "").toLowerCase();
        return va.localeCompare(vb, "pt-BR") * state.sortDir;
      });
      return copy;
    }

    function renderHeader() {
      els.theadRow.innerHTML = state.columns.map((c) => `
        <th data-key="${c.key}" class="${state.sortKey === c.key ? "sorted" : ""}">
          ${Utils.escapeHtml(c.label)}
          <i class="bi ${state.sortKey === c.key ? (state.sortDir === 1 ? "bi-sort-up" : "bi-sort-down") : "bi-arrow-down-up"} sort-icon"></i>
        </th>`).join("");
      els.theadRow.querySelectorAll("th").forEach((th) => {
        th.addEventListener("click", () => {
          const key = th.dataset.key;
          if (state.sortKey === key) state.sortDir *= -1; else { state.sortKey = key; state.sortDir = 1; }
          state.page = 1;
          renderAll();
        });
      });
    }

    function renderStats(filteredRows) {
      if (!state.numericStats) { els.statsRow.classList.add("d-none"); return; }
      const stats = computeColumnStats(state.columns, filteredRows);
      if (!stats.length) { els.statsRow.classList.add("d-none"); return; }
      els.statsRow.classList.remove("d-none");
      els.statsRow.innerHTML = stats.map((s) => `
        <span class="mini-stat">
          <b>${s.label}</b> — total: <b>${Utils.formatNumber(s.total, 2)}</b>
          &nbsp;·&nbsp;média: <b>${Utils.formatNumber(s.avg, 2)}</b>
          &nbsp;·&nbsp;mín: <b>${Utils.formatNumber(s.min, 0)}</b>
          &nbsp;·&nbsp;máx: <b>${Utils.formatNumber(s.max, 0)}</b>
        </span>`).join("");
    }

    function renderBody(pageRows) {
      if (!pageRows.length) {
        els.tbody.innerHTML = `<tr><td colspan="${state.columns.length}" class="text-center text-secondary py-4">
          <i class="bi bi-inbox fs-4 d-block mb-1"></i>Nenhum registro encontrado.</td></tr>`;
        return;
      }
      els.tbody.innerHTML = pageRows.map((row) => `
        <tr>${state.columns.map((c) => `<td class="${c.numeric ? "text-end" : ""}">${Utils.escapeHtml(row[c.key] ?? "")}</td>`).join("")}</tr>
      `).join("");
    }

    function renderPagination(totalRows) {
      const totalPages = Math.max(1, Math.ceil(totalRows / state.pageSize));
      state.page = Utils.clamp(state.page, 1, totalPages);
      const start = totalRows === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
      const end = Math.min(state.page * state.pageSize, totalRows);
      els.pageInfo.textContent = `Mostrando ${start}–${end} de ${Utils.formatNumber(totalRows)} registro(s)`;

      const pages = [];
      const addBtn = (label, page, disabled, active) => pages.push(
        `<li class="page-item ${disabled ? "disabled" : ""} ${active ? "active" : ""}">
           <button class="page-link" data-page="${page}">${label}</button></li>`);

      addBtn('<i class="bi bi-chevron-double-left"></i>', 1, state.page === 1, false);
      addBtn('<i class="bi bi-chevron-left"></i>', state.page - 1, state.page === 1, false);
      const windowSize = 2;
      for (let p = Math.max(1, state.page - windowSize); p <= Math.min(totalPages, state.page + windowSize); p++) {
        addBtn(String(p), p, false, p === state.page);
      }
      addBtn('<i class="bi bi-chevron-right"></i>', state.page + 1, state.page === totalPages, false);
      addBtn('<i class="bi bi-chevron-double-right"></i>', totalPages, state.page === totalPages, false);
      els.pageNav.innerHTML = pages.join("");
      els.pageNav.querySelectorAll("button").forEach((btn) => {
        btn.addEventListener("click", () => { state.page = Number(btn.dataset.page); renderAll(); });
      });
    }

    function renderAll() {
      renderHeader();
      const filtered = getFilteredRows();
      const sorted = getSortedRows(filtered);
      renderStats(filtered);
      els.resultCount.textContent = `${Utils.formatNumber(filtered.length)} de ${Utils.formatNumber(state.rows.length)} linha(s)`;
      const startIdx = (state.page - 1) * state.pageSize;
      const pageRows = sorted.slice(startIdx, startIdx + state.pageSize);
      renderBody(pageRows);
      renderPagination(filtered.length);
    }

    els.search.addEventListener("input", Utils.debounce((e) => { state.search = e.target.value; state.page = 1; renderAll(); }, 200));
    els.pageSizeSelect.addEventListener("change", (e) => { state.pageSize = Number(e.target.value); state.page = 1; renderAll(); });

    renderAll();

    return {
      getVisibleRows: () => getSortedRows(getFilteredRows()),
      getAllRows: () => state.rows,
      refresh: renderAll,
    };
  }

  global.TableComponent = { mount };
})(window);
