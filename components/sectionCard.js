/**
 * sectionCard.js — casca visual (card) usada para envolver cada seção do
 * relatório (tabela, texto bruto, etc.), com cabeçalho padronizado e uma
 * área de "toolbar" para ações contextuais (ex.: botões de exportação).
 */
(function (global) {
  "use strict";

  /**
   * Cria a estrutura DOM do card e a insere em `container`.
   * @returns {{ body: HTMLElement, toolbar: HTMLElement }} referências para popular o conteúdo.
   */
  function mountSectionCard(container, { id, title, icon, badge, description }) {
    const wrapper = document.createElement("div");
    wrapper.className = "ti-card section-card mb-4";
    wrapper.id = id;
    wrapper.innerHTML = `
      <div class="section-header">
        <h2 class="section-title"><i class="bi ${icon || "bi-table"} text-primary"></i>${Utils.escapeHtml(title)}
          ${badge ? `<span class="badge text-bg-secondary section-badge ms-1">${Utils.escapeHtml(badge)}</span>` : ""}
        </h2>
        <div class="section-toolbar d-flex gap-2 flex-wrap"></div>
      </div>
      ${description ? `<div class="section-description px-3 pt-2 small text-secondary">${Utils.escapeHtml(description)}</div>` : ""}
      <div class="section-body"></div>`;
    container.appendChild(wrapper);
    return { body: wrapper.querySelector(".section-body"), toolbar: wrapper.querySelector(".section-toolbar") };
  }

  global.SectionCard = { mountSectionCard };
})(window);
