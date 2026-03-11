const CONFIG = {
  ENDPOINT: "https://n8n.clinicaexperts.com.br/webhook/gerenciador-de-anuncios",
  BUDGET_ENDPOINT: "https://n8n.clinicaexperts.com.br/webhook/budget",
  BUDGET_ID: 2,
};

const formatters = {
  number: new Intl.NumberFormat("pt-BR"),
  currency: new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
};

const utils = {
  normalizeText(text) {
    return String(text ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  },

  toNumber(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;

    const s = String(value).trim();
    if (!s) return null;

    const normalized = s.replace(/\s+/g, "").replace(/,/g, ".");
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  },

  formatNumber(value) {
    const n = this.toNumber(value);
    return n === null ? "–" : formatters.number.format(n);
  },

  formatCurrency(value) {
    const n = this.toNumber(value);
    return n === null ? "–" : formatters.currency.format(n);
  },

  safeDivide(a, b) {
    const n = this.toNumber(a);
    const d = this.toNumber(b);
    if (n === null || d === null || d === 0) return null;
    return n / d;
  },

  mapStatus(raw) {
    const s = String(raw ?? "").toUpperCase().trim();
    if (s === "ACTIVE") return { key: "ACTIVE", label: "Ativa", cls: "status--active" };
    if (s === "PAUSED") return { key: "PAUSED", label: "Pausada", cls: "status--paused" };
    return { key: s || "UNKNOWN", label: s || "–", cls: "status--unknown" };
  },

  pickSpend(item) {
    const direct = this.toNumber(item?.spend);
    if (direct !== null) return direct;

    const fromInsights = item?.insights?.data?.[0]?.spend;
    const ins = this.toNumber(fromInsights);
    return ins !== null ? ins : 0;
  },

  pickDailyBudget(item) {
    const raw = item?.daily_budget ?? item?.dailyBudget ?? null;
    if (raw === null || raw === undefined) return null;

    const s = String(raw).trim();
    if (!s) return null;

    if (/^\d+$/.test(s)) {
      const n = Number(s);
      if (!Number.isFinite(n) || n === 0) return null;
      return n / 100;
    }

    const n = this.toNumber(s);
    if (n === null || n === 0) return null;
    return n;
  },

  pickLeads(item) {
    const candidates = [
      item?.count_external_id,
      item?.count_utm_term_adset,
      item?.count,
      item?.leads,
    ];

    for (const candidate of candidates) {
      const n = this.toNumber(candidate);
      if (n !== null) return n;
    }

    return 0;
  },

  pickLeadICP(item) {
    return String(item?.lead_icp ?? item?.leadIcp ?? "")
      .trim()
      .toLowerCase();
  },

  pickAdsetKey(item) {
    return (
      item?.utm_term_adset ??
      item?.adset_id ??
      item?.adsetId ??
      item?.id ??
      item?.name ??
      JSON.stringify(item)
    );
  },

  pickCampaignName(item) {
    return (
      item?.campaign?.name ??
      item?.campaign_name ??
      (typeof item?.campaign === "string" ? item.campaign : null) ??
      "–"
    );
  },

  pickCampaignId(item) {
    return item?.campaign?.id ?? item?.campaign_id ?? item?.campaignId ?? this.pickCampaignName(item);
  },
};

const $id = (id) => document.getElementById(id);

const elements = {
  campaignNameFilter: $id("campaignNameFilter"),
  statusFilter: $id("statusFilter"),
  applyFilters: $id("applyFilters"),
  clearFilters: $id("clearFilters"),
  body: $id("gerenciadorBody"),

  budgetSemana: $id("budgetSemana"),
  budgetSabado: $id("budgetSabado"),
  budgetDomingo1: $id("budgetDomingo1"),
  budgetDomingo2: $id("budgetDomingo2"),
  budgetPassword: $id("budgetPassword"),
  sendBudget: $id("sendBudget"),

  kpiAdsetsTotal: $id("kpiAdsetsTotal"),
  kpiAdsetsActive: $id("kpiAdsetsActive"),
  kpiAdsetsPaused: $id("kpiAdsetsPaused"),

  table: document.querySelector("table.data-table"),
  thead: document.querySelector("table.data-table thead"),

  loadingOverlay: $id("loadingOverlay"),
  errorToast: $id("errorToast"),
  errorMessage: $id("errorMessage"),
  closeToast: $id("closeToast"),
};

function parseBudgetInt(value) {
  const s = String(value ?? "").trim();
  if (!s) return null;

  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return null;

  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

async function sendBudgetRequest() {
  if (!elements.sendBudget) return;

  const payload = {
    id: CONFIG.BUDGET_ID,
    semana: parseBudgetInt(elements.budgetSemana?.value),
    sabado: parseBudgetInt(elements.budgetSabado?.value),
    domingo1: parseBudgetInt(elements.budgetDomingo1?.value),
    domingo2: parseBudgetInt(elements.budgetDomingo2?.value),
    password: String(elements.budgetPassword?.value ?? ""),
  };

  const missing = [];
  if (payload.semana === null) missing.push("Semana");
  if (payload.sabado === null) missing.push("Sábado");
  if (payload.domingo1 === null) missing.push("Domingo 1");
  if (payload.domingo2 === null) missing.push("Domingo 2");

  if (missing.length) {
    ui.showError(`Preencha com números: ${missing.join(", ")}.`);
    return;
  }

  const btn = elements.sendBudget;
  const originalText = btn.textContent;

  btn.disabled = true;
  btn.textContent = "Enviando...";

  try {
    const res = await fetch(CONFIG.BUDGET_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}${txt ? ` — ${txt}` : ""}`);
    }

    btn.textContent = "Enviado!";
    setTimeout(() => {
      btn.textContent = originalText;
    }, 1400);
  } catch (e) {
    ui.showError(`Erro ao enviar budgets: ${e?.message || "Falha"}`);
    btn.textContent = originalText;
  } finally {
    btn.disabled = false;
  }
}

const state = {
  raw: [],
  groups: [],
  expanded: new Set(),
  filters: {
    name: "ALL",
    status: "ALL",
  },
  sort: {
    key: null,
    dir: null,
  },
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
  emptyState(message = "Sem dados", colspan = 7) {
    return `<tr><td colspan="${colspan}"><div class="empty-state"><p>${message}</p></div></td></tr>`;
  },
};

function normalizePayload(payload) {
  const root = Array.isArray(payload) ? payload[0] : payload;
  const list = root?.campanhas ?? root?.campaigns ?? root?.data ?? (Array.isArray(root) ? root : null) ?? [];
  return Array.isArray(list) ? list : [];
}

function buildGroups(items) {
  const byCampaign = new Map();

  for (const item of items) {
    const campaignId = utils.pickCampaignId(item);
    const campaignName = utils.pickCampaignName(item);
    const adsetKey = String(utils.pickAdsetKey(item));

    const campaignNode =
      byCampaign.get(campaignId) ||
      {
        campaignId,
        campaignName,
        itemsByAdset: new Map(),
      };

    const spend = utils.pickSpend(item) || 0;
    const dailyBudget = utils.pickDailyBudget(item);
    const leads = utils.pickLeads(item) || 0;
    const leadIcp = utils.pickLeadICP(item) === "yes" ? leads : 0;
    const status = utils.mapStatus(item?.status);

    const adsetNode =
      campaignNode.itemsByAdset.get(adsetKey) ||
      {
        adsetKey,
        name: item?.name ?? "–",
        status,
        spend: spend || 0,
        dailyBudget,
        leads: 0,
        leadsIcp: 0,
      };

    adsetNode.leads += leads;
    adsetNode.leadsIcp += leadIcp;

    if ((utils.toNumber(adsetNode.spend) || 0) === 0 && spend) {
      adsetNode.spend = spend;
    }

    if (adsetNode.dailyBudget === null && dailyBudget !== null) {
      adsetNode.dailyBudget = dailyBudget;
    }

    if (!adsetNode.name || adsetNode.name === "–") {
      adsetNode.name = item?.name ?? "–";
    }

    if (adsetNode.status?.key === "UNKNOWN" && status.key !== "UNKNOWN") {
      adsetNode.status = status;
    }

    campaignNode.itemsByAdset.set(adsetKey, adsetNode);
    byCampaign.set(campaignId, campaignNode);
  }

  const groups = Array.from(byCampaign.values()).map((campaign) => {
    const adsets = Array.from(campaign.itemsByAdset.values()).map((item) => ({
      ...item,
      cpl: utils.safeDivide(item.spend, item.leads),
      cplIcp: utils.safeDivide(item.spend, item.leadsIcp),
    }));

    const totals = adsets.reduce(
      (acc, item) => {
        acc.spend += utils.toNumber(item?.spend) || 0;
        acc.dailyBudget += utils.toNumber(item?.dailyBudget) || 0;
        acc.leads += utils.toNumber(item?.leads) || 0;
        acc.leadsIcp += utils.toNumber(item?.leadsIcp) || 0;
        return acc;
      },
      { spend: 0, dailyBudget: 0, leads: 0, leadsIcp: 0 }
    );

    return {
      campaignId: campaign.campaignId,
      campaignName: campaign.campaignName,
      totals: {
        spend: totals.spend,
        dailyBudget: totals.dailyBudget,
        leads: totals.leads,
        leadsIcp: totals.leadsIcp,
        cpl: utils.safeDivide(totals.spend, totals.leads),
        cplIcp: utils.safeDivide(totals.spend, totals.leadsIcp),
      },
      items: adsets,
      hasActive: adsets.some((it) => String(it?.status?.key || "").toUpperCase() === "ACTIVE"),
      hasPaused: adsets.some((it) => String(it?.status?.key || "").toUpperCase() === "PAUSED"),
    };
  });

  groups.sort((a, b) => a.campaignName.localeCompare(b.campaignName, "pt-BR"));

  for (const g of groups) {
    g.items.sort((a, b) => String(a.name).localeCompare(b.name, "pt-BR"));
  }

  return groups;
}

function applyFilters(groups) {
  const selectedName = String(state.filters.name || "ALL");
  const nameFilter = selectedName === "ALL" ? "" : utils.normalizeText(selectedName);
  const statusFilter = String(state.filters.status || "ALL").toUpperCase();

  return groups
    .filter((g) => {
      const okName = !nameFilter || utils.normalizeText(g.campaignName) === nameFilter;
      return okName;
    })
    .map((g) => {
      let items = Array.isArray(g.items) ? g.items : [];

      if (statusFilter !== "ALL") {
        items = items.filter((it) => String(it?.status?.key || "").toUpperCase() === statusFilter);
      }

      if (!items.length) return null;

      const spend = items.reduce((acc, it) => acc + (utils.toNumber(it?.spend) || 0), 0);
      const dailyBudget = items.reduce((acc, it) => acc + (utils.toNumber(it?.dailyBudget) || 0), 0);
      const leads = items.reduce((acc, it) => acc + (utils.toNumber(it?.leads) || 0), 0);
      const leadsIcp = items.reduce((acc, it) => acc + (utils.toNumber(it?.leadsIcp) || 0), 0);

      return {
        ...g,
        items,
        totals: {
          spend,
          dailyBudget,
          leads,
          leadsIcp,
          cpl: utils.safeDivide(spend, leads),
          cplIcp: utils.safeDivide(spend, leadsIcp),
        },
        hasActive: items.some((it) => String(it?.status?.key || "").toUpperCase() === "ACTIVE"),
        hasPaused: items.some((it) => String(it?.status?.key || "").toUpperCase() === "PAUSED"),
      };
    })
    .filter(Boolean);
}

function updateSortUI() {
  const key = state.sort?.key;
  const dir = state.sort?.dir;

  const ths = document.querySelectorAll('th.th-sortable[data-sort-key]');
  ths.forEach((th) => {
    const k = String(th.getAttribute('data-sort-key') || "");

    if (k && k === key && (dir === "asc" || dir === "desc")) {
      th.classList.add("is-sorted");
      th.setAttribute("data-sort-dir", dir);
      th.setAttribute("aria-sort", dir === "asc" ? "ascending" : "descending");
      return;
    }

    th.classList.remove("is-sorted");
    th.removeAttribute("data-sort-dir");
    th.setAttribute("aria-sort", "none");
  });
}

function compareNullableNumber(aVal, bVal, dir) {
  const a = utils.toNumber(aVal);
  const b = utils.toNumber(bVal);

  const aNull = a === null;
  const bNull = b === null;

  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;

  if (a === b) return 0;
  return dir === "asc" ? a - b : b - a;
}

function applySorting(groups) {
  const key = state.sort?.key;
  const dir = state.sort?.dir;

  if (!key || (dir !== "asc" && dir !== "desc")) return groups;

  const sorted = groups.map((g) => ({
    ...g,
    items: Array.isArray(g.items) ? [...g.items] : [],
    totals: { ...g.totals },
  }));

  sorted.sort((a, b) => {
    const cmp = compareNullableNumber(a?.totals?.[key], b?.totals?.[key], dir);
    if (cmp !== 0) return cmp;
    return String(a.campaignName).localeCompare(String(b.campaignName), "pt-BR");
  });

  for (const g of sorted) {
    g.items.sort((a, b) => {
      const cmp = compareNullableNumber(a?.[key], b?.[key], dir);
      if (cmp !== 0) return cmp;
      return String(a.name).localeCompare(String(b.name), "pt-BR");
    });
  }

  return sorted;
}

function expanderButton(id) {
  const expanded = state.expanded.has(String(id));
  return `<button class="expander" type="button" data-action="toggle" data-id="${String(id).replace(/"/g, "&quot;")}" aria-expanded="${expanded}">
    ${expanded ? "–" : "+"}
  </button>`;
}

function updateAdsetKPIs(groups) {
  const totals = { total: 0, active: 0, paused: 0 };

  for (const g of groups || []) {
    const items = Array.isArray(g?.items) ? g.items : [];
    totals.total += items.length;

    for (const it of items) {
      const key = String(it?.status?.key || "").toUpperCase();
      if (key === "ACTIVE") totals.active += 1;
      else if (key === "PAUSED") totals.paused += 1;
    }
  }

  if (elements.kpiAdsetsTotal) elements.kpiAdsetsTotal.textContent = formatters.number.format(totals.total);
  if (elements.kpiAdsetsActive) elements.kpiAdsetsActive.textContent = formatters.number.format(totals.active);
  if (elements.kpiAdsetsPaused) elements.kpiAdsetsPaused.textContent = formatters.number.format(totals.paused);
}

function render() {
  if (!elements.body) return;

  updateSortUI();

  const filtered = applyFilters(state.groups);
  updateAdsetKPIs(filtered);

  const data = applySorting(filtered);

  if (!data.length) {
    elements.body.innerHTML = ui.emptyState("Sem dados", 7);
    return;
  }

  const rows = [];
  for (const group of data) {
    rows.push(`
  <tr class="group-row" data-campaign-id="${String(group.campaignId).replace(/"/g, "&quot;")}">
    <td>
      <div class="name-cell">
        ${expanderButton(group.campaignId)}
        <span class="name-cell__label">${group.campaignName}</span>
      </div>
    </td>
    <td>${utils.formatCurrency(group.totals.spend)}</td>
    <td>${utils.formatCurrency(group.totals.dailyBudget)}</td>
    <td>${utils.formatNumber(group.totals.leads)}</td>
    <td>${utils.formatNumber(group.totals.leadsIcp)}</td>
    <td>${utils.formatCurrency(group.totals.cpl)}</td>
    <td>${utils.formatCurrency(group.totals.cplIcp)}</td>
  </tr>
