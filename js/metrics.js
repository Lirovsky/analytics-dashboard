// ========================================
// Configuration
// ========================================
const CONFIG = {
    CAMPAIGNS_ENDPOINT: 'https://n8n.clinicaexperts.com.br/webhook/campaigns',
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
    byId: (id) => document.getElementById(id),
};

// ========================================
// DOM Elements
// ========================================
const elements = {
    entryStartInput: dom.byId('entryStartDate'),
    entryEndInput: dom.byId('entryEndDate'),
    purchaseStartInput: dom.byId('purchaseStartDateInput'),
    purchaseEndInput: dom.byId('purchaseEndDateInput'),

    applyFilters: dom.byId('applyFilters'),
    applyEntryOnly: dom.byId('applyEntryOnly'),
    applyPurchaseOnly: dom.byId('applyPurchaseOnly'),
    clearEntryDates: dom.byId('clearEntryDates'),

    facebookBody: dom.byId('facebookBody'),
    googleBody: dom.byId('googleBody'),
    organicBody: dom.byId('organicBody'),

    facebookPageInfo: dom.byId('facebookPageInfo'),
    googlePageInfo: dom.byId('googlePageInfo'),
    organicPageInfo: dom.byId('organicPageInfo'),

    totalCampaigns: dom.byId('totalCampaigns'),
    totalLeads: dom.byId('totalLeads'),
    totalSales: dom.byId('totalSales'),
    totalValue: dom.byId('totalValue'),
    totalInvestment: dom.byId('totalInvestment'),
    totalCplGeneral: dom.byId('totalCplGeneral'),
    totalTicketMedioGeneral: dom.byId('totalTicketMedioGeneral'),
    totalAvgGeneral: dom.byId('totalAvgGeneral'),

    loadingOverlay: dom.byId('loadingOverlay'),
    errorToast: dom.byId('errorToast'),
    errorMessage: dom.byId('errorMessage'),
    closeToast: dom.byId('closeToast'),
};

// ========================================
// State
// ========================================
const state = {
    sort: { key: null, direction: 'desc' },
    campaignsData: null,
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
    showLoading() { elements.loadingOverlay?.classList.add('active'); },
    hideLoading() { elements.loadingOverlay?.classList.remove('active'); },
    showError(message) {
        if (!elements.errorToast) return;
        elements.errorMessage.textContent = message;
        elements.errorToast.classList.add('active');
        setTimeout(() => this.hideError(), 4500);
    },
    hideError() { elements.errorToast?.classList.remove('active'); },
    renderSkeleton(count = 3, colspan = 11) {
        return Array(count).fill(0).map(() =>
            `<tr><td colspan="${colspan}"><div class="skeleton" style="width:100%;height:20px;"></div></td></tr>`
        ).join('');
    },
    renderEmptyState(message = 'Sem dados', colspan = 11) {
        return `<tr><td colspan="${colspan}"><div class="empty-state"><p>${message}</p></div></td></tr>`;
    },
};

