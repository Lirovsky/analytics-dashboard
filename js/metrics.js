const CONFIG = {
    CAMPAIGNS_ENDPOINT: "https://n8n.clinicaexperts.com.br/webhook/campaigns",
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
    getDateString(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    },
    today() {
        return this.getDateString(new Date());
    },
    safeNumber(value) {
        if (value === null || value === undefined || isNaN(value)) return null;
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    },
    formatNumber(value) {
        const n = this.safeNumber(value);
        return n === null ? "–" : formatters.number.format(n);
    },
    formatCurrency(value) {
        const n = this.safeNumber(value);
        return n === null ? "–" : formatters.currency.format(n);
    },
    formatROAS(value) {
        const n = this.safeNumber(value);
        return n === null ? "–" : `${n.toFixed(2)}x`;
    },
    formatDays(value) {
        const n = this.safeNumber(value);
        return n === null ? "–" : `${Math.round(n)} dias`;
    },
    safeDivide(numerator, denominator) {
        const n = Number(numerator);
        const d = Number(denominator);
        if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
        return n / d;
    },

    // =========================
    // bases normalizadas
    // =========================
    getAnnualizedValue(campaign) {
        const direct = this.safeNumber(campaign?.value_annualized);
        if (direct !== null) return direct;

        const vm = Number(campaign?.value_monthly) || 0;
        const va = Number(campaign?.value_annual) || 0;
        const vu = Number(campaign?.value_unknown) || 0;
        if (vm !== 0 || va !== 0 || vu !== 0) return vm * 12 + va + vu;

        return Number(campaign?.value) || 0;
    },

    getMonthlyEquivValue(campaign) {
        const direct = this.safeNumber(campaign?.value_monthly_equiv);
        if (direct !== null) return direct;

        const vm = Number(campaign?.value_monthly) || 0;
        const va = Number(campaign?.value_annual) || 0;
        const vu = Number(campaign?.value_unknown) || 0;
        if (vm !== 0 || va !== 0 || vu !== 0) return vm + va / 12 + vu;

        return Number(campaign?.value) || 0;
    },

    // =========================
    // sort helpers (inclui campos calculados)
    // =========================
    getSortValue(c, key) {
        const leads = Number(c?.leads) || 0;
        const lead_trial = Number(c?.lead_trial) || 0;
        const sales = Number(c?.sales) || 0;
        const value = Number(c?.value) || 0;
        const investment = Number(c?.investment) || 0;
        const lead_total = Number.isFinite(Number(c?.lead_total)) ? Number(c?.lead_total) : leads + lead_trial;

        if (key === "ticket_medio_anual") {
            const annualized = utils.getAnnualizedValue(c);
            return utils.safeDivide(annualized, sales) ?? 0;
        }

        if (key === "ticket_medio_mensal") {
            const monthlyEquiv = utils.getMonthlyEquivValue(c);
            return utils.safeDivide(monthlyEquiv, sales) ?? 0;
        }

        if (key === "lead_trial") return lead_trial;

        if (key === "lead_total") return lead_total;

        if (key === "rpl") return utils.safeDivide(value, lead_total) ?? 0;
        if (key === "cpl") return utils.safeDivide(investment, lead_total) ?? 0;

        const raw = c?.[key];
        const n = Number(raw);
        return Number.isFinite(n) ? n : 0;
    },
};

const $id = (id) => document.getElementById(id);

const elements = {
    entryStartInput: $id("entryStartDate"),
    entryEndInput: $id("entryEndDate"),
    purchaseStartInput: $id("purchaseStartDateInput"),
    purchaseEndInput: $id("purchaseEndDateInput"),

    applyFilters: $id("applyFilters"),
    applyEntryOnly: $id("applyEntryOnly"),
    applyPurchaseOnly: $id("applyPurchaseOnly"),
    clearEntryDates: $id("clearEntryDates"),

    facebookBody: $id("facebookBody"),
    googleBody: $id("googleBody"),
    organicBody: $id("organicBody"),

    facebookPageInfo: $id("facebookPageInfo"),
    googlePageInfo: $id("googlePageInfo"),
    organicPageInfo: $id("organicPageInfo"),

    totalCampaigns: $id("totalCampaigns"),
    totalLeads: $id("totalLeads"),
    totalSales: $id("totalSales"),
    totalValue: $id("totalValue"),
    totalInvestment: $id("totalInvestment"),
    totalCplGeneral: $id("totalCplGeneral"),

    // IDs novos (HTML atualizado)
    totalTicketMedioAnnual: $id("totalTicketMedioAnnual"),
    totalTicketMedioMonthly: $id("totalTicketMedioMonthly"),

    totalAvgGeneral: $id("totalAvgGeneral"),
    totalCplIcp: $id("totalCplIcp"),

    loadingOverlay: $id("loadingOverlay"),
    errorToast: $id("errorToast"),
    errorMessage: $id("errorMessage"),
    closeToast: $id("closeToast"),
};

