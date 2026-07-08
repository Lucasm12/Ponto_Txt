/**
 * theme.js — alternância entre tema claro e escuro.
 * Usa o atributo nativo data-bs-theme do Bootstrap 5.3.
 */
(function (global) {
  "use strict";

  const KEY = "txtinsight_theme";

  function getPreferred() {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function apply(theme) {
    document.documentElement.setAttribute("data-bs-theme", theme);
    const icon = document.getElementById("themeIcon");
    if (icon) {
      icon.className = theme === "dark" ? "bi bi-sun-fill" : "bi bi-moon-stars-fill";
    }
    localStorage.setItem(KEY, theme);
  }

  function toggle() {
    const current = document.documentElement.getAttribute("data-bs-theme") || "light";
    apply(current === "light" ? "dark" : "light");
  }

  function init() {
    apply(getPreferred());
  }

  global.ThemeManager = { init, toggle, apply };
})(window);
