// ========================================
// Configuration
// ========================================
const CONFIG = {
  CAMPAIGNS_ENDPOINT: 'https://n8n.clinicaexperts.com.br/webhook/campaigns',
  FUNNEL_ENDPOINT: 'https://n8n.clinicaexperts.com.br/webhook/funnel',
  DEFAULT_DAYS_BACK: 0, // 0 = hoje
};

// ========================================
// Utilities
// ========================================
const utils = {
  getDateString(date) {
    return date.toISOString().split('T')[0];
  },
  today() {
    return this.getDateString(new Date());
  },
  formatNumber(value) {
    if (value === null || value === undefined || isNaN(value)) return '–';
    return new Intl.NumberFormat('pt-BR').format(value);
  },
  formatPercentage(value) {
    if (value === null || value === undefined || isNaN(value)) return '–';
    return `${Number(value).toFixed(2)}%`;
  },
  formatCurrency(value) {
    if (value === null || value === undefined || isNaN(value)) return '–';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value));
  },
  formatROAS(value) {
    if (value === null || value === undefined || isNaN(value)) return '–';
    return `${Number(value).toFixed(2)}x`;
  },
  formatDays(value) {
    if (value === null || value === undefined || isNaN(value)) return '–';
    return `${Math.round(Number(value))} dias`;
  },
  safeDivide(numerator, denominator) {
    const n = Number(numerator);
    const d = Number(denominator);
    if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
    return n / d;
  },
};

const dom = {
  byId(id) {
    return document.getElementById(id);
  },
  exists(el) {
    return !!el;
  },
};

// ========================================
// Page detection
// ========================================
const page = document.documentElement.getAttribute('data-page') || 'metrics';
const isStages = page === 'stages';

// ========================================
// DOM Elements
// ========================================
const elements = {
  // Entrada
  entryStartInput: dom.byId('entryStartDate'),
  entryEndInput: dom.byId('entryEndDate'),

  // Stage (stages)
  stageSelect: dom.byId('stageSelect'),

  // Compra (pode existir, mas Stages vai ignorar)
  purchaseStartInput: dom.byId('purchaseStartDateInput'),
  purchaseEndInput: dom.byId('purchaseEndDateInput'),

  // Buttons
  applyFilters: dom.byId('applyFilters'),
  applyEntryOnly: dom.byId('applyEntryOnly'),
  applyPurchaseOnly: dom.byId('applyPurchaseOnly'),
  clearEntryDates: dom.byId('clearEntryDates'),

  // Campaign Tables (métricas)
  facebookBody: dom.byId('facebookBody'),
  googleBody: dom.byId('googleBody'),
  organicBody: dom.byId('organicBody'),

  // Pagination info
  facebookPageInfo: dom.byId('facebookPageInfo'),
  googlePageInfo: dom.byId('googlePageInfo'),
  organicPageInfo: dom.byId('organicPageInfo'),

  // Summary (métricas)
  totalCampaigns: dom.byId('totalCampaigns'),
  totalLeads: dom.byId('totalLeads'),
  totalSales: dom.byId('totalSales'),
  totalValue: dom.byId('totalValue'),
  totalInvestment: dom.byId('totalInvestment'),
  totalRPL: dom.byId('totalRPL'),

  // Funnel Tables (stages)
  moneyStatusBody: dom.byId('moneyStatusBody'),
  channelFunnelBody: dom.byId('channelFunnelBody'),

  // UI
  loadingOverlay: dom.byId('loadingOverlay'),
  errorToast: dom.byId('errorToast'),
  errorMessage: dom.byId('errorMessage'),
  closeToast: dom.byId('closeToast'),
};

// Detecta o que a página precisa
const needs = {
  campaigns:
    dom.exists(elements.facebookBody) ||
    dom.exists(elements.googleBody) ||
    dom.exists(elements.organicBody) ||
    dom.exists(elements.totalCampaigns),

  funnel:
    dom.exists(elements.moneyStatusBody) ||
    dom.exists(elements.channelFunnelBody),
};

