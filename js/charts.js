/**
 * charts.js — wrapper fino sobre Chart.js para criar/atualizar gráficos do
 * relatório, mantendo um registro das instâncias ativas para poder destruí-las
 * ao gerar um novo relatório (evita o erro "Canvas is already in use").
 */
(function (global) {
  "use strict";

  const instances = new Map();

  const PALETTE = [
    "#4f46e5", "#0ea5e9", "#22c55e", "#f59e0b", "#ef4444",
    "#a855f7", "#14b8a6", "#eab308", "#f97316", "#3b82f6",
  ];

  function destroyAll() {
    instances.forEach((chart) => chart.destroy());
    instances.clear();
  }

  function isDark() {
    return document.documentElement.getAttribute("data-bs-theme") === "dark";
  }

  function gridColor() { return isDark() ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.06)"; }
  function textColor() { return isDark() ? "#cbd5e1" : "#334155"; }

  function buildDataset(ds, index, type) {
    if (type === "doughnut" || type === "pie") {
      return { label: ds.label, data: ds.data, backgroundColor: ds.data.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 1 };
    }
    return {
      label: ds.label, data: ds.data,
      backgroundColor: PALETTE[index % PALETTE.length] + (type === "line" ? "33" : "cc"),
      borderColor: PALETTE[index % PALETTE.length],
      borderWidth: 2, fill: type === "line", tension: 0.3, borderRadius: type === "bar" ? 4 : 0,
    };
  }

  /** Renderiza (ou re-renderiza) um gráfico dentro de um <canvas>. */
  function render(canvasId, chartSpec) {
    const el = document.getElementById(canvasId);
    if (!el) return;
    if (instances.has(canvasId)) instances.get(canvasId).destroy();

    const isPie = chartSpec.type === "doughnut" || chartSpec.type === "pie";
    const chart = new Chart(el, {
      type: chartSpec.horizontal ? "bar" : chartSpec.type,
      data: {
        labels: chartSpec.labels,
        datasets: chartSpec.datasets.map((ds, i) => buildDataset(ds, i, chartSpec.type)),
      },
      options: {
        indexAxis: chartSpec.horizontal ? "y" : "x",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: isPie || chartSpec.datasets.length > 1, position: "bottom", labels: { color: textColor(), boxWidth: 12, font: { size: 11 } } },
          tooltip: { titleFont: { size: 12 }, bodyFont: { size: 12 } },
        },
        scales: isPie ? {} : {
          x: { ticks: { color: textColor(), font: { size: 10 } }, grid: { color: gridColor() } },
          y: { ticks: { color: textColor(), font: { size: 10 } }, grid: { color: gridColor() }, beginAtZero: true },
        },
      },
    });
    instances.set(canvasId, chart);
  }

  global.ChartsManager = { render, destroyAll };
})(window);
