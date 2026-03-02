const CONFIG = {
  ENDPOINT: "https://n8n.clinicaexperts.com.br/webhook/gerenciador",
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

    // aceita "195.82" ou "195,82"
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

  pickLeads(item) {
    const leads = this.toNumber(item?.count_utm_term_adset);
    if (leads !== null) return leads;

    const alt = this.toNumber(item?.leads);
    if (alt !== null) return alt;

    return 0;
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

  // KPIs (Conjuntos)
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

const state = {
  raw: [],
  groups: [],
  expanded: new Set(),
  filters: {
    name: "ALL",
    status: "ALL",
  },
  sort: {
    // key: 'spend' | 'leads' | 'cpl'
    key: null,
    // dir: 'asc' | 'desc'
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
  emptyState(message = "Sem dados", colspan = 5) {
    return `<tr><td colspan="${colspan}"><div class="empty-state"><p>${message}</p></div></td></tr>`;
  },
};

function normalizePayload(payload) {
  const root = Array.isArray(payload) ? payload[0] : payload;
  const list = root?.campanhas ?? root?.campaigns ?? root?.data ?? (Array.isArray(root) ? root : null) ?? [];
  return Array.isArray(list) ? list : [];
}

function buildGroups(items) {
  const byId = new Map();

  for (const item of items) {
    const campaignId = utils.pickCampaignId(item);
    const campaignName = utils.pickCampaignName(item);

    const node =
      byId.get(campaignId) ||
      {
        campaignId,
        campaignName,
        items: [],
        totals: { spend: 0, leads: 0 },
        hasActive: false,
        hasPaused: false,
      };

    const spend = utils.pickSpend(item);
    const leads = utils.pickLeads(item);

    const status = utils.mapStatus(item?.status);
    if (status.key === "ACTIVE") node.hasActive = true;
    if (status.key === "PAUSED") node.hasPaused = true;

    node.totals.spend += spend || 0;
    node.totals.leads += leads || 0;

    node.items.push({
      name: item?.name ?? "–",
      status,
      spend: spend || 0,
      leads: leads || 0,
      cpl: utils.safeDivide(spend, leads),
    });

    byId.set(campaignId, node);
  }

  const groups = Array.from(byId.values()).map((g) => ({
    campaignId: g.campaignId,
    campaignName: g.campaignName,
    totals: {
      spend: g.totals.spend,
      leads: g.totals.leads,
      cpl: utils.safeDivide(g.totals.spend, g.totals.leads),
    },
    items: g.items,
    hasActive: g.hasActive,
    hasPaused: g.hasPaused,
  }));

  // default: A-Z por campanha
  groups.sort((a, b) => a.campaignName.localeCompare(b.campaignName, "pt-BR"));

  // default: A-Z por conjunto (dentro da campanha)
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

      // filtra os conjuntos (itens) pelo status
      if (statusFilter !== "ALL") {
        items = items.filter((it) => String(it?.status?.key || "").toUpperCase() === statusFilter);
      }

      // se não sobrou nenhum item, remove a campanha da lista
      if (!items.length) return null;

      // recalcula totais com base apenas nos itens visíveis
      const spend = items.reduce((acc, it) => acc + (utils.toNumber(it?.spend) || 0), 0);
      const leads = items.reduce((acc, it) => acc + (utils.toNumber(it?.leads) || 0), 0);

      return {
        ...g,
        items,
        totals: {
          spend,
          leads,
          cpl: utils.safeDivide(spend, leads),
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

  // null sempre vai para o final
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

  // clone raso para não mutar state.groups
  const sorted = groups.map((g) => ({
    ...g,
    items: Array.isArray(g.items) ? [...g.items] : [],
    totals: { ...g.totals },
  }));

  // ordena campanhas pelo total
  sorted.sort((a, b) => {
    const cmp = compareNullableNumber(a?.totals?.[key], b?.totals?.[key], dir);
    if (cmp !== 0) return cmp;
    return String(a.campaignName).localeCompare(String(b.campaignName), "pt-BR");
  });

  // ordena itens dentro de cada campanha pelo mesmo critério
  for (const g of sorted) {
    g.items.sort((a, b) => {
      const cmp = compareNullableNumber(a?.[key], b?.[key], dir);
      if (cmp !== 0) return cmp;
      return String(a.name).localeCompare(String(b.name), "pt-BR");
    });
  }

  return sorted;
}

function statusPill(status) {
  if (!status) return `<span class="status-pill status--unknown">–</span>`;
  return `<span class="status-pill ${status.cls}">${status.label}</span>`;
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
    elements.body.innerHTML = ui.emptyState("Sem dados", 5);
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
        <td>${utils.formatNumber(group.totals.leads)}</td>
        <td>${utils.formatCurrency(group.totals.cpl)}</td>
        <td class="text-muted"></td>
      </tr>
    `);

    const isExpanded = state.expanded.has(String(group.campaignId));
    if (isExpanded) {
      if (!group.items.length) {
        rows.push(`
          <tr class="child-row" data-parent="${String(group.campaignId).replace(/"/g, "&quot;")}">
            <td colspan="5" class="text-muted">Sem registros dentro desta campanha.</td>
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
              <td>${utils.formatNumber(item.leads)}</td>
              <td>${utils.formatCurrency(item.cpl)}</td>
              <td>${statusPill(item.status)}</td>
            </tr>
          `);
        }
      }
    }
  }

  // Linha de total (somando apenas o nível de campanha, para não duplicar com os itens expandidos)
  const totals = data.reduce(
    (acc, g) => {
      acc.spend += utils.toNumber(g?.totals?.spend) || 0;
      acc.leads += utils.toNumber(g?.totals?.leads) || 0;
      return acc;
    },
    { spend: 0, leads: 0 }
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
      <td>${utils.formatNumber(totals.leads)}</td>
      <td>${utils.formatCurrency(utils.safeDivide(totals.spend, totals.leads))}</td>
      <td class="text-muted"></td>
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

  // preserva seleção atual (se ainda existir)
  if (unique.includes(current)) elements.campaignNameFilter.value = current;
  else elements.campaignNameFilter.value = "ALL";
}

async function loadData() {
  ui.showLoading();
  try {
    const url = `${CONFIG.ENDPOINT}?_ts=${Date.now()}`;
    const res = await fetch(url);
    const payload = await res.json();

    state.raw = normalizePayload(payload);
    state.groups = buildGroups(state.raw);

    fillCampaignSelect(state.groups);
    render();
  } catch (e) {
    ui.showError(`Erro: ${e?.message || "Falha ao carregar dados"}`);
  } finally {
    ui.hideLoading();
  }
}

function bindEvents() {
  elements.applyFilters.onclick = () => {
    state.filters.name = elements.campaignNameFilter.value || "ALL";
    state.filters.status = elements.statusFilter.value || "ALL";
    render();
  };

  elements.clearFilters.onclick = () => {
    elements.campaignNameFilter.value = "ALL";
    elements.statusFilter.value = "ALL";
    state.filters.name = "ALL";
    state.filters.status = "ALL";
    render();
  };

  elements.closeToast.onclick = () => ui.hideError();

  // Ordenação pelos headers (Spend / Leads / CPL)
  elements.thead?.addEventListener("click", (e) => {
    const btn = e.target.closest("button.th-sort");
    if (!btn) return;

    const key = String(btn.getAttribute("data-sort-key") || "");
    if (!key) return;

    if (state.sort.key === key) {
      state.sort.dir = state.sort.dir === "desc" ? "asc" : "desc";
    } else {
      state.sort.key = key;
      state.sort.dir = "desc"; // 1º clique: maior → menor
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