// ========================================
// State
// ========================================
const state = {
  sort: { key: null, direction: 'desc' },
  campaignsData: null,
  funnelData: null,

  // Paginação por tabela (somente métricas)
  pagination: {
    facebook: { page: 1, pageSize: 10 },
    google: { page: 1, pageSize: 10 },
    organic: { page: 1, pageSize: 10 },
  },
};

// ========================================
// UI Helpers
// ========================================
const ui = {
  showLoading() {
    if (elements.loadingOverlay) elements.loadingOverlay.classList.add('active');
  },
  hideLoading() {
    if (elements.loadingOverlay) elements.loadingOverlay.classList.remove('active');
  },
  showError(message) {
    if (!elements.errorToast || !elements.errorMessage) return;
    elements.errorMessage.textContent = message;
    elements.errorToast.classList.add('active');
    setTimeout(() => this.hideError(), 4500);
  },
  hideError() {
    if (!elements.errorToast) return;
    elements.errorToast.classList.remove('active');
  },
  renderSkeleton(count = 6, colspan = 7) {
    return Array(count)
      .fill(0)
      .map(
        () =>
          `<tr><td colspan="${colspan}"><div class="skeleton" style="width:100%;height:20px;"></div></td></tr>`
      )
      .join('');
  },
  renderEmptyState(message = 'Sem dados', colspan = 7) {
    return `
      <tr>
        <td colspan="${colspan}">
          <div class="empty-state">
            <div class="empty-state__icon">📊</div>
            <p>${message}</p>
          </div>
        </td>
      </tr>
    `;
  },
};

// ========================================
// API
// ========================================
const api = {
  buildUrl(base, paramsObj) {
    const params = new URLSearchParams();
    Object.entries(paramsObj || {}).forEach(([k, v]) => {
      if (v !== null && v !== undefined && String(v).trim() !== '') params.set(k, v);
    });
    params.set('_ts', Date.now());
    return `${base}?${params.toString()}`;
  },

  async fetchCampaigns(paramsObj) {
    const url = this.buildUrl(CONFIG.CAMPAIGNS_ENDPOINT, paramsObj);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  },

  async fetchFunnel(paramsObj) {
    const url = this.buildUrl(CONFIG.FUNNEL_ENDPOINT, paramsObj);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  },
};

// ========================================
// Pagination helpers (métricas)
// ========================================
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function paginate(items, page, pageSize) {
  const totalItems = Array.isArray(items) ? items.length : 0;
  const ps = Math.max(1, Number(pageSize) || 10);
  const totalPages = Math.max(1, Math.ceil(totalItems / ps));
  const p = clamp(Number(page) || 1, 1, totalPages);

  const start = (p - 1) * ps;
  const end = start + ps;
  const slice = (items || []).slice(start, end);

  return { slice, page: p, pageSize: ps, totalItems, totalPages };
}

function updatePaginationUI(channel, meta) {
  // Atualiza texto "X / Y"
  const infoEl =
    channel === 'facebook'
      ? elements.facebookPageInfo
      : channel === 'google'
        ? elements.googlePageInfo
        : elements.organicPageInfo;

  if (infoEl) infoEl.textContent = `${meta.page} / ${meta.totalPages}`;

  // Ativa/desativa botões baseado em data-channel
  document.querySelectorAll(`.pagination[data-channel="${channel}"] .pg-btn`).forEach((btn) => {
    const action = btn.getAttribute('data-action');
    if (action === 'prev') btn.disabled = meta.page <= 1;
    if (action === 'next') btn.disabled = meta.page >= meta.totalPages;
  });
}

function resetPaginationToFirstPage() {
  state.pagination.facebook.page = 1;
  state.pagination.google.page = 1;
  state.pagination.organic.page = 1;
}