const state = {
    sort: { key: null, direction: "desc" },
    campaignsData: null,
    pagination: {
        facebook: { page: 1, pageSize: 10 },
        google: { page: 1, pageSize: 10 },
        organic: { page: 1, pageSize: 10 },
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
    renderEmptyState(message = "Sem dados", colspan = 12) {
        return `<tr><td colspan="${colspan}"><div class="empty-state"><p>${message}</p></div></td></tr>`;
    },
};

function sortCampaigns(items) {
    const { key, direction } = state.sort;
    if (!key) return items;

    const dir = direction === "asc" ? 1 : -1;
    return [...items].sort((a, b) => {
        const aVal = utils.getSortValue(a, key);
        const bVal = utils.getSortValue(b, key);
        if (aVal === bVal) return 0;
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

    document.querySelectorAll(`.pagination[data-channel="${channel}"] .pg-btn`).forEach((btn) => {
        const action = btn.getAttribute("data-action");
        btn.disabled = (action === "prev" && meta.page <= 1) || (action === "next" && meta.page >= meta.totalPages);
    });
}

const campaignsRender = {
    campaignRow(campaign, includeInvestment = true) {
        const value = Number(campaign.value) || 0; // caixa do período
        const sales = Number(campaign.sales) || 0;
        const leads = Number(campaign.leads) || 0;
        const leadTrial = Number(campaign.lead_trial) || 0;
        const leadTotal = Number.isFinite(Number(campaign.lead_total)) ? Number(campaign.lead_total) : leads + leadTrial;

        const annualizedValue = utils.getAnnualizedValue(campaign);
        const monthlyEquivValue = utils.getMonthlyEquivValue(campaign);

        const ticketAnnual = utils.safeDivide(annualizedValue, sales);
        const ticketMonthly = utils.safeDivide(monthlyEquivValue, sales);

        const rpl = utils.safeDivide(value, leadTotal);
        const cpl = utils.safeDivide(campaign.investment, leadTotal);

        const roasClass = (Number(campaign.roas) || 0) >= 1 ? "value-positive" : "value-negative";

        if (includeInvestment) {
            return `
        <tr>
          <td>${campaign.name || "–"}</td>
          <td>${utils.formatNumber(leads)}</td>
          <td>${utils.formatNumber(leadTrial)}</td>
          <td>${utils.formatNumber(leadTotal)}</td>
          <td>${utils.formatNumber(sales)}</td>
          <td>${utils.formatCurrency(value)}</td>
          <td>${utils.formatCurrency(ticketAnnual)}</td>
          <td>${utils.formatCurrency(ticketMonthly)}</td>
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
        <td>${campaign.name || "–"}</td>
        <td>${utils.formatNumber(leads)}</td>
        <td>${utils.formatNumber(leadTrial)}</td>
        <td>${utils.formatNumber(leadTotal)}</td>
          <td>${utils.formatNumber(sales)}</td>
        <td>${utils.formatCurrency(value)}</td>
        <td>${utils.formatCurrency(ticketAnnual)}</td>
        <td>${utils.formatCurrency(ticketMonthly)}</td>
        <td>${utils.formatCurrency(rpl)}</td>
        <td>${utils.formatDays(campaign.avg_time_to_purchase_days)}</td>
      </tr>`;
    },

    campaignTotalRow(totals, includeInvestment = true, avgDaysTotal = null) {
        const roas = totals.investment > 0 ? totals.value / totals.investment : null;
        const cac = totals.sales > 0 ? totals.investment / totals.sales : null;
        const cpl = totals.lead_total > 0 ? totals.investment / totals.lead_total : null;

        const ticketTotalAnnual = utils.safeDivide(totals.value_annualized, totals.sales);
        const ticketTotalMonthly = utils.safeDivide(totals.value_monthly_equiv, totals.sales);

        let cells = `
      <tr class="total-row">
        <td><strong>Total</strong></td>
        <td><strong>${utils.formatNumber(totals.leads)}</strong></td>
        <td><strong>${utils.formatNumber(totals.lead_trial)}</strong></td>
        <td><strong>${utils.formatNumber(totals.lead_total)}</strong></td>
        <td><strong>${utils.formatNumber(totals.sales)}</strong></td>
        <td><strong>${utils.formatCurrency(totals.value)}</strong></td>
        <td><strong>${utils.formatCurrency(ticketTotalAnnual)}</strong></td>
        <td><strong>${utils.formatCurrency(ticketTotalMonthly)}</strong></td>
        <td><strong>${utils.formatCurrency(utils.safeDivide(totals.value, totals.lead_total))}</strong></td>`;

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
                // facebook/google: 12 colunas | orgânico: 8 colunas
                bodyEl.innerHTML = ui.renderEmptyState("Sem dados", includeInv ? 14 : 10);
                updatePaginationUI(channel, { page: 1, totalPages: 1 });
                return;
            }

            const totals = sorted.reduce(
                (acc, c) => {
                    acc.leads += Number(c.leads) || 0;
                    acc.lead_trial += Number(c.lead_trial) || 0;
                    const leadTotal = Number.isFinite(Number(c.lead_total)) ? Number(c.lead_total) : (Number(c.leads) || 0) + (Number(c.lead_trial) || 0);
                    acc.lead_total += leadTotal;
                    acc.sales += Number(c.sales) || 0;
                    acc.value += Number(c.value) || 0;
                    acc.investment += Number(c.investment) || 0;

                    acc.value_annualized += utils.getAnnualizedValue(c);
                    acc.value_monthly_equiv += utils.getMonthlyEquivValue(c);

                    const avg = Number(c.avg_time_to_purchase_days);
                    const sales = Number(c.sales) || 0;
                    if (sales > 0 && Number.isFinite(avg)) {
                        acc.weightedSum += avg * sales;
                        acc.weight += sales;
                    }
                    return acc;
                },
                {
                    leads: 0,
                    lead_trial: 0,
                    lead_total: 0,
                    sales: 0,
                    value: 0,
                    investment: 0,
                    value_annualized: 0,
                    value_monthly_equiv: 0,
                    weightedSum: 0,
                    weight: 0,
                }
            );

            const meta = paginate(sorted, state.pagination[channel].page, state.pagination[channel].pageSize);
            state.pagination[channel].page = meta.page;

            bodyEl.innerHTML =
                meta.slice.map((c) => campaignsRender.campaignRow(c, includeInv)).join("") +
                campaignsRender.campaignTotalRow(
                    totals,
                    includeInv,
                    totals.weight > 0 ? totals.weightedSum / totals.weight : null
                );

            updatePaginationUI(channel, meta);
        };

        renderTable("facebook", data?.facebook, elements.facebookBody, true);
        renderTable("google", data?.google, elements.googleBody, true);
        renderTable("organic", data?.organic, elements.organicBody, false);
    },

    summary(data) {
        const all = [...(data?.facebook || []), ...(data?.google || []), ...(data?.organic || [])];

        const totals = all.reduce(
            (acc, c) => {
                acc.campaigns += 1;
                acc.leads += Number(c.leads) || 0;
                acc.lead_trial += Number(c.lead_trial) || 0;
                const leadTotal = Number.isFinite(Number(c.lead_total)) ? Number(c.lead_total) : (Number(c.leads) || 0) + (Number(c.lead_trial) || 0);
                acc.lead_total += leadTotal;
                acc.sales += Number(c.sales) || 0;
                acc.value += Number(c.value) || 0;
                acc.investment += Number(c.investment) || 0;

                acc.value_annualized += utils.getAnnualizedValue(c);
                acc.value_monthly_equiv += utils.getMonthlyEquivValue(c);

                const avg = Number(c.avg_time_to_purchase_days);
                const sales = Number(c.sales) || 0;
                if (sales > 0 && Number.isFinite(avg)) {
                    acc.weightedSum += avg * sales;
                    acc.weight += sales;
                }
                return acc;
            },
            {
                campaigns: 0,
                leads: 0,
                lead_trial: 0,
                lead_total: 0,
                sales: 0,
                value: 0,
                investment: 0,
                value_annualized: 0,
                value_monthly_equiv: 0,
                weightedSum: 0,
                weight: 0,
            }
        );

        if (elements.totalCampaigns) elements.totalCampaigns.textContent = utils.formatNumber(totals.campaigns);
        if (elements.totalLeads) elements.totalLeads.textContent = utils.formatNumber(totals.lead_total);
        if (elements.totalSales) elements.totalSales.textContent = utils.formatNumber(totals.sales);

        // receita do período (caixa)
        if (elements.totalValue) elements.totalValue.textContent = utils.formatCurrency(totals.value);

        if (elements.totalInvestment) elements.totalInvestment.textContent = utils.formatCurrency(totals.investment);
        if (elements.totalCplGeneral) elements.totalCplGeneral.textContent = utils.formatCurrency(utils.safeDivide(totals.investment, totals.lead_total));

        const totalLeadsICP = Number(data?.entrySummary?.total_leads_ICP) || 0;
        if (elements.totalCplIcp) elements.totalCplIcp.textContent = utils.formatCurrency(utils.safeDivide(totals.investment, totalLeadsICP));

        // TM anual + TM mensal (globais)
        if (elements.totalTicketMedioAnnual) {
            elements.totalTicketMedioAnnual.textContent = utils.formatCurrency(utils.safeDivide(totals.value_annualized, totals.sales));
        }
        if (elements.totalTicketMedioMonthly) {
            elements.totalTicketMedioMonthly.textContent = utils.formatCurrency(utils.safeDivide(totals.value_monthly_equiv, totals.sales));
        }

        if (elements.totalAvgGeneral) elements.totalAvgGeneral.textContent = utils.formatDays(totals.weight > 0 ? totals.weightedSum / totals.weight : null);
    },
};

async function loadMetrics(mode = "both") {
    const params = {};
    if (mode !== "purchase") {
        params.entry_start = elements.entryStartInput.value;
        params.entry_end = elements.entryEndInput.value;
    }
    if (mode !== "entry") {
        params.purchase_start = elements.purchaseStartInput.value;
        params.purchase_end = elements.purchaseEndInput.value;
    }

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

function init() {
    const today = utils.today();
    elements.entryStartInput.value = today;
    elements.entryEndInput.value = today;
    elements.purchaseStartInput.value = today;
    elements.purchaseEndInput.value = today;

    elements.applyEntryOnly.onclick = () => loadMetrics("entry");
    elements.applyPurchaseOnly.onclick = () => loadMetrics("purchase");
    elements.applyFilters.onclick = () => loadMetrics("both");
    elements.clearEntryDates.onclick = () => {
        elements.entryStartInput.value = "2025-01-01";
        loadMetrics("both");
    };
    elements.closeToast.onclick = () => ui.hideError();

    document.querySelectorAll(".pagination").forEach((wrap) => {
        wrap.onclick = (e) => {
            const btn = e.target.closest(".pg-btn");
            if (!btn) return;

            const channel = wrap.dataset.channel;
            state.pagination[channel].page += btn.dataset.action === "next" ? 1 : -1;
            campaignsRender.campaignTables(state.campaignsData);
        };

        wrap.querySelector("select").onchange = (e) => {
            const channel = wrap.dataset.channel;
            state.pagination[channel].pageSize = Number(e.target.value);
            state.pagination[channel].page = 1;
            campaignsRender.campaignTables(state.campaignsData);
        };
    });

    document.querySelectorAll("th[data-sort]").forEach((th) => {
        th.onclick = () => {
            state.sort.direction = state.sort.key === th.dataset.sort && state.sort.direction === "desc" ? "asc" : "desc";
            state.sort.key = th.dataset.sort;
            campaignsRender.campaignTables(state.campaignsData);
        };
    });

    loadMetrics("both");
}

document.addEventListener("DOMContentLoaded", init);