`);

    const isExpanded = state.expanded.has(String(group.campaignId));
    if (isExpanded) {
      if (!group.items.length) {
        rows.push(`
          <tr class="child-row" data-parent="${String(group.campaignId).replace(/"/g, "&quot;")}">
            <td colspan="7" class="text-muted">Sem registros dentro desta campanha.</td>
          </tr>
        `);
      } else {
        for (const item of group.items) {
          rows.push(`
  <tr class="child-row" data-parent="${String(group.campaignId).replace(/"/g, "&quot;")}">
    <td>
      <div class="name-cell name-cell--child">
        <span class="name-cell__label">${item.name}</span>
      </div>
    </td>
    <td>${utils.formatCurrency(item.spend)}</td>
    <td>${utils.formatCurrency(item.dailyBudget)}</td>
    <td>${utils.formatNumber(item.leads)}</td>
    <td>${utils.formatNumber(item.leadsIcp)}</td>
    <td>${utils.formatCurrency(item.cpl)}</td>
    <td>${utils.formatCurrency(item.cplIcp)}</td>
  </tr>
`);
        }
      }
    }
  }

  const totals = data.reduce(
    (acc, g) => {
      acc.spend += utils.toNumber(g?.totals?.spend) || 0;
      acc.dailyBudget += utils.toNumber(g?.totals?.dailyBudget) || 0;
      acc.leads += utils.toNumber(g?.totals?.leads) || 0;
      acc.leadsIcp += utils.toNumber(g?.totals?.leadsIcp) || 0;
      return acc;
    },
    { spend: 0, dailyBudget: 0, leads: 0, leadsIcp: 0 }
  );

  rows.push(`
  <tr class="total-row">
    <td>
      <div class="name-cell">
        <span class="expander expander--ghost" aria-hidden="true"></span>
        <span class="name-cell__label">Total</span>
      </div>
    </td>
    <td>${utils.formatCurrency(totals.spend)}</td>
    <td>${utils.formatCurrency(totals.dailyBudget)}</td>
    <td>${utils.formatNumber(totals.leads)}</td>
    <td>${utils.formatNumber(totals.leadsIcp)}</td>
    <td>${utils.formatCurrency(utils.safeDivide(totals.spend, totals.leads))}</td>
    <td>${utils.formatCurrency(utils.safeDivide(totals.spend, totals.leadsIcp))}</td>
  </tr>