// ========================================
// Sorting (métricas)
// ========================================
function getSortableValue(item, key) {
  const raw = item?.[key];
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === 'number') return raw;

  const s = String(raw).trim();
  const normalized = s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function sortCampaigns(items) {
  const { key, direction } = state.sort;
  if (!key || !Array.isArray(items)) return items || [];
  const dir = direction === 'asc' ? 1 : -1;

  return [...items].sort((a, b) => {
    const aVal = getSortableValue(a, key);
    const bVal = getSortableValue(b, key);
    if (aVal === bVal) return 0;
    return aVal > bVal ? dir : -dir;
  });
}

function updateSortIcons(activeTh) {
  document.querySelectorAll('.data-table th[data-sort]').forEach((h) => {
    h.classList.remove('active');
    const icon = h.querySelector('.sort-icon');
    if (icon) icon.textContent = '↕';
  });

  if (!activeTh) return;
  activeTh.classList.add('active');
  const icon = activeTh.querySelector('.sort-icon');
  if (icon) icon.textContent = state.sort.direction === 'asc' ? '↑' : '↓';
}

// ========================================
// Render: FUNNEL (Stages)
// ========================================
const funnelRender = {
  funnelRow(stage, groups, highlight = false) {
    const cls = highlight ? 'row-subscription' : '';
    const cells = groups
      .map(
        (g) => `
        <td>${utils.formatNumber(g.count)}</td>
        <td>${utils.formatPercentage(g.percentage)}</td>
      `
      )
      .join('');

    return `
      <tr class="${cls}">
        <td>${stage}</td>
        ${cells}
      </tr>
    `;
  },

  buildConversandoMoneyStatus(stages) {
    const sumStages = ['Apresentação', 'Proposta Enviada', 'Pagamento Pendente', 'Assinatura'];
    const keys = ['all', 'moneyYes', 'moneyNo'];

    return keys.map((k) => {
      const pct = sumStages.reduce((acc, s) => acc + (stages?.[s]?.[k]?.percentage || 0), 0);
      const count = sumStages.reduce((acc, s) => acc + (stages?.[s]?.[k]?.count || 0), 0);
      return { count, percentage: Number(pct.toFixed(2)) };
    });
  },

  buildConversandoByChannel(stages) {
    const sumStages = ['Apresentação', 'Proposta Enviada', 'Pagamento Pendente', 'Assinatura'];
    const keys = ['google', 'facebook', 'organic'];

    return keys.map((k) => {
      const pct = sumStages.reduce((acc, s) => acc + (stages?.[s]?.[k]?.percentage || 0), 0);
      const count = sumStages.reduce((acc, s) => acc + (stages?.[s]?.[k]?.count || 0), 0);
      return { count, percentage: Number(pct.toFixed(2)) };
    });
  },

  moneyStatusTable(data) {
    if (!elements.moneyStatusBody) return;

    if (!data?.stages) {
      elements.moneyStatusBody.innerHTML = ui.renderEmptyState('Sem dados de funil', 7);
      return;
    }

    const stages = ['Lead', '1ª Interação', 'Apresentação', 'Proposta Enviada', 'Pagamento Pendente', 'Assinatura'];

    const rows = stages
      .map((stage) => {
        const s = data.stages[stage] || {};
        const groups = [
          s.all || { count: 0, percentage: 0 },
          s.moneyYes || { count: 0, percentage: 0 },
          s.moneyNo || { count: 0, percentage: 0 },
        ];
        return this.funnelRow(stage, groups, stage === 'Assinatura');
      })
      .join('');

    const conversando = this.funnelRow('Conversando', this.buildConversandoMoneyStatus(data.stages));
    elements.moneyStatusBody.innerHTML = rows + conversando;
  },

  channelTable(data) {
    if (!elements.channelFunnelBody) return;

    if (!data?.stages) {
      elements.channelFunnelBody.innerHTML = ui.renderEmptyState('Sem dados de funil', 7);
      return;
    }

    const stages = ['Lead', '1ª Interação', 'Apresentação', 'Proposta Enviada', 'Pagamento Pendente', 'Assinatura'];

    const rows = stages
      .map((stage) => {
        const s = data.stages[stage] || {};
        const groups = [
          s.google || { count: 0, percentage: 0 },
          s.facebook || { count: 0, percentage: 0 },
          s.organic || { count: 0, percentage: 0 },
        ];
        return this.funnelRow(stage, groups, stage === 'Assinatura');
      })
      .join('');

    const conversando = this.funnelRow('Conversando', this.buildConversandoByChannel(data.stages));
    elements.channelFunnelBody.innerHTML = rows + conversando;
  },
};

