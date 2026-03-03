(() => {
  const page = document.documentElement.getAttribute("data-page");
  if (page !== "lead-perdido") return;

  const CONFIG = {
    ENDPOINT: "https://n8n.clinicaexperts.com.br/webhook/perdidos",
  };

  const dom = { byId: (id) => document.getElementById(id) };

  const elements = {
    startDate: dom.byId("startDate"),
    endDate: dom.byId("endDate"),
    sellerSelect: dom.byId("sellerSelect"),
    objectionSelect: dom.byId("objectionSelect"),
    applyFilters: dom.byId("applyFilters"),
    clearAllFilters: dom.byId("clearAllFilters"),

    kpiTotal: dom.byId("kpiTotal"),

    rowsBody: dom.byId("rowsBody"),
    totalCount: dom.byId("totalCount"),
    pageInfo: dom.byId("pageInfo"),

    loadingOverlay: dom.byId("loadingOverlay"),
    errorToast: dom.byId("errorToast"),
    errorMessage: dom.byId("errorMessage"),
    closeToast: dom.byId("closeToast"),
  };

  const state = {
    allRows: [],
    filtered: [],
    sort: { key: "date", direction: "desc" },
    pagination: { page: 1, pageSize: 20 },
    charts: {},
  };

  const ui = {
    showLoading() {
      elements.loadingOverlay?.classList.add("active");
    },
    hideLoading() {
      elements.loadingOverlay?.classList.remove("active");
    },
    showError(message) {
      if (!elements.errorToast) return;
      elements.errorMessage.textContent = message;
      elements.errorToast.classList.add("active");
      setTimeout(() => this.hideError(), 4500);
    },
    hideError() {
      elements.errorToast?.classList.remove("active");
    },
    renderEmptyState(message = "Sem dados", colspan = 5) {
      return `<tr><td colspan="${colspan}" style="padding:24px;color:#94a3b8;text-align:center;">${utils.escapeHtml(
        message
      )}</td></tr>`;
    },
  };

  const utils = {
    escapeHtml(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    },

    safeText(v) {
      if (v === null || v === undefined || v === "") return "–";
      return String(v);
    },

    toISODate(dateObj) {
      const y = dateObj.getFullYear();
      const m = String(dateObj.getMonth() + 1).padStart(2, "0");
      const d = String(dateObj.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    },

    startOfMonth(dateObj) {
      return new Date(dateObj.getFullYear(), dateObj.getMonth(), 1);
    },

    parseDate(value) {
      if (!value) return null;
      const s = String(value).trim();
      if (!s) return null;
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d;
    },

    toBRDate(value) {
      const d = this.parseDate(value);
      if (!d) return "–";
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yyyy = d.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    },

    uniqueSorted(rows, key) {
      const set = new Set();
      rows.forEach((r) => {
        const v = String(r?.[key] ?? "").trim();
        if (v) set.add(v);
      });
      return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
    },

    countBy(rows, key) {
      const acc = {};
      rows.forEach((r) => {
        const k = String(r?.[key] ?? "").trim() || "Não informado";
        acc[k] = (acc[k] || 0) + 1;
      });
      return acc;
    },

    topN(counts, top = 12) {
      const entries = Object.entries(counts || {}).sort((a, b) => (b[1] || 0) - (a[1] || 0));
      const labels = [];
      const data = [];
      let other = 0;

      entries.forEach(([k, v], idx) => {
        if (idx < top) {
          labels.push(k);
          data.push(v);
        } else {
          other += v;
        }
      });

      if (other > 0) {
        labels.push("Outros");
        data.push(other);
      }

      return { labels, data };
    },
  };

  function setOptions(selectEl, values) {
    if (!selectEl) return;
    const current = String(selectEl.value || "");
    const firstLabel = selectEl.id === "objectionSelect" ? "Todas" : "Todos";
    const opts = [`<option value="">${firstLabel}</option>`];
    values.forEach((v) => {
      opts.push(`<option value="${utils.escapeHtml(v)}">${utils.escapeHtml(v)}</option>`);
    });
    selectEl.innerHTML = opts.join("");
    if (current) selectEl.value = current;
  }

  function normalizeRow(raw) {
    // payload: { data, nome, objecao, descricao, chat, ... }
    return {
      date: raw?.data ?? null,
      seller: raw?.nome ?? null,
      objection: raw?.objecao ?? null,
      description: raw?.descricao ?? null,
      chat: raw?.chat ?? null,
      id: raw?.id ?? null,
    };
  }

  function getEntryRangeFromInputs() {
    const today = new Date();
    const defaultStart = utils.toISODate(utils.startOfMonth(today));
    const defaultEnd = utils.toISODate(today);

    let start = String(elements.startDate?.value || "").trim() || defaultStart;
    let end = String(elements.endDate?.value || "").trim() || defaultEnd;

    // segurança: se inverter, corrige
    if (start > end) [start, end] = [end, start];

    return { start, end };
  }

  // vendedor/objeção filtram no front (depois que chegou)
  function applyFilters() {
    const seller = String(elements.sellerSelect?.value || "").trim();
    const objection = String(elements.objectionSelect?.value || "").trim();

    let out = [...state.allRows];

    if (seller) out = out.filter((r) => String(r.seller || "").trim() === seller);
    if (objection) out = out.filter((r) => String(r.objection || "").trim() === objection);

    state.filtered = out;
    state.pagination.page = 1;
  }

  function sortRows(rows) {
    const { key, direction } = state.sort;
    const dir = direction === "asc" ? 1 : -1;

    const parseTime = (v) => {
      const d = utils.parseDate(v);
      return d ? d.getTime() : 0;
    };

    return [...rows].sort((a, b) => {
      if (key === "date") return (parseTime(a.date) - parseTime(b.date)) * dir;
      return String(a[key] ?? "").localeCompare(String(b[key] ?? ""), "pt-BR") * dir;
    });
  }

  function paginate(items, page, pageSize) {
    const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    const p = Math.max(1, Math.min(page, totalPages));
    return { slice: items.slice((p - 1) * pageSize, p * pageSize), page: p, totalPages };
  }

  function updatePaginationUI(meta) {
    if (elements.pageInfo) elements.pageInfo.textContent = `${meta.page} / ${meta.totalPages}`;

    document.querySelectorAll(`.pagination[data-channel="lost"] .pg-btn`).forEach((btn) => {
      const action = btn.getAttribute("data-action");
      btn.disabled =
        (action === "prev" && meta.page <= 1) || (action === "next" && meta.page >= meta.totalPages);
    });
  }

  function renderTable() {
    const sorted = sortRows(state.filtered);

    if (elements.totalCount) elements.totalCount.textContent = String(sorted.length);
    if (elements.kpiTotal) elements.kpiTotal.textContent = String(sorted.length);

    const meta = paginate(sorted, state.pagination.page, state.pagination.pageSize);
    state.pagination.page = meta.page;

    if (!elements.rowsBody) return;

    if (!meta.slice.length) {
      elements.rowsBody.innerHTML = ui.renderEmptyState("Sem dados para o filtro atual.", 5);
      updatePaginationUI({ page: 1, totalPages: 1 });
      return;
    }

    elements.rowsBody.innerHTML = meta.slice
      .map((r) => {
        const chatCell = r.chat
          ? `<a class="table-link" href="${utils.escapeHtml(r.chat)}" target="_blank" rel="noopener noreferrer">Abrir</a>`
          : "–";

        return `
          <tr>
            <td>${utils.toBRDate(r.date)}</td>
            <td>${utils.escapeHtml(utils.safeText(r.seller))}</td>
            <td>${utils.escapeHtml(utils.safeText(r.objection))}</td>
            <td class="td-desc">${utils.escapeHtml(utils.safeText(r.description))}</td>
            <td>${chatCell}</td>
          </tr>
        `;
      })
      .join("");

    updatePaginationUI(meta);
  }

  function ensureChart(canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !window.Chart) return null;

    if (state.charts[canvasId]) {
      const chart = state.charts[canvasId];
      chart.config.type = config.type;
      chart.data = config.data;
      chart.options = config.options;
      chart.update();
      return chart;
    }

    state.charts[canvasId] = new Chart(canvas, config);
    return state.charts[canvasId];
  }

  function updateCharts() {
    const rows = state.filtered || [];

    // 1) Por vendedor
    const bySeller = utils.topN(utils.countBy(rows, "seller"), 14);
    ensureChart("chartBySeller", {
      type: "bar",
      data: {
        labels: bySeller.labels,
        datasets: [{ label: "Total", data: bySeller.data }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false }, tooltip: { enabled: true } },
        scales: { x: { ticks: { maxRotation: 0, autoSkip: true } }, y: { beginAtZero: true, precision: 0 } },
      },
    });

    // 2) Por objeção (horizontal)
    const byObj = utils.topN(utils.countBy(rows, "objection"), 16);
    ensureChart("chartByObjection", {
      type: "bar",
      data: {
        labels: byObj.labels,
        datasets: [{ label: "Total", data: byObj.data }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        plugins: { legend: { display: false }, tooltip: { enabled: true } },
        scales: { x: { beginAtZero: true, precision: 0 }, y: { ticks: { autoSkip: false } } },
      },
    });
  }

  function refreshFilterOptions() {
    setOptions(elements.sellerSelect, utils.uniqueSorted(state.allRows, "seller"));
    setOptions(elements.objectionSelect, utils.uniqueSorted(state.allRows, "objection"));
  }

  async function loadData() {
    ui.showLoading();

    try {
      const { start, end } = getEntryRangeFromInputs();

      const params = new URLSearchParams({
        entry_start: start,
        entry_end: end,
        _ts: String(Date.now()),
      });

      const url = `${CONFIG.ENDPOINT}?${params.toString()}`;

      const res = await fetch(url, { cache: "no-store" });
      const rawText = await res.text();

      if (!res.ok) {
        const snippet = rawText ? rawText.slice(0, 220) : "";
        throw new Error(`HTTP ${res.status}${snippet ? ` — ${snippet}` : ""}`);
      }

      const text = (rawText || "").trim();
      const parsed = text ? JSON.parse(text) : [];

      // aceita: [ { leads: [...] } ] OU { leads: [...] }
      const root = Array.isArray(parsed) ? parsed[0] : parsed;
      const leads = Array.isArray(root?.leads) ? root.leads : [];

      state.allRows = leads.map(normalizeRow);

      refreshFilterOptions();
      applyFilters();
      renderTable();
      updateCharts();
    } catch (e) {
      ui.showError(`Erro: ${e.message}`);
      state.allRows = [];
      state.filtered = [];
      renderTable();
      updateCharts();
      if (elements.kpiTotal) elements.kpiTotal.textContent = "—";
      if (elements.totalCount) elements.totalCount.textContent = "—";
    } finally {
      ui.hideLoading();
    }
  }

  function initDefaults() {
    const today = new Date();
    const start = utils.toISODate(utils.startOfMonth(today));
    const end = utils.toISODate(today);

    if (elements.startDate) elements.startDate.value = start;
    if (elements.endDate) elements.endDate.value = end;
  }

  function bindEvents() {
    if (elements.applyFilters) elements.applyFilters.addEventListener("click", loadData);

    if (elements.clearAllFilters) {
      elements.clearAllFilters.addEventListener("click", () => {
        initDefaults();
        if (elements.sellerSelect) elements.sellerSelect.value = "";
        if (elements.objectionSelect) elements.objectionSelect.value = "";
        loadData();
      });
    }

    if (elements.closeToast) elements.closeToast.addEventListener("click", () => ui.hideError());

    document.querySelectorAll('.pagination[data-channel="lost"]').forEach((wrap) => {
      wrap.addEventListener("click", (e) => {
        const btn = e.target.closest(".pg-btn");
        if (!btn) return;
        state.pagination.page += btn.dataset.action === "next" ? 1 : -1;
        renderTable();
      });

      const sel = wrap.querySelector("select.pg-size");
      if (sel) {
        sel.addEventListener("change", (e) => {
          state.pagination.pageSize = Number(e.target.value);
          state.pagination.page = 1;
          renderTable();
        });
      }
    });

    document.querySelectorAll("th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.sort;

        state.sort.direction =
          state.sort.key === key && state.sort.direction === "desc" ? "asc" : "desc";
        state.sort.key = key;

        document.querySelectorAll("th[data-sort]").forEach((x) => x.classList.remove("active"));
        th.classList.add("active");

        renderTable();
      });
    });

    const defaultTh = document.querySelector('th[data-sort="date"]');
    defaultTh?.classList.add("active");
  }

  function init() {
    initDefaults();
    bindEvents();
    loadData();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();