// ========================================
// Logic & Rendering
// ========================================
const campaignsRender = {
    campaignRow(campaign, includeInvestment = true) {
        const value = Number(campaign.value) || 0;
        const sales = Number(campaign.sales) || 0;
        const leads = Number(campaign.leads) || 0;
        const ticketMedio = utils.safeDivide(value, sales);
        const rpl = utils.safeDivide(value, leads);
        const cpl = utils.safeDivide(campaign.investment, leads);
        const roasClass = (Number(campaign.roas) || 0) >= 1 ? 'value-positive' : 'value-negative';

        if (includeInvestment) {
            return `
        <tr>
          <td>${campaign.name || '–'}</td>
          <td>${utils.formatNumber(leads)}</td>
          <td>${utils.formatNumber(sales)}</td>
          <td>${utils.formatCurrency(value)}</td>
          <td>${utils.formatCurrency(ticketMedio)}</td>
          <td>${utils.formatCurrency(rpl)}</td>
          <td>${utils.formatCurrency(campaign.investment)}</td>
          <td class="${roasClass}">${utils.formatROAS(campaign.roas)}</td>
          <td>${utils.formatCurrency(cpl)}</td>
          <td>${utils.formatCurrency(campaign.cac)}</td>
          <td>${utils.formatDays(campaign.avg_time_to_purchase_days)}</td>
        </tr>`;
        }

        return `
      <tr>
        <td>${campaign.name || '–'}</td>
        <td>${utils.formatNumber(leads)}</td>
        <td>${utils.formatNumber(sales)}</td>
        <td>${utils.formatCurrency(value)}</td>
        <td>${utils.formatCurrency(ticketMedio)}</td>
        <td>${utils.formatCurrency(rpl)}</td>
        <td>${utils.formatDays(campaign.avg_time_to_purchase_days)}</td>
      </tr>`;
    },

    campaignTotalRow(totals, includeInvestment = true, avgDaysTotal = null) {
        const roas = totals.investment > 0 ? totals.value / totals.investment : null;
        const cac = totals.sales > 0 ? totals.investment / totals.sales : null;
        const cpl = totals.leads > 0 ? totals.investment / totals.leads : null;

        let cells = `
      <tr class="total-row">
        <td><strong>Total</strong></td>
        <td><strong>${utils.formatNumber(totals.leads)}</strong></td>
        <td><strong>${utils.formatNumber(totals.sales)}</strong></td>
        <td><strong>${utils.formatCurrency(totals.value)}</strong></td>
        <td><strong>${utils.formatCurrency(utils.safeDivide(totals.value, totals.sales))}</strong></td>
        <td><strong>${utils.formatCurrency(utils.safeDivide(totals.value, totals.leads))}</strong></td>`;

        if (includeInvestment) {
            cells += `
        <td><strong>${utils.formatCurrency(totals.investment)}</strong></td>
        <td><strong>${utils.formatROAS(roas)}</strong></td>
        <td><strong>${utils.formatCurrency(cpl)}</strong></td>
        <td><strong>${utils.formatCurrency(cac)}</strong></td>`;
        }

        cells += `<td><strong>${utils.formatDays(avgDaysTotal)}</strong></td></tr>`;
        return cells;
    },

    campaignTables(data) {
        const renderTable = (channel, items, bodyEl, includeInv) => {
            if (!bodyEl) return;
            const sorted = sortCampaigns(items || []);
            if (!sorted.length) {
                bodyEl.innerHTML = ui.renderEmptyState('Sem dados', includeInv ? 11 : 7);
                updatePaginationUI(channel, { page: 1, totalPages: 1 });
                return;
            }

            const totals = sorted.reduce((acc, c) => {
                acc.leads += Number(c.leads) || 0;
                acc.sales += Number(c.sales) || 0;
                acc.value += Number(c.value) || 0;
                acc.investment += Number(c.investment) || 0;
                const avg = Number(c.avg_time_to_purchase_days);
                if (acc.sales > 0 && isFinite(avg)) { acc.weightedSum += avg * (Number(c.sales) || 0); acc.weight += (Number(c.sales) || 0); }
                return acc;
            }, { leads: 0, sales: 0, value: 0, investment: 0, weightedSum: 0, weight: 0 });

            const meta = paginate(sorted, state.pagination[channel].page, state.pagination[channel].pageSize);
            state.pagination[channel].page = meta.page;

            bodyEl.innerHTML = meta.slice.map(c => this.campaignRow(c, includeInv)).join('') +
                this.campaignTotalRow(totals, includeInv, totals.weight > 0 ? totals.weightedSum / totals.weight : null);
            updatePaginationUI(channel, meta);
        };

        renderTable('facebook', data?.facebook, elements.facebookBody, true);
        renderTable('google', data?.google, elements.googleBody, true);
        renderTable('organic', data?.organic, elements.organicBody, false);
    },

    summary(data) {
        const all = [...(data?.facebook || []), ...(data?.google || []), ...(data?.organic || [])];
        const totals = all.reduce((acc, c) => {
            acc.campaigns++;
            acc.leads += Number(c.leads) || 0;
            acc.sales += Number(c.sales) || 0;
            acc.value += Number(c.value) || 0;
            acc.investment += Number(c.investment) || 0;
            const avg = Number(c.avg_time_to_purchase_days);
            if (Number(c.sales) > 0 && !isNaN(avg)) { acc.weightedSum += avg * Number(c.sales); acc.weight += Number(c.sales); }
            return acc;
        }, { campaigns: 0, leads: 0, sales: 0, value: 0, investment: 0, weightedSum: 0, weight: 0 });

        if (elements.totalCampaigns) elements.totalCampaigns.textContent = utils.formatNumber(totals.campaigns);
        if (elements.totalLeads) elements.totalLeads.textContent = utils.formatNumber(totals.leads);
        if (elements.totalSales) elements.totalSales.textContent = utils.formatNumber(totals.sales);
        if (elements.totalValue) elements.totalValue.textContent = utils.formatCurrency(totals.value);
        if (elements.totalInvestment) elements.totalInvestment.textContent = utils.formatCurrency(totals.investment);
        if (elements.totalCplGeneral) elements.totalCplGeneral.textContent = utils.formatCurrency(utils.safeDivide(totals.investment, totals.leads));
        if (elements.totalTicketMedioGeneral) elements.totalTicketMedioGeneral.textContent = utils.formatCurrency(utils.safeDivide(totals.value, totals.sales));
        if (elements.totalAvgGeneral) elements.totalAvgGeneral.textContent = utils.formatDays(totals.weight > 0 ? totals.weightedSum / totals.weight : null);
    }
};