// ========================================
// Render: CAMPAIGNS (Métricas) + Paginação
// ========================================
const campaignsRender = {
  campaignRow(campaign, includeInvestment = true) {
    const value = Number(campaign.value) || 0;
    const sales = Number(campaign.sales) || 0;
    const leads = Number(campaign.leads) || 0;

    const ticketMedio = utils.safeDivide(value, sales);
    const rpl = utils.safeDivide(value, leads);

    const valueClass = value > 0 ? 'value-positive' : '';
    const roasClass = (Number(campaign.roas) || 0) >= 1 ? 'value-positive' : 'value-negative';

    if (includeInvestment) {
      return `
        <tr>
          <td>${campaign.name || campaign.tag || '–'}</td>
          <td>${utils.formatNumber(leads)}</td>
          <td>${utils.formatNumber(sales)}</td>
          <td class="${valueClass}">${utils.formatCurrency(value)}</td>
          <td>${utils.formatCurrency(ticketMedio)}</td>
          <td>${utils.formatCurrency(rpl)}</td>
          <td>${utils.formatCurrency(campaign.investment)}</td>
          <td class="${roasClass}">${utils.formatROAS(campaign.roas)}</td>
          <td>${utils.formatCurrency(campaign.cac)}</td>
          <td>${utils.formatDays(campaign.avg_time_to_purchase_days)}</td>
        </tr>
      `;
    }

    return `
      <tr>
        <td>${campaign.name || campaign.tag || '–'}</td>
        <td>${utils.formatNumber(leads)}</td>
        <td>${utils.formatNumber(sales)}</td>
        <td class="${valueClass}">${utils.formatCurrency(value)}</td>
        <td>${utils.formatCurrency(ticketMedio)}</td>
        <td>${utils.formatCurrency(rpl)}</td>
        <td>${utils.formatDays(campaign.avg_time_to_purchase_days)}</td>
      </tr>
    `;
  },

  campaignTotalRow({ leads = 0, sales = 0, value = 0, investment = 0 }, includeInvestment = true, avgDaysTotal = null) {
    const roas = investment > 0 ? value / investment : null;
    const cac = sales > 0 ? investment / sales : null;

    const ticketMedioTotal = utils.safeDivide(value, sales);
    const rplTotal = utils.safeDivide(value, leads);

    if (includeInvestment) {
      return `
        <tr class="total-row">
          <td><strong>Total</strong></td>
          <td><strong>${utils.formatNumber(leads)}</strong></td>
          <td><strong>${utils.formatNumber(sales)}</strong></td>
          <td><strong>${utils.formatCurrency(value)}</strong></td>
          <td><strong>${utils.formatCurrency(ticketMedioTotal)}</strong></td>
          <td><strong>${utils.formatCurrency(rplTotal)}</strong></td>
          <td><strong>${utils.formatCurrency(investment)}</strong></td>
          <td><strong>${utils.formatROAS(roas)}</strong></td>
          <td><strong>${utils.formatCurrency(cac)}</strong></td>
          <td><strong>${utils.formatDays(avgDaysTotal)}</strong></td>
        </tr>
      `;
    }

    return `
      <tr class="total-row">
        <td><strong>Total</strong></td>
        <td><strong>${utils.formatNumber(leads)}</strong></td>
        <td><strong>${utils.formatNumber(sales)}</strong></td>
        <td><strong>${utils.formatCurrency(value)}</strong></td>
        <td><strong>${utils.formatCurrency(ticketMedioTotal)}</strong></td>
        <td><strong>${utils.formatCurrency(rplTotal)}</strong></td>
        <td><strong>${utils.formatDays(avgDaysTotal)}</strong></td>
      </tr>
    `;
  },

  campaignTables(data) {
    if (!needs.campaigns) return;

    const renderWithTotalPaginated = (channel, items, bodyEl, includeInvestment) => {
      if (!bodyEl) return;

      const baseItems = Array.isArray(items) ? items : [];
      const enriched = baseItems.map((c) => {
        const v = Number(c.value) || 0;
        const s = Number(c.sales) || 0;
        const l = Number(c.leads) || 0;
        return { ...c, ticket_medio: utils.safeDivide(v, s), rpl: utils.safeDivide(v, l) };
      });

      const sorted = sortCampaigns(enriched);

      if (!sorted.length) {
        bodyEl.innerHTML = ui.renderEmptyState('Sem dados', includeInvestment ? 10 : 7);
        updatePaginationUI(channel, { page: 1, totalPages: 1 });
        return;
      }

      // Totais SEMPRE no dataset completo (não na página)
      const totals = sorted.reduce(
        (acc, c) => {
          const leads = Number(c.leads) || 0;
          const sales = Number(c.sales) || 0;
          const value = Number(c.value) || 0;
          const inv = Number(c.investment) || 0;

          acc.leads += leads;
          acc.sales += sales;
          acc.value += value;
          acc.investment += inv;

          const avgRaw = c.avg_time_to_purchase_days;
          const avg = avgRaw === null || avgRaw === undefined ? null : Number(avgRaw);
          if (sales > 0 && Number.isFinite(avg)) {
            acc.avgDaysWeightedSum += avg * sales;
            acc.avgDaysWeight += sales;
          }
          return acc;
        },
        { leads: 0, sales: 0, value: 0, investment: 0, avgDaysWeightedSum: 0, avgDaysWeight: 0 }
      );

      const avgDaysTotal = totals.avgDaysWeight > 0 ? totals.avgDaysWeightedSum / totals.avgDaysWeight : null;

      // Paginação visual
      const { page, pageSize } = state.pagination[channel];
      const meta = paginate(sorted, page, pageSize);

      // Sincroniza page clampado no state (caso tenha reduzido páginas)
      state.pagination[channel].page = meta.page;

      // Renderiza apenas a página + linha total
      bodyEl.innerHTML =
        meta.slice.map((c) => this.campaignRow(c, includeInvestment)).join('') +
        this.campaignTotalRow(totals, includeInvestment, avgDaysTotal);

      updatePaginationUI(channel, meta);
    };

    renderWithTotalPaginated('facebook', data?.facebook, elements.facebookBody, true);
    renderWithTotalPaginated('google', data?.google, elements.googleBody, true);
    renderWithTotalPaginated('organic', data?.organic, elements.organicBody, false);
  },

  summary(data) {
    if (!needs.campaigns || !elements.totalCampaigns) return;

    const fb = data?.facebook || [];
    const gg = data?.google || [];
    const org = data?.organic || [];
    const all = [...fb, ...gg, ...org];

    const totals = all.reduce(
      (acc, c) => {
        acc.campaigns += 1;
        acc.leads += Number(c.leads) || 0;
        acc.sales += Number(c.sales) || 0;
        acc.value += Number(c.value) || 0;
        acc.investment += Number(c.investment) || 0;
        return acc;
      },
      { campaigns: 0, leads: 0, sales: 0, value: 0, investment: 0 }
    );

    elements.totalCampaigns.textContent = utils.formatNumber(totals.campaigns);
    if (elements.totalLeads) elements.totalLeads.textContent = utils.formatNumber(totals.leads);
    if (elements.totalSales) elements.totalSales.textContent = utils.formatNumber(totals.sales);
    if (elements.totalValue) elements.totalValue.textContent = utils.formatCurrency(totals.value);
    if (elements.totalInvestment) elements.totalInvestment.textContent = utils.formatCurrency(totals.investment);

    if (elements.totalRPL) {
      const rpl = utils.safeDivide(totals.value, totals.leads);
      elements.totalRPL.textContent = utils.formatCurrency(rpl);
    }
  },
};

