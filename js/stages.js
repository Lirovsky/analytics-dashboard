(() => {
  const page = document.documentElement.getAttribute('data-page');
  if (page !== 'stages') return;

  // ========================================
  // Configuration
  // ========================================
  const CONFIG = {
    FUNNEL_ENDPOINT: 'https://n8n.clinicaexperts.com.br/webhook/funnel',
  };

  // ========================================
  // Utilities
  // ========================================
  const utils = {
    getDateString(date) {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
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
  };

  // ========================================
  // DOM Elements (somente Stages)
  // ========================================
  const elements = {
    // Filtro de entrada
    entryStartInput: dom.byId('entryStartDate'),
    entryEndInput: dom.byId('entryEndDate'),
    stageSelect: dom.byId('stageSelect'),

    // Botão
    applyEntryOnly: dom.byId('applyEntryOnly'),

    // Tabelas (funil)
    moneyStatusBody: dom.byId('moneyStatusBody'),
    channelFunnelBody: dom.byId('channelFunnelBody'),

    // UI
    loadingOverlay: dom.byId('loadingOverlay'),
    errorToast: dom.byId('errorToast'),
    errorMessage: dom.byId('errorMessage'),
    closeToast: dom.byId('closeToast'),
  };

  // ========================================
  // State
  // ========================================
  const state = {
    funnelData: null,
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

    async fetchFunnel(paramsObj) {
      const url = this.buildUrl(CONFIG.FUNNEL_ENDPOINT, paramsObj);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    },
  };

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

    funnelTotalRowNoPercent(stage, counts) {
      const cells = counts
        .map((count) => `<td><strong>${utils.formatNumber(count)}</strong></td><td></td>`)
        .join('');

      return `
        <tr class="total-row">
          <td><strong>${stage}</strong></td>
          ${cells}
        </tr>
      `;
    },

    funnelTotalRow(stage, groups) {
      const cells = groups
        .map(
          (g) => `
            <td><strong>${utils.formatNumber(g.count)}</strong></td>
            <td><strong>${utils.formatPercentage(g.percentage)}</strong></td>
          `
        )
        .join('');

      return `
        <tr class="total-row">
          <td><strong>${stage}</strong></td>
          ${cells}
        </tr>
      `;
    },

    buildTotalByChannelCountsOnly(stages) {
      const sumStages = ['Lead', '1ª Interação', 'Apresentação', 'Proposta Enviada', 'Pagamento Pendente', 'Assinatura'];
      const keys = ['google', 'facebook', 'organic'];

      return keys.map((k) => sumStages.reduce((acc, s) => acc + (stages?.[s]?.[k]?.count || 0), 0));
    },

    buildTotalMoneyStatus(stages) {
      const sumStages = ['Lead', '1ª Interação', 'Apresentação', 'Proposta Enviada', 'Pagamento Pendente', 'Assinatura'];

      const allCount = sumStages.reduce((acc, s) => acc + (stages?.[s]?.all?.count || 0), 0);
      const yesCount = sumStages.reduce((acc, s) => acc + (stages?.[s]?.moneyYes?.count || 0), 0);
      const noCount = sumStages.reduce((acc, s) => acc + (stages?.[s]?.moneyNo?.count || 0), 0);

      return [
        { count: allCount, percentage: 100 },
        { count: yesCount, percentage: Number((utils.safeDivide(yesCount, allCount) * 100).toFixed(2)) },
        { count: noCount, percentage: Number((utils.safeDivide(noCount, allCount) * 100).toFixed(2)) },
      ];
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
      const total = this.funnelTotalRow('Total', this.buildTotalMoneyStatus(data.stages));

      elements.moneyStatusBody.innerHTML = rows + conversando + total;
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
      const total = this.funnelTotalRowNoPercent('Total', this.buildTotalByChannelCountsOnly(data.stages));

      elements.channelFunnelBody.innerHTML = rows + conversando + total;
    },
  };

  // ========================================
  // Data loader (Stages)
  // ========================================
  const STAGE_VALUE_MAP = {
    // stages.html usa "Assinou" no select, mas o funil/render usa "Assinatura"
    Assinou: 'Assinatura',
  };

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
      const rawValue = sel?.value?.trim() || '';

      if (rawValue) {
        params.stage = STAGE_VALUE_MAP[rawValue] || rawValue;
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

  // ========================================
  // Dates
  // ========================================
  function initializeDates() {
    const today = utils.today();
    if (elements.entryStartInput) elements.entryStartInput.value = today;
    if (elements.entryEndInput) elements.entryEndInput.value = today;
  }

  // ========================================
  // Events
  // ========================================
  function setupEventListeners() {
    if (elements.closeToast) elements.closeToast.addEventListener('click', () => ui.hideError());

    if (elements.applyEntryOnly) elements.applyEntryOnly.addEventListener('click', loadStages);

    const onEnter = (e) => {
      if (e.key !== 'Enter') return;
      loadStages();
    };

    if (elements.entryStartInput) elements.entryStartInput.addEventListener('keypress', onEnter);
    if (elements.entryEndInput) elements.entryEndInput.addEventListener('keypress', onEnter);
  }

  // ========================================
  // Init
  // ========================================
  function init() {
    initializeDates();
    setupEventListeners();
    loadStages();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
