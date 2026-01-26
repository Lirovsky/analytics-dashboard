(() => {
  const page = document.documentElement.getAttribute('data-page');
  if (page !== 'dash') return;

  // ========================================
  // Configuration
  // ========================================
  const CONFIG = {
    DASH_ENDPOINT: 'https://n8n.clinicaexperts.com.br/webhook/dash',
    DEFAULT_DAYS_BACK: 0, // 0 = hoje
    MONEY_IS_CENTS: true,
  };

  // ========================================
  // Utilities
  // ========================================
  const utils = {
    getDateString(date) {
      // Formato local YYYY-MM-DD (evita bug de fuso do toISOString)
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    },
    today() {
      return this.getDateString(new Date());
    },
    getDateDaysBack(daysBack = 0) {
      const d = new Date();
      d.setDate(d.getDate() - Number(daysBack || 0));
      return this.getDateString(d);
    },
    firstDayOfMonth() {
      const d = new Date();
      d.setDate(1);
      return this.getDateString(d);
    },


    toNumber(v) {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    },

    normalizeMoney(v) {
      const n = this.toNumber(v);
      return CONFIG.MONEY_IS_CENTS ? (n / 100) : n;
    },

    formatBRL(v) {
      const n = this.toNumber(v);
      return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n);
    },

    formatIntBR(v) {
      const n = this.toNumber(v);
      return new Intl.NumberFormat('pt-BR', {
        maximumFractionDigits: 0,
      }).format(n);
    },

    dateLabel(dateLike) {
      if (!dateLike) return '';
      const s = String(dateLike);
      return s.length >= 10 ? s.slice(0, 10) : s;
    },

    formatDayMonth(dateLike) {
      const iso = this.dateLabel(dateLike);
      // Espera 'YYYY-MM-DD' (ou prefixo disso). Converte para 'DD/MM'.
      const parts = iso.split('-');
      if (parts.length >= 3) {
        const mm = parts[1];
        const dd = String(parts[2]).slice(0, 2);
        return `${dd}/${mm}`;
      }
      return iso;
    },

    getCssVar(name, fallback) {
      try {
        const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return v || fallback;
      } catch (_) {
        return fallback;
      }
    },
    formatPercentBR(v, decimals = 2) {
      const n = this.toNumber(v);
      return (
        new Intl.NumberFormat('pt-BR', {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        }).format(n) + '%'
      );
    },

  };

  const dom = {
    byId(id) {
      return document.getElementById(id);
    },
  };

  // ========================================
  // DOM Elements (Dash)
  // ========================================
  const elements = {
    entryStartInput: dom.byId('entryStartDate'),
    entryEndInput: dom.byId('entryEndDate'),
    applyEntryOnly: dom.byId('applyEntryOnly'),
    clearEntryDates: dom.byId('clearEntryDates'),

    // Vendas
    salesCanvas: dom.byId('salesChart'),
    cacDay: dom.byId('cac-day'),
    cacMonth: dom.byId('cac-month'),
    cacRange: dom.byId('cac-range'),

    // Custo por Leads
    cplCanvas: dom.byId('cplChart'),
    cplMonthValue: dom.byId('cpl-month'),
    cpcValue: dom.byId('cpc'),
    cpmValue: dom.byId('cpm'),


    // Investimento
    investmentCanvas: dom.byId('investmentChart'),
    invMeta: dom.byId('inv-meta'),
    invGoogle: dom.byId('inv-google'),
    invTotal: dom.byId('inv-total'),

    // Leads
    leadsCanvas: dom.byId('leadsChart'),
    leadsTotalValue: dom.byId('leads-month'),

    // KPIs Sidebar
    kpiSubscribers: dom.byId('assistants'),
    kpiSalesDay: dom.byId('sales-day'),
    kpiSalesMonth: dom.byId('sales-month'),
    kpiMonthly: dom.byId('monthly-total'),
    kpiAnnual: dom.byId('annual-total'),
    clicksValue: dom.byId('clicks'),
    ctrValue: dom.byId('ctr'),
    leadsGoalValue: dom.byId('leads-goal'),
    conversionValue: dom.byId('conversion'),

  };

  // ========================================
  // Charts (Chart.js)
  // ========================================
  const charts = {
    investment: null,
    leadsDaily: null,
    salesDaily: null,
    cplDaily: null,

    destroyCplDaily() {
      if (!this.cplDaily) return;
      try { this.cplDaily.destroy(); } catch (_) { }
      this.cplDaily = null;
    },


    destroyInvestment() {
      if (!this.investment) return;
      try { this.investment.destroy(); } catch (_) { }
      this.investment = null;
    },

    destroyLeadsDaily() {
      if (!this.leadsDaily) return;
      try { this.leadsDaily.destroy(); } catch (_) { }
      this.leadsDaily = null;
    },

    destroySalesDaily() {
      if (!this.salesDaily) return;
      try { this.salesDaily.destroy(); } catch (_) { }
      this.salesDaily = null;
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

    async sendDashQuery(paramsObj, abortSignal) {
      const url = this.buildUrl(CONFIG.DASH_ENDPOINT, paramsObj);
      const response = await fetch(url, { signal: abortSignal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    },
  };

  // ========================================
  // State
  // ========================================
  const state = {
    lastParams: null,
    lastResponse: null,
    abortController: null,
    totals: {
      investment_total: 0, // BRL
      leads_total: 0,
      clicks_total: 0,
      impressions_total: 0,
    },
  };

  // ========================================
  // Helpers: normalização do payload (n8n)
  // ========================================
  function normalizeRows(payload) {
    if (Array.isArray(payload)) {
      const first = payload[0];
      if (first && typeof first === 'object' && Array.isArray(first.investment)) return first.investment;
      return payload;
    }

    if (!payload || typeof payload !== 'object') return [];
    if (Array.isArray(payload.investment)) return payload.investment;
    if (Array.isArray(payload.res)) {
      const first = payload.res[0];
      if (first && Array.isArray(first.investment)) return first.investment;
      if (Array.isArray(first)) return first;
    }

    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.items)) return payload.items;
    if (Array.isArray(payload.result)) return payload.result;

    const vals = Object.values(payload);
    if (vals.length && vals.every((v) => v && typeof v === 'object' && !Array.isArray(v))) return vals;

    return [];
  }

  function getFirstResultObject(res) {
    if (res && typeof res === 'object' && Array.isArray(res.res) && res.res[0] && typeof res.res[0] === 'object') {
      return res.res[0];
    }
    if (Array.isArray(res) && res[0] && typeof res[0] === 'object') return res[0];
    if (res && typeof res === 'object') return res;
    return null;
  }

  // ========================================
  // Render: KPIs (Assinantes / Vendas / Planos)
  // ========================================
  function renderKpis(res) {
    const first = getFirstResultObject(res);
    if (!first) return;

    const kpis = first.kpis || {};
    const cacDia = utils.toNumber(kpis.cac_diario);
    if (elements.cacDay) elements.cacDay.textContent = utils.formatBRL(cacDia);
    const cacMes = utils.toNumber(kpis.cac_mes);
    if (elements.cacMonth) elements.cacMonth.textContent = utils.formatBRL(cacMes);
    const cacRange = utils.toNumber(kpis.cac_range);
    if (elements.cacRange) elements.cacRange.textContent = utils.formatBRL(cacRange);

    const subscribersArr = Array.isArray(first.subscribers) ? first.subscribers : [];
    const subscribers = subscribersArr[0] || {};

    const totalSubscribers = utils.toNumber(subscribers.total_subscribers);
    if (elements.kpiSubscribers) elements.kpiSubscribers.textContent = utils.formatIntBR(totalSubscribers);

    const vendasDia = utils.toNumber(kpis.vendas_hoje);
    if (elements.kpiSalesDay) elements.kpiSalesDay.textContent = utils.formatIntBR(vendasDia);

    const vendasMes = utils.toNumber(kpis.vendas_mes);
    if (elements.kpiSalesMonth) elements.kpiSalesMonth.textContent = utils.formatIntBR(vendasMes);

    const mensal = utils.toNumber(kpis.planos_mensais);
    if (elements.kpiMonthly) elements.kpiMonthly.textContent = utils.formatIntBR(mensal);

    const anual = utils.toNumber(kpis.planos_anuais);
    if (elements.kpiAnnual) elements.kpiAnnual.textContent = utils.formatIntBR(anual);

    const conversionPct = utils.toNumber(kpis.conversion_pct);
    if (elements.conversionValue) elements.conversionValue.textContent = utils.formatPercentBR(conversionPct, 2);

  }

  // ========================================
  // Render: Vendas (gráfico sales_daily)
  // ========================================
  function renderSales(res) {
    const first = getFirstResultObject(res);
    if (!first) return;

    const salesDaily = Array.isArray(first.sales_daily) ? first.sales_daily : [];
    renderSalesDailyChart(salesDaily);
  }

  function renderSalesDailyChart(salesDailyRaw) {
    if (!elements.salesCanvas || !window.Chart) return;

    const rows = (Array.isArray(salesDailyRaw) ? salesDailyRaw : [])
      .map((r) => ({
        day: utils.dateLabel(r?.day),
        records_count: utils.toNumber(r?.records_count),
      }))
      .filter((r) => r.day)
      .sort((a, b) => String(a.day).localeCompare(String(b.day)));

    const labels = rows.map((r) => utils.formatDayMonth(r.day));
    const data = rows.map((r) => r.records_count);

    charts.destroySalesDaily();

    const lineColor = utils.getCssVar('--color-purple-dark', utils.getCssVar('--color-purple', '#7c3aed')); // roxo forte



    const ctx = elements.salesCanvas.getContext('2d');
    charts.salesDaily = new window.Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Vendas',
            data,
            tension: 0.25,
            borderColor: lineColor,
            backgroundColor: lineColor,

            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 4,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'bottom' },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const v = utils.toNumber(ctx.parsed?.y);
                return `${ctx.dataset.label}: ${utils.formatIntBR(v)}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { maxRotation: 0, autoSkip: true },
          },
          y: {
            beginAtZero: true,
            ticks: {
              callback: (v) => utils.formatIntBR(v),
            },
          },
        },
      },
    });
  }

  // ========================================
  // Render: Investimento (Facebook x Google)
  // ========================================
  function renderInvestment(rowsRaw) {
    const rows = normalizeRows(rowsRaw)
      .map((r) => ({
        created_at: r?.created_at,
        facebook_amount: utils.normalizeMoney(r?.facebook_amount),
        google_amount: utils.normalizeMoney(r?.google_amount),
      }))
      .filter((r) => r.created_at)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

    // Atualiza cards laterais (soma no período)
    const totalFacebook = rows.reduce((acc, r) => acc + utils.toNumber(r.facebook_amount), 0);
    const totalGoogle = rows.reduce((acc, r) => acc + utils.toNumber(r.google_amount), 0);
    const total = totalFacebook + totalGoogle;

    // Totais do período (para KPIs derivados como CPL/CPC/CPM)
    try { state.totals.investment_total = total; } catch (_) { }

    if (elements.invMeta) elements.invMeta.textContent = utils.formatBRL(totalFacebook);
    if (elements.invGoogle) elements.invGoogle.textContent = utils.formatBRL(totalGoogle);
    if (elements.invTotal) elements.invTotal.textContent = utils.formatBRL(total);

    // Sem canvas ou sem Chart.js
    if (!elements.investmentCanvas || !window.Chart) return;

    const labels = rows.map((r) => utils.formatDayMonth(r.created_at));
    const facebookData = rows.map((r) => utils.toNumber(r.facebook_amount));
    const googleData = rows.map((r) => utils.toNumber(r.google_amount));

    charts.destroyInvestment();

    const facebookColor = utils.getCssVar('--color-facebook-dark', '#3b82f6');
    const googleColor = utils.getCssVar('--color-google-dark', '#f59e0b');

    const ctx = elements.investmentCanvas.getContext('2d');
    charts.investment = new window.Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Meta',
            data: facebookData,
            tension: 0.25,
            borderColor: facebookColor,
            backgroundColor: facebookColor,
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 4,
            fill: false,
          },
          {
            label: 'Google',
            data: googleData,
            tension: 0.35,
            borderColor: googleColor,
            backgroundColor: googleColor,
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 4,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'bottom' },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const v = utils.toNumber(ctx.parsed?.y);
                return `${ctx.dataset.label}: ${utils.formatBRL(v)}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { maxRotation: 0, autoSkip: true },
          },
          y: {
            beginAtZero: true,
            ticks: {
              callback: (v) => utils.formatBRL(v),
            },
          },
        },
      },
    });
  }

  // ========================================
  // Render: Leads (KPI total_leads + gráfico leads_daily)
  // ========================================
  function renderLeads(res) {
    const first = getFirstResultObject(res);
    if (!first) return;

    const kpis = first.kpis || {};

    // KPI: total_leads dentro do card "Leads" da seção Leads
    const totalLeads = utils.toNumber(kpis.total_leads);
    try { state.totals.leads_total = totalLeads; } catch (_) { }
    if (elements.leadsTotalValue) elements.leadsTotalValue.textContent = utils.formatIntBR(totalLeads);

    // KPI: clicks_total (card "Cliques" em Custo por Leads)
    const clicksTotal = utils.toNumber(kpis.clicks_total);
    try { state.totals.clicks_total = clicksTotal; } catch (_) { }

    // (Opcional) Impressões para CPM, se vier no payload
    const impressionsTotal = utils.toNumber(kpis.impressions_total);
    try { state.totals.impressions_total = impressionsTotal; } catch (_) { }
    if (elements.clicksValue) elements.clicksValue.textContent = utils.formatIntBR(clicksTotal);

    // KPI: ctr_pct (card "CTR" em Leads) — já vem em %
    const ctrPct = utils.toNumber(kpis.ctr_pct);
    if (elements.ctrValue) elements.ctrValue.textContent = utils.formatPercentBR(ctrPct, 2);

    // KPI: meta_pct (card "% Meta" em Leads) — vem em %
    const metaPct = utils.toNumber(kpis.meta_pct);
    if (elements.leadsGoalValue) elements.leadsGoalValue.textContent = utils.formatPercentBR(metaPct, 2);


    // Gráfico: leads_daily
    const leadsDaily = Array.isArray(first.leads_daily) ? first.leads_daily : [];
    renderLeadsDailyChart(leadsDaily);
  }


  // ========================================
  // Render: KPIs derivados (CPL/CPC/CPM) — sempre do período filtrado
  // ========================================
  function renderCostKpis() {
    const inv = utils.toNumber(state.totals?.investment_total);
    const leads = utils.toNumber(state.totals?.leads_total);
    const clicks = utils.toNumber(state.totals?.clicks_total);
    const impressions = utils.toNumber(state.totals?.impressions_total);

    // CPL do período = investimento_total / total_leads
    if (elements.cplMonthValue) {
      const cpl = leads > 0 ? (inv / leads) : 0;
      elements.cplMonthValue.textContent = utils.formatBRL(cpl);
    }

    // CPC do período = investimento_total / cliques_total
    if (elements.cpcValue) {
      const cpc = clicks > 0 ? (inv / clicks) : 0;
      elements.cpcValue.textContent = utils.formatBRL(cpc);
    }

    // CPM do período = investimento_total / impressões_total * 1000 (se houver)
    if (elements.cpmValue && impressions > 0) {
      const cpm = (inv / impressions) * 1000;
      elements.cpmValue.textContent = utils.formatBRL(cpm);
    }
  }

  function renderLeadsDailyChart(leadsDailyRaw) {
    if (!elements.leadsCanvas || !window.Chart) return;

    const rows = (Array.isArray(leadsDailyRaw) ? leadsDailyRaw : [])
      .map((r) => ({
        day: utils.dateLabel(r?.day),
        leads_count: utils.toNumber(r?.leads_count),
      }))
      .filter((r) => r.day)
      .sort((a, b) => String(a.day).localeCompare(String(b.day)));

    const labels = rows.map((r) => utils.formatDayMonth(r.day));
    const data = rows.map((r) => r.leads_count);

    charts.destroyLeadsDaily();

    const lineColor = utils.getCssVar('--color-success-dark', utils.getCssVar('--color-success', '#22c55e'));

    const ctx = elements.leadsCanvas.getContext('2d');
    charts.leadsDaily = new window.Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Leads',
            data,
            tension: 0.25,
            borderColor: lineColor,
            backgroundColor: lineColor,
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 4,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'bottom' },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const v = utils.toNumber(ctx.parsed?.y);
                return `${ctx.dataset.label}: ${utils.formatIntBR(v)}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { maxRotation: 0, autoSkip: true },
          },
          y: {
            beginAtZero: true,
            ticks: {
              callback: (v) => utils.formatIntBR(v),
            },
          },
        },
      },
    });
  }

  // ========================================
  // Render: Custo por Leads (gráfico cpl_daily)
  // ========================================
  function renderCpl(res) {
    const first = getFirstResultObject(res);
    if (!first) return;

    const cplDaily = Array.isArray(first.cpl_daily) ? first.cpl_daily : [];
    renderCplDailyChart(cplDaily);
  }

  function renderCplDailyChart(cplDailyRaw) {
    if (!elements.cplCanvas || !window.Chart) return;

    const rows = (Array.isArray(cplDailyRaw) ? cplDailyRaw : [])
      .map((r) => ({
        day: utils.dateLabel(r?.day),
        cpl: utils.toNumber(r?.cpl),
      }))
      .filter((r) => r.day)
      .sort((a, b) => String(a.day).localeCompare(String(b.day)));

    const labels = rows.map((r) => utils.formatDayMonth(r.day));
    const data = rows.map((r) => r.cpl);

    charts.destroyCplDaily();

    const lineColor = utils.getCssVar('--color-warning-dark', utils.getCssVar('--color-warning', '#f50b70')); // amarelo forte



    const ctx = elements.cplCanvas.getContext('2d');
    charts.cplDaily = new window.Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'CPL',
            data,
            tension: 0.25,
            borderColor: lineColor,
            backgroundColor: lineColor,
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 4,
            fill: false,
            borderColor: lineColor,
            backgroundColor: lineColor,

          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'bottom' },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${utils.formatBRL(utils.toNumber(ctx.parsed?.y))}`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } },
          y: {
            beginAtZero: true,
            ticks: { callback: (v) => utils.formatBRL(v) },
          },
        },
      },
    });
  }


  // ========================================
  // Core: enviar datas para n8n
  // ========================================
  async function sendDatesToN8n() {
    const entryStart = elements.entryStartInput?.value || '';
    const entryEnd = elements.entryEndInput?.value || '';

    if (!entryStart || !entryEnd) {
      console.warn('[dash] Datas não preenchidas (entry_start/entry_end).');
      return;
    }

    // Cancela request anterior se o usuário clicar várias vezes
    if (state.abortController) {
      try { state.abortController.abort(); } catch (_) { }
    }
    state.abortController = new AbortController();

    const params = { entry_start: entryStart, entry_end: entryEnd };
    state.lastParams = params;

    try {
      const res = await api.sendDashQuery(params, state.abortController.signal);

      // Debug
      state.lastResponse = res;
      window.__dashLastParams = params;
      window.__dashLastResponse = res;

      // KPIs Sidebar
      renderKpis(res);

      // Investimento (facebook_amount / google_amount)
      const investmentRaw =
        (res && Array.isArray(res.res) && res.res[0] && Array.isArray(res.res[0].investment))
          ? res.res[0].investment
          : (res?.investment ?? res);

      renderInvestment(investmentRaw);

      // Leads (KPI total_leads + gráfico leads_daily)
      renderLeads(res);

      // KPIs derivados no período (CPL/CPC/CPM)
      renderCostKpis();

      // Vendas (gráfico sales_daily)
      renderSales(res);
      // Custo por Leads (gráfico cpl_daily)
      renderCpl(res);


      console.info('[dash] n8n response received', { params, res });
    } catch (err) {
      // Abort é esperado quando troca rápido de data
      if (err?.name === 'AbortError') return;
      console.error('[dash] Failed to fetch dash data', err);
    }
  }

  // ========================================
  // Dates
  // ========================================
  function initializeDates() {
    const start = utils.firstDayOfMonth();
    const end = utils.today();

    if (elements.entryStartInput) elements.entryStartInput.value = start;
    if (elements.entryEndInput) elements.entryEndInput.value = end;
  }

  function clearDates() {
    const start = utils.firstDayOfMonth();
    const end = utils.today();

    if (elements.entryStartInput) elements.entryStartInput.value = start;
    if (elements.entryEndInput) elements.entryEndInput.value = end;

    sendDatesToN8n();
  }


  // ========================================
  // Events
  // ========================================
  function setupEventListeners() {
    if (elements.applyEntryOnly) {
      elements.applyEntryOnly.addEventListener('click', sendDatesToN8n);
    }
    if (elements.clearEntryDates) {
      elements.clearEntryDates.addEventListener('click', clearDates);
    }

    const onEnter = (e) => {
      if (e.key !== 'Enter') return;
      sendDatesToN8n();
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
    // Ao abrir a página, já dispara a consulta com a data de hoje
    sendDatesToN8n();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