// ========================================
// Data loaders
// ========================================
async function loadStages() {
  const entryStart = elements.entryStartInput?.value || '';
  const entryEnd = elements.entryEndInput?.value || '';

  if (!entryStart || !entryEnd) {
    ui.showError('Selecione as datas de entrada');
    return;
  }

  ui.showLoading();
  if (elements.moneyStatusBody) elements.moneyStatusBody.innerHTML = ui.renderSkeleton(6, 7);
  if (elements.channelFunnelBody) elements.channelFunnelBody.innerHTML = ui.renderSkeleton(6, 7);

  try {
    const params = { entry_start: entryStart, entry_end: entryEnd };

    const sel = elements.stageSelect;
    const label = sel?.selectedOptions?.[0]?.text?.trim() || '';
    const value = sel?.value?.trim() || '';

    if (value !== '' && label && label.toLowerCase() !== 'todos') {
      params.stage = label;
    }

    const res = await api.fetchFunnel(params);
    const payload = Array.isArray(res) ? res[0] : res;

    state.funnelData = payload;

    funnelRender.moneyStatusTable(payload?.moneyStatus || null);
    funnelRender.channelTable(payload?.byChannel || null);
  } catch (e) {
    ui.showError(`Failed to load funnel: ${e.message}`);
    if (elements.moneyStatusBody) elements.moneyStatusBody.innerHTML = ui.renderEmptyState('Erro ao carregar', 7);
    if (elements.channelFunnelBody) elements.channelFunnelBody.innerHTML = ui.renderEmptyState('Erro ao carregar', 7);
  } finally {
    ui.hideLoading();
  }
}