// ========================================
// Sorting & Pagination Helpers
// ========================================
function sortCampaigns(items) {
    const { key, direction } = state.sort;
    if (!key) return items;
    const dir = direction === 'asc' ? 1 : -1;
    return [...items].sort((a, b) => {
        const aVal = a[key] || 0;
        const bVal = b[key] || 0;
        return aVal > bVal ? dir : -dir;
    });
}

function paginate(items, page, pageSize) {
    const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    const p = Math.max(1, Math.min(page, totalPages));
    return { slice: items.slice((p - 1) * pageSize, p * pageSize), page: p, totalPages };
}

function updatePaginationUI(channel, meta) {
    const infoEl = elements[`${channel}PageInfo`];
    if (infoEl) infoEl.textContent = `${meta.page} / ${meta.totalPages}`;
    document.querySelectorAll(`.pagination[data-channel="${channel}"] .pg-btn`).forEach(btn => {
        const action = btn.getAttribute('data-action');
        btn.disabled = (action === 'prev' && meta.page <= 1) || (action === 'next' && meta.page >= meta.totalPages);
    });
}

// ========================================
// Actions
// ========================================
async function loadMetrics(mode = 'both') {
    const params = {};
    if (mode !== 'purchase') { params.entry_start = elements.entryStartInput.value; params.entry_end = elements.entryEndInput.value; }
    if (mode !== 'entry') { params.purchase_start = elements.purchaseStartInput.value; params.purchase_end = elements.purchaseEndInput.value; }

    ui.showLoading();
    try {
        const url = `${CONFIG.CAMPAIGNS_ENDPOINT}?${new URLSearchParams(params)}&_ts=${Date.now()}`;
        const response = await fetch(url);
        const data = await response.json();
        state.campaignsData = Array.isArray(data) ? data[0] : data;
        campaignsRender.campaignTables(state.campaignsData);
        campaignsRender.summary(state.campaignsData);
    } catch (e) {
        ui.showError(`Erro: ${e.message}`);
    } finally {
        ui.hideLoading();
    }
}

// ========================================
// Initialization
// ========================================
function init() {
    const today = utils.today();
    elements.entryStartInput.value = today;
    elements.entryEndInput.value = today;
    elements.purchaseStartInput.value = today;
    elements.purchaseEndInput.value = today;

    elements.applyEntryOnly.onclick = () => loadMetrics('entry');
    elements.applyPurchaseOnly.onclick = () => loadMetrics('purchase');
    elements.applyFilters.onclick = () => loadMetrics('both');
    elements.clearEntryDates.onclick = () => { elements.entryStartInput.value = '2025-01-01'; loadMetrics('both'); };
    elements.closeToast.onclick = () => ui.hideError();

    document.querySelectorAll('.pagination').forEach(wrap => {
        wrap.onclick = (e) => {
            const btn = e.target.closest('.pg-btn');
            if (!btn) return;
            const channel = wrap.dataset.channel;
            state.pagination[channel].page += (btn.dataset.action === 'next' ? 1 : -1);
            campaignsRender.campaignTables(state.campaignsData);
        };
        wrap.querySelector('select').onchange = (e) => {
            const channel = wrap.dataset.channel;
            state.pagination[channel].pageSize = Number(e.target.value);
            state.pagination[channel].page = 1;
            campaignsRender.campaignTables(state.campaignsData);
        };
    });

    document.querySelectorAll('th[data-sort]').forEach(th => {
        th.onclick = () => {
            state.sort.direction = (state.sort.key === th.dataset.sort && state.sort.direction === 'desc') ? 'asc' : 'desc';
            state.sort.key = th.dataset.sort;
            campaignsRender.campaignTables(state.campaignsData);
        };
    });

    loadMetrics('both');
}

document.addEventListener('DOMContentLoaded', init);