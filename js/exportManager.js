/**
 * exportManager.js — exportação de seções do relatório em CSV, Excel (XLSX)
 * e PDF, além da impressão do relatório completo (que também serve como
 * "Salvar como PDF" via a caixa de diálogo de impressão do navegador).
 */
(function (global) {
  "use strict";

  function safeFileName(name) {
    return name.replace(/[^\w\-]+/g, "_").slice(0, 60);
  }

  function exportCSV(section, rows) {
    const csv = Utils.toCSV(section.columns, rows);
    // BOM para o Excel abrir acentuação corretamente.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    Utils.downloadBlob(blob, `${safeFileName(section.title)}.csv`);
    toast("CSV exportado com sucesso.");
  }

  function exportExcel(section, rows) {
    const data = rows.map((r) => {
      const o = {};
      section.columns.forEach((c) => (o[c.label] = r[c.key]));
      return o;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, section.title.slice(0, 30) || "Dados");
    XLSX.writeFile(wb, `${safeFileName(section.title)}.xlsx`);
    toast("Excel exportado com sucesso.");
  }

  function exportPDF(section, rows) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(13);
    doc.text(section.title, 14, 14);
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(`Gerado em ${Utils.formatDateTime(new Date())} · ${rows.length} registro(s)`, 14, 20);

    const head = [section.columns.map((c) => c.label)];
    const maxRows = 1500; // limite de segurança para não travar o gerador de PDF
    const body = rows.slice(0, maxRows).map((r) => section.columns.map((c) => String(r[c.key] ?? "")));

    doc.autoTable({
      head, body, startY: 26, styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [79, 70, 229] },
      didDrawPage: () => {},
    });

    if (rows.length > maxRows) {
      const finalY = doc.lastAutoTable.finalY + 6;
      doc.setFontSize(8);
      doc.text(`* Exibindo as primeiras ${maxRows} de ${rows.length} linhas. Use CSV/Excel para exportar tudo.`, 14, finalY);
    }

    doc.save(`${safeFileName(section.title)}.pdf`);
    toast("PDF exportado com sucesso.");
  }

  function exportTextAsFile(section) {
    const blob = new Blob([section.content], { type: "text/plain;charset=utf-8;" });
    Utils.downloadBlob(blob, `${safeFileName(section.title)}.txt`);
    toast("Arquivo de texto exportado.");
  }

  function toast(message) {
    if (typeof Swal === "undefined") return;
    Swal.fire({ toast: true, position: "top-end", icon: "success", title: message, showConfirmButton: false, timer: 2200, timerProgressBar: true });
  }

  function attachTableToolbar(toolbarEl, section, tableApi) {
    toolbarEl.innerHTML = `
      <div class="btn-group btn-group-sm d-print-none">
        <button class="btn btn-outline-secondary btn-export" data-fmt="csv" title="Exportar CSV"><i class="bi bi-filetype-csv"></i></button>
        <button class="btn btn-outline-secondary btn-export" data-fmt="xlsx" title="Exportar Excel"><i class="bi bi-file-earmark-excel"></i></button>
        <button class="btn btn-outline-secondary btn-export" data-fmt="pdf" title="Exportar PDF"><i class="bi bi-file-earmark-pdf"></i></button>
      </div>`;
    toolbarEl.querySelectorAll(".btn-export").forEach((btn) => {
      btn.addEventListener("click", () => {
        const rows = tableApi.getVisibleRows();
        if (!rows.length) { toast("Não há dados para exportar (filtro atual está vazio)."); return; }
        const fmt = btn.dataset.fmt;
        if (fmt === "csv") exportCSV(section, rows);
        else if (fmt === "xlsx") exportExcel(section, rows);
        else if (fmt === "pdf") exportPDF(section, rows);
      });
    });
  }

  function attachTextToolbar(toolbarEl, section) {
    toolbarEl.innerHTML = `
      <button class="btn btn-outline-secondary btn-sm d-print-none btn-export-txt" title="Baixar como .txt">
        <i class="bi bi-download me-1"></i>Baixar
      </button>`;
    toolbarEl.querySelector(".btn-export-txt").addEventListener("click", () => exportTextAsFile(section));
  }

  function printReport() {
    window.print();
  }

  global.ExportManager = { attachTableToolbar, attachTextToolbar, printReport };
})(window);