async function loadMetrics(mode = 'both') {
  const entryStart = elements.entryStartInput?.value || '';
  const entryEnd = elements.entryEndInput?.value || '';
  const purchaseStart = elements.purchaseStartInput?.value || '';
  const purchaseEnd = elements.purchaseEndInput?.value || '';

  if (mode === 'both') {
    if (!entryStart || !entryEnd || !purchaseStart || !purchaseEnd) {
      ui.showError('Selecione as datas de entrada e de compra');
      return;
    }
  } else if (mode === 'entry') {
    if (!entryStart || !entryEnd) {
      ui.showError('Selecione as datas de entrada');
      return;
    }
  } else if (mode === 'purchase') {
    if (!purchaseStart || !purchaseEnd) {
      ui.showError('Selecione as datas de compra');
      return;
    }
  }

  const paramsObj = {};
  if (mode === 'both' || mode === 'entry') {
    paramsObj.entry_start = entryStart;
    paramsObj.entry_end = entryEnd;
  }
  if (mode === 'both' || mode === 'purchase') {
    paramsObj.purchase_start = purchaseStart;
    paramsObj.purchase_end = purchaseEnd;
  }

  ui.showLoading();
  if (elements.facebookBody) elements.facebookBody.innerHTML = ui.renderSkeleton(3, 10);
  if (elements.googleBody) elements.googleBody.innerHTML = ui.renderSkeleton(3, 10);
  if (elements.organicBody) elements.organicBody.innerHTML = ui.renderSkeleton(3, 7);

  try {
    const res = await api.fetchCampaigns(paramsObj);
    const payload = Array.isArray(res) ? res[0] : res;

    state.campaignsData = payload;

    // Se mudou filtro/carregou dados novos, começa na página 1
    resetPaginationToFirstPage();

    campaignsRender.campaignTables(payload || { facebook: [], google: [], organic: [] });
    campaignsRender.summary(payload || {});

    const active = document.querySelector(`.data-table th[data-sort].active`);
    updateSortIcons(active);
  } catch (e) {
    ui.showError(`Failed to load campaigns: ${e.message}`);
    campaignsRender.campaignTables({ facebook: [], google: [], organic: [] });
    campaignsRender.summary({ facebook: [], google: [], organic: [] });
  } finally {
    ui.hideLoading();
  }
}