`);

  elements.body.innerHTML = rows.join("");
}

function fillCampaignSelect(groups) {
  if (!elements.campaignNameFilter) return;

  const current = String(elements.campaignNameFilter.value || "ALL");

  const unique = Array.from(
    new Set(
      groups
        .map((g) => g.campaignName)
        .filter((n) => n && n !== "–" && n !== "-")
    )
  ).sort((a, b) => a.localeCompare(b, "pt-BR"));

  const options = [
    '<option value="ALL">Todos</option>',
    ...unique.map((n) => `<option value="${String(n).replace(/"/g, "&quot;")}">${n}</option>`),
  ];

  elements.campaignNameFilter.innerHTML = options.join("");

  if (unique.includes(current)) elements.campaignNameFilter.value = current;
  else elements.campaignNameFilter.value = "ALL";
}

async function loadData() {
  ui.showLoading();
  const btn = elements.applyFilters;
  const btnOriginalText = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Buscando...";
  }
  try {
    const url = `${CONFIG.ENDPOINT}?_ts=${Date.now()}`;
    const res = await fetch(url);
    const payload = await res.json();

    state.raw = normalizePayload(payload);
    state.groups = buildGroups(state.raw);

    fillCampaignSelect(state.groups);

    state.filters.name = elements.campaignNameFilter?.value || "ALL";
    render();
  } catch (e) {
    ui.showError(`Erro: ${e?.message || "Falha ao carregar dados"}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = btnOriginalText || "Buscar";
    }
    ui.hideLoading();
  }
}

function bindEvents() {
  elements.applyFilters.onclick = async () => {
    state.filters.name = elements.campaignNameFilter?.value || "ALL";
    state.filters.status = elements.statusFilter?.value || "ALL";
    await loadData();
  };

  elements.statusFilter?.addEventListener("change", () => {
    state.filters.status = elements.statusFilter?.value || "ALL";
    render();
  });

  elements.campaignNameFilter?.addEventListener("change", () => {
    state.filters.name = elements.campaignNameFilter?.value || "ALL";
    render();
  });

  elements.clearFilters.onclick = () => {
    elements.campaignNameFilter.value = "ALL";
    elements.statusFilter.value = "ALL";
    state.filters.name = "ALL";
    state.filters.status = "ALL";
    render();
  };

  elements.closeToast.onclick = () => ui.hideError();

  if (elements.sendBudget) {
    elements.sendBudget.onclick = sendBudgetRequest;
  }

  elements.thead?.addEventListener("click", (e) => {
    const btn = e.target.closest("button.th-sort");
    if (!btn) return;

    const key = String(btn.getAttribute("data-sort-key") || "");
    if (!key) return;

    if (state.sort.key === key) {
      state.sort.dir = state.sort.dir === "desc" ? "asc" : "desc";
    } else {
      state.sort.key = key;
      state.sort.dir = "desc";
    }

    render();
  });

  elements.body.addEventListener("click", (e) => {
    const btn = e.target.closest('button[data-action="toggle"]');
    if (!btn) return;

    const id = String(btn.getAttribute("data-id") || "");
    if (!id) return;

    if (state.expanded.has(id)) state.expanded.delete(id);
    else state.expanded.add(id);

    render();
  });
}

function init() {
  bindEvents();
  loadData();
}

document.addEventListener("DOMContentLoaded", init);