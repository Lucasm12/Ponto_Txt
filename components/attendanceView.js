/**
 * attendanceView.js — visão simplificada para arquivos AFD (ponto eletrônico):
 * o usuário escolhe um mês, vê a lista de funcionários com marcação naquele
 * mês e, ao clicar em um deles, gera um "Espelho de Ponto" (estilo folha de
 * ponto) com um dia por linha e os totais do mês.
 *
 * Como o AFD não informa a jornada/escala oficial de cada funcionário, a
 * jornada esperada (CH) e o horário habitual de entrada são estimados a
 * partir do próprio histórico de marcações (mediana por dia da semana).
 * CH = carga horária esperada · HT = horas trabalhadas · EX = horas extras
 * AT = atraso (entrada após o horário habitual) · FA = falta (déficit restante).
 */
(function (global) {
  "use strict";

  const DIA_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  function dateKeyLocal(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
  function timeToMinutes(hhmm) {
    if (!hhmm || hhmm === "-") return null;
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }
  function minutesToHHMM(mins) {
    const sign = mins < 0 ? "-" : "";
    mins = Math.round(Math.abs(mins));
    return `${sign}${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  }
  /** Interpreta o texto digitado pelo usuário num campo editável de horas (ex.: "1:30", "-0:15"). */
  function parseTimeInput(text) {
    const m = (text || "").trim().match(/^(-)?(\d{1,3}):(\d{1,2})$/);
    if (!m) return 0;
    return (m[1] ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  }
  function pairSumMinutes(sortedTimes) {
    let total = 0;
    for (let i = 0; i + 1 < sortedTimes.length; i += 2) total += sortedTimes[i + 1] - sortedTimes[i];
    return total;
  }
  function median(arr) {
    const s = arr.slice().sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  /** Agrupa as marcações de um funcionário por dia (chave local, sem risco de fuso horário). */
  function groupByDay(punchesForWorker) {
    const map = new Map();
    for (const p of punchesForWorker) {
      const d = new Date(p.dataISO);
      const key = dateKeyLocal(d);
      if (!map.has(key)) map.set(key, { date: d, times: [] });
      const mins = timeToMinutes(p.hora);
      if (mins != null) map.get(key).times.push(mins);
    }
    for (const rec of map.values()) rec.times.sort((a, b) => a - b);
    return map;
  }

  /** Infere, por dia da semana, a carga horária esperada e o horário habitual de entrada. */
  function inferSchedule(dayMap) {
    const byWeekday = new Map();
    for (const rec of dayMap.values()) {
      if (rec.times.length < 2) continue;
      const wd = rec.date.getDay();
      if (!byWeekday.has(wd)) byWeekday.set(wd, []);
      byWeekday.get(wd).push({ worked: pairSumMinutes(rec.times), first: rec.times[0] });
    }
    const schedule = {};
    for (let wd = 0; wd < 7; wd++) {
      const arr = byWeekday.get(wd);
      if (!arr || !arr.length) { schedule[wd] = { ch: 0, entrada: null }; continue; }
      const ch = Math.round(median(arr.map((a) => a.worked)) / 5) * 5;
      schedule[wd] = { ch, entrada: median(arr.map((a) => a.first)) };
    }
    return schedule;
  }

  /** Monta as linhas do espelho de ponto (um dia por linha) para um mês (year, monthIndex 0-based). */
  function buildEspelho(dayMap, schedule, year, monthIndex) {
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const rows = [];
    const totals = { ch: 0, ht: 0, ex: 0, at: 0, fa: 0 };

    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj = new Date(year, monthIndex, day);
      const wd = dateObj.getDay();
      const rec = dayMap.get(dateKeyLocal(dateObj));
      const times = rec ? rec.times : [];
      const sched = schedule[wd] || { ch: 0, entrada: null };
      const ch = sched.ch;

      let ht = 0, ex = 0, at = 0, fa = 0;
      if (ch > 0) {
        if (times.length >= 2) {
          const worked = pairSumMinutes(times);
          ht = Math.min(worked, ch);
          ex = Math.max(0, worked - ch);
          const deficit = Math.max(0, ch - worked);
          const atrasoEntrada = sched.entrada != null ? Math.max(0, times[0] - sched.entrada) : 0;
          at = Math.min(deficit, atrasoEntrada);
          fa = deficit - at;
        } else if (times.length === 0) {
          fa = ch;
        } else {
          // marcação incompleta (só entrada, sem saída) — não dá para apurar com segurança.
          fa = ch;
        }
      } else if (times.length > 0) {
        // Trabalhou em um dia sem padrão histórico (provável folga) — conta tudo como extra.
        ex = pairSumMinutes(times);
      }

      totals.ch += ch; totals.ht += ht; totals.ex += ex; totals.at += at; totals.fa += fa;
      rows.push({
        day, dateObj, diaSemana: DIA_LABELS[wd], isWeekend: wd === 0 || wd === 6,
        pontos: times.map((t) => minutesToHHMM(t)).join("  "),
        ch, ht, ex, at, fa, incomplete: ch > 0 && times.length === 1,
      });
    }
    return { rows, totals };
  }

  function fmtOrDash(mins) { return mins > 0 ? minutesToHHMM(mins) : ""; }

  // ------------------------------------------------------------------
  // Renderização
  // ------------------------------------------------------------------
  function render(container, doc, fileMeta, onNewFile) {
    const att = doc.attendance;
    const companyLabel = att.companyName + (att.companyDoc ? ` - ${att.companyDoc}` : "");
    const state = { monthKey: att.months.length ? att.months[att.months.length - 1].key : null, search: "", employeeId: null };

    const root = document.createElement("div");
    root.className = "attendance-wrap";
    root.innerHTML = `
      <div class="ti-card report-hero mb-4 d-print-none">
        <div class="d-flex flex-wrap justify-content-between align-items-start gap-3">
          <div>
            <div class="d-flex align-items-center gap-2 mb-2">
              <i class="bi bi-file-earmark-check-fill fs-3"></i>
              <h1 class="h4 mb-0 fw-bold text-truncate" style="max-width:60vw;" title="${Utils.escapeHtml(fileMeta.fileName)}">${Utils.escapeHtml(fileMeta.fileName)}</h1>
            </div>
            <div class="d-flex flex-wrap gap-2">
              <span class="meta-pill"><i class="bi bi-building"></i>${Utils.escapeHtml(companyLabel)}</span>
              <span class="meta-pill"><i class="bi bi-calendar-check"></i>${Utils.formatDateTime(fileMeta.importedAt)}</span>
              <span class="meta-pill"><i class="bi bi-people-fill"></i>${Utils.formatNumber(att.employees.length)} funcionário(s)</span>
            </div>
          </div>
          <button class="btn btn-light btn-sm" id="attNewFileBtn"><i class="bi bi-file-earmark-plus me-1"></i>Novo arquivo</button>
        </div>
      </div>

      <div id="attListView">
        <div class="ti-card p-3 mb-4 d-print-none">
          <div class="row g-3 align-items-end">
            <div class="col-sm-4 col-md-3">
              <label class="form-label small fw-bold mb-1">Mês</label>
              <select id="attMonthSelect" class="form-select"></select>
            </div>
            <div class="col-sm-8 col-md-6">
              <label class="form-label small fw-bold mb-1">Funcionário</label>
              <div class="search-wrap">
                <i class="bi bi-search"></i>
                <input id="attEmployeeSearch" type="text" class="form-control" placeholder="Buscar por nome...">
              </div>
            </div>
          </div>
        </div>

        <div class="ti-card section-card">
          <div class="section-header">
            <h2 class="section-title"><i class="bi bi-people-fill text-primary"></i>Funcionários</h2>
            <div class="d-flex align-items-center gap-2">
              <button class="btn btn-outline-primary btn-sm d-print-none" id="attPrintAllBtn">
                <i class="bi bi-printer me-1"></i>Espelho de todos
              </button>
              <span class="badge text-bg-secondary section-badge" id="attListCount"></span>
            </div>
          </div>
          <div class="section-body p-0">
            <table class="table table-hover align-middle mb-0">
              <thead><tr><th>Funcionário</th><th class="text-end">Dias com marcação</th><th class="text-end"></th></tr></thead>
              <tbody id="attListBody"></tbody>
            </table>
          </div>
        </div>
      </div>

      <div id="attDetailView" class="d-none"></div>
    `;
    container.innerHTML = "";
    container.appendChild(root);

    root.querySelector("#attNewFileBtn")?.addEventListener("click", () => onNewFile && onNewFile());

    const els = {
      monthSelect: root.querySelector("#attMonthSelect"),
      search: root.querySelector("#attEmployeeSearch"),
      listBody: root.querySelector("#attListBody"),
      listCount: root.querySelector("#attListCount"),
      listView: root.querySelector("#attListView"),
      detailView: root.querySelector("#attDetailView"),
      printAllBtn: root.querySelector("#attPrintAllBtn"),
    };

    els.monthSelect.innerHTML = att.months.map((m) => `<option value="${m.key}">${Utils.escapeHtml(m.label)}</option>`).join("")
      || `<option value="">(nenhum mês encontrado)</option>`;
    if (state.monthKey) els.monthSelect.value = state.monthKey;

    // Índice de dias-com-marcação por funcionário+mês, calculado uma vez.
    const punchesByWorker = Utils.groupBy(att.punches, (p) => p.workerId);

    function daysWithPunchInMonth(workerId, mKey) {
      const list = punchesByWorker.get(workerId) || [];
      const days = new Set();
      for (const p of list) {
        const d = new Date(p.dataISO);
        if (`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` === mKey) days.add(dateKeyLocal(d));
      }
      return days.size;
    }

    function renderList() {
      const mKey = els.monthSelect.value;
      const q = state.search.trim().toLowerCase();
      const rows = att.employees
        .map((e) => ({ ...e, dias: daysWithPunchInMonth(e.id, mKey) }))
        .filter((e) => e.dias > 0 && (!q || e.nome.toLowerCase().includes(q) || e.id.includes(q)))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

      els.listCount.textContent = `${Utils.formatNumber(rows.length)} funcionário(s)`;
      if (!rows.length) {
        els.listBody.innerHTML = `<tr><td colspan="3" class="text-center text-secondary py-4">
          <i class="bi bi-inbox fs-4 d-block mb-1"></i>Nenhum funcionário com marcação neste mês.</td></tr>`;
        return;
      }
      els.listBody.innerHTML = rows.map((e) => `
        <tr class="att-row" data-id="${Utils.escapeHtml(e.id)}" style="cursor:pointer;">
          <td>${Utils.escapeHtml(e.nome)}</td>
          <td class="text-end">${e.dias}</td>
          <td class="text-end"><i class="bi bi-chevron-right text-secondary"></i></td>
        </tr>`).join("");
      els.listBody.querySelectorAll(".att-row").forEach((tr) => {
        tr.addEventListener("click", () => openDetail(tr.dataset.id, mKey));
      });
    }

    /** Monta o miolo (cabeçalho + tabela de dias + rodapé) do espelho de um funcionário/mês — reaproveitado tanto na visão individual quanto na impressão de todos. */
    function espelhoBodyHTML(workerId, mKey, monthLabelText) {
      const employee = att.employees.find((e) => e.id === workerId);
      const [year, month] = mKey.split("-").map(Number);
      const workerPunches = punchesByWorker.get(workerId) || [];
      const dayMap = groupByDay(workerPunches);
      const schedule = inferSchedule(dayMap);
      const { rows, totals } = buildEspelho(dayMap, schedule, year, month - 1);
      const periodo = `01/${String(month).padStart(2, "0")}/${year} a ${String(rows.length).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;

      const jornadaTexto = Object.entries(schedule)
        .filter(([, s]) => s.ch > 0)
        .map(([wd, s]) => `${DIA_LABELS[wd]}: ${minutesToHHMM(s.entrada)} (CH ${minutesToHHMM(s.ch)})`)
        .join(" · ") || "Não foi possível identificar uma jornada habitual.";

      return `
        <div class="alert alert-light border small d-flex align-items-center gap-2 mb-3 d-print-none">
          <i class="bi bi-pencil-square text-primary"></i>
          <div>Os campos abaixo são estimativas e podem ser <b>editados clicando neles</b> — ajuste o que for
          necessário antes de imprimir ou gerar o PDF.</div>
        </div>
        <h4 class="text-center fw-bold mb-3">Espelho de Ponto — ${Utils.escapeHtml(monthLabelText)}</h4>
        <div class="espelho-header small mb-3">
          <div><b>Empresa:</b> <span class="editable-field" contenteditable="true">${Utils.escapeHtml(companyLabel)}</span></div>
          <div><b>Funcionário:</b> <span class="editable-field" contenteditable="true">${Utils.escapeHtml(employee ? employee.nome : "-")}</span></div>
          <div><b>Matrícula/PIS:</b> <span class="editable-field" contenteditable="true">${Utils.escapeHtml(workerId)}</span></div>
          <div><b>Período:</b> <span class="editable-field" contenteditable="true">${periodo}</span></div>
          <div><b>Jornada habitual identificada:</b> <span class="editable-field" contenteditable="true">${Utils.escapeHtml(jornadaTexto)}</span></div>
        </div>
        <div class="table-responsive">
          <table class="table table-sm table-bordered espelho-table mb-2">
            <thead><tr>
              <th>Data</th><th>Pontos</th>
              <th class="text-end">CH</th><th class="text-end">HT</th>
              <th class="text-end">EX</th><th class="text-end">AT</th><th class="text-end">FA</th>
            </tr></thead>
            <tbody>
              ${rows.map((r) => `
                <tr class="${r.isWeekend ? "table-secondary" : ""}">
                  <td>${String(r.day).padStart(2, "0")}/${String(month).padStart(2, "0")} ${r.diaSemana}</td>
                  <td><span class="editable-field" contenteditable="true">${Utils.escapeHtml(r.pontos)}</span>${r.incomplete ? ' <span class="badge text-bg-warning-subtle text-warning-emphasis">incompleta</span>' : ""}</td>
                  <td class="text-end"><span class="editable-field editable-time" data-col="ch" contenteditable="true">${fmtOrDash(r.ch)}</span></td>
                  <td class="text-end"><span class="editable-field editable-time" data-col="ht" contenteditable="true">${fmtOrDash(r.ht)}</span></td>
                  <td class="text-end"><span class="editable-field editable-time${r.ex > 0 ? " text-primary fw-bold" : ""}" data-col="ex" contenteditable="true">${r.ex > 0 ? minutesToHHMM(r.ex) : ""}</span></td>
                  <td class="text-end"><span class="editable-field editable-time${r.at > 0 ? " text-warning-emphasis fw-bold" : ""}" data-col="at" contenteditable="true">${r.at > 0 ? minutesToHHMM(r.at) : ""}</span></td>
                  <td class="text-end"><span class="editable-field editable-time${r.fa > 0 ? " text-danger fw-bold" : ""}" data-col="fa" contenteditable="true">${r.fa > 0 ? minutesToHHMM(r.fa) : ""}</span></td>
                </tr>`).join("")}
            </tbody>
            <tfoot>
              <tr class="fw-bold">
                <td colspan="2">Totais do mês</td>
                <td class="text-end" data-tot="ch">${minutesToHHMM(totals.ch)}</td>
                <td class="text-end" data-tot="ht">${minutesToHHMM(totals.ht)}</td>
                <td class="text-end" data-tot="ex">${minutesToHHMM(totals.ex)}</td>
                <td class="text-end" data-tot="at">${minutesToHHMM(totals.at)}</td>
                <td class="text-end" data-tot="fa">${minutesToHHMM(totals.fa)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p class="small text-secondary mt-2 mb-0">
          Estimativa calculada a partir do histórico de marcações do próprio arquivo (o AFD não informa a escala
          oficial de horário/jornada, cargo, departamento ou data de admissão). CH = carga horária esperada ·
          HT = horas trabalhadas · EX = horas extras · AT = atraso · FA = falta.
        </p>`;
    }

    /** Reinicia uma animação CSS num elemento mesmo que ela já tenha sido aplicada antes. */
    function flash(el) {
      el.classList.remove("recalc-flash");
      void el.offsetWidth; // força reflow para a animação poder ser reiniciada
      el.classList.add("recalc-flash");
    }

    /** Torna os campos do(s) espelho(s) dentro de scopeEl editáveis: o clique/foco seleciona
     * o conteúdo atual (para sobrescrever sem precisar apagar manualmente), Enter confirma em
     * vez de quebrar linha, e a edição de CH/HT/EX/AT/FA recalcula os totais do rodapé daquela
     * tabela — em tempo real enquanto digita, e com um destaque piscando ao confirmar (blur). */
    function wireEspelhoEditing(scopeEl) {
      scopeEl.querySelectorAll(".editable-field").forEach((el) => {
        el.addEventListener("focus", () => {
          const range = document.createRange();
          range.selectNodeContents(el);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        });
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); el.blur(); }
        });
      });
      scopeEl.querySelectorAll(".espelho-table").forEach((table) => {
        const COLS = ["ch", "ht", "ex", "at", "fa"];
        const HIGHLIGHT = { ex: "text-primary", at: "text-warning-emphasis", fa: "text-danger" };
        const recalcTotals = (highlightAll) => {
          const totals = { ch: 0, ht: 0, ex: 0, at: 0, fa: 0 };
          table.querySelectorAll("tbody .editable-time").forEach((el) => {
            totals[el.dataset.col] += parseTimeInput(el.textContent);
          });
          COLS.forEach((col) => {
            const cell = table.querySelector(`tfoot [data-tot="${col}"]`);
            if (!cell) return;
            cell.textContent = minutesToHHMM(totals[col]);
            // Sempre pisca ao confirmar (blur), mesmo que o valor final seja igual ao já
            // exibido em tempo real — o objetivo é confirmar visualmente que recalculou.
            if (highlightAll) flash(cell);
          });
        };
        table.querySelectorAll("tbody .editable-time").forEach((el) => {
          el.addEventListener("input", () => recalcTotals(false));
          el.addEventListener("blur", () => {
            const mins = parseTimeInput(el.textContent);
            el.textContent = mins ? minutesToHHMM(mins) : "";
            const cls = HIGHLIGHT[el.dataset.col];
            if (cls) { el.classList.toggle(cls, mins > 0); el.classList.toggle("fw-bold", mins > 0); }
            flash(el);
            recalcTotals(true);
          });
        });
      });
    }

    function backToList() {
      els.detailView.classList.add("d-none");
      els.listView.classList.remove("d-none");
    }

    function openDetail(workerId, mKey) {
      const monthLabelText = att.months.find((m) => m.key === mKey)?.label || mKey;
      els.detailView.innerHTML = `
        <div class="ti-card p-4 espelho-card">
          <div class="d-flex justify-content-between align-items-center mb-3 d-print-none">
            <button class="btn btn-outline-secondary btn-sm" id="attBackBtn"><i class="bi bi-arrow-left me-1"></i>Voltar à lista</button>
            <button class="btn btn-primary btn-sm" id="attPrintBtn"><i class="bi bi-printer me-1"></i>Imprimir / PDF</button>
          </div>
          ${espelhoBodyHTML(workerId, mKey, monthLabelText)}
        </div>`;

      els.listView.classList.add("d-none");
      els.detailView.classList.remove("d-none");
      els.detailView.querySelector("#attBackBtn").addEventListener("click", backToList);
      els.detailView.querySelector("#attPrintBtn").addEventListener("click", () => window.print());
      wireEspelhoEditing(els.detailView);
    }

    /** Gera o espelho de ponto de todos os funcionários com marcação no mês, um por página, para impressão/PDF em lote. */
    function openAllDetail(mKey) {
      const monthLabelText = att.months.find((m) => m.key === mKey)?.label || mKey;
      const rows = att.employees
        .map((e) => ({ ...e, dias: daysWithPunchInMonth(e.id, mKey) }))
        .filter((e) => e.dias > 0)
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

      els.detailView.innerHTML = `
        <div class="d-flex justify-content-between align-items-center mb-3 d-print-none">
          <button class="btn btn-outline-secondary btn-sm" id="attBackBtn"><i class="bi bi-arrow-left me-1"></i>Voltar à lista</button>
          <button class="btn btn-primary btn-sm" id="attPrintBtn"><i class="bi bi-printer me-1"></i>Imprimir / PDF (${rows.length} funcionário(s))</button>
        </div>
        ${rows.map((e) => `
          <div class="ti-card p-4 espelho-card espelho-page">
            ${espelhoBodyHTML(e.id, mKey, monthLabelText)}
          </div>`).join("")}`;

      els.listView.classList.add("d-none");
      els.detailView.classList.remove("d-none");
      els.detailView.querySelector("#attBackBtn").addEventListener("click", backToList);
      els.detailView.querySelector("#attPrintBtn").addEventListener("click", () => window.print());
      wireEspelhoEditing(els.detailView);
    }

    els.monthSelect.addEventListener("change", renderList);
    els.search.addEventListener("input", Utils.debounce((e) => { state.search = e.target.value; renderList(); }, 200));
    els.printAllBtn.addEventListener("click", () => openAllDetail(els.monthSelect.value));

    renderList();
  }

  global.AttendanceView = { render };
})(window);