// ========================================
// Dates
// ========================================
function initializeDates() {
  const today = utils.today();

  if (elements.entryStartInput) elements.entryStartInput.value = today;
  if (elements.entryEndInput) elements.entryEndInput.value = today;

  if (elements.purchaseStartInput) elements.purchaseStartInput.value = today;
  if (elements.purchaseEndInput) elements.purchaseEndInput.value = today;
}

function clearDatesStages() {
  const today = utils.today();
  if (elements.entryStartInput) elements.entryStartInput.value = today;
  if (elements.entryEndInput) elements.entryEndInput.value = today;
  loadStages();
}

function clearDatesMetrics() {
  if (elements.entryStartInput) elements.entryStartInput.value = '2025-01-01';
  if (elements.entryEndInput) elements.entryEndInput.value = utils.today();
}

// ========================================
// Events
// ========================================
function setupPaginationListeners() {
  // Event delegation nos containers .pagination (somente métricas)
  document.querySelectorAll('.pagination').forEach((wrap) => {
    wrap.addEventListener('click', (e) => {
      const btn = e.target.closest('button.pg-btn');
      if (!btn) return;

      const channel = wrap.getAttribute('data-channel');
      const action = btn.getAttribute('data-action');
      if (!channel || !action) return;

      if (!state.pagination[channel]) return;

      if (action === 'prev') state.pagination[channel].page -= 1;
      if (action === 'next') state.pagination[channel].page += 1;

      if (state.campaignsData) campaignsRender.campaignTables(state.campaignsData);
    });

    const select = wrap.querySelector('select.pg-size');
    if (select) {
      select.addEventListener('change', () => {
        const channel = wrap.getAttribute('data-channel');
        const size = Number(select.value) || 10;

        if (!state.pagination[channel]) return;
        state.pagination[channel].pageSize = size;
        state.pagination[channel].page = 1;

        if (state.campaignsData) campaignsRender.campaignTables(state.campaignsData);
      });
    }
  });
}

function setupEventListeners() {
  if (elements.closeToast) elements.closeToast.addEventListener('click', () => ui.hideError());

  // Limpar
  if (elements.clearEntryDates) {
    elements.clearEntryDates.addEventListener('click', () => {
      if (isStages) clearDatesStages();
      else {
        clearDatesMetrics();
      }
    });
  }

  // Botões
  if (isStages) {
    if (elements.applyEntryOnly) elements.applyEntryOnly.addEventListener('click', loadStages);
    if (elements.applyPurchaseOnly) elements.applyPurchaseOnly.addEventListener('click', loadStages);
    if (elements.applyFilters) elements.applyFilters.addEventListener('click', loadStages);
  } else {
    if (elements.applyEntryOnly) elements.applyEntryOnly.addEventListener('click', () => loadMetrics('entry'));
    if (elements.applyPurchaseOnly) elements.applyPurchaseOnly.addEventListener('click', () => loadMetrics('purchase'));
    if (elements.applyFilters) elements.applyFilters.addEventListener('click', () => loadMetrics('both'));
  }

  // Enter
  const onEnter = (e) => {
    if (e.key !== 'Enter') return;
    if (isStages) loadStages();
    else loadMetrics('both');
  };

  if (elements.entryStartInput) elements.entryStartInput.addEventListener('keypress', onEnter);
  if (elements.entryEndInput) elements.entryEndInput.addEventListener('keypress', onEnter);

  // Sort (somente métricas)
  if (!isStages) {
    document.querySelectorAll('.data-table th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;

        if (state.sort.key === key) state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc';
        else {
          state.sort.key = key;
          state.sort.direction = 'desc';
        }

        updateSortIcons(th);

        // Ao ordenar, volta para primeira página (por UX)
        resetPaginationToFirstPage();

        if (state.campaignsData) {
          campaignsRender.campaignTables(state.campaignsData);
        }
      });
    });

    // Paginação (somente métricas)
    setupPaginationListeners();
  }
}

// ========================================
// Init
// ========================================
function init() {
  initializeDates();
  setupEventListeners();

  if (isStages) {
    loadStages();
  } else {
    loadMetrics('both');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
