// ========================================
// Configuration
// ========================================
const CONFIG = {
    LEADS_ENDPOINT: 'https://n8n.clinicaexperts.com.br/webhook/leads',
    // Se o external_id for o id do chat no UmblerTalk, monta o link assim:
    CHAT_URL_PREFIX: 'https://app-utalk.umbler.com/chats/',
    // Opcional: mapear manager_id -> nome/email (se quiser igual ao Sheets)
    MANAGER_MAP: {
        // 14: 'zedles@clinicaexperts.com.br',
    },
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
    toBRDate(isoLike) {
        if (!isoLike) return '–';
        const s = String(isoLike).slice(0, 10); // YYYY-MM-DD
        const [y, m, d] = s.split('-');
        if (!y || !m || !d) return '–';
        return `${d}/${m}/${y}`;
    },
    formatCurrency(value) {
        if (value === null || value === undefined || value === '' || isNaN(value)) return '–';
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(Number(value));
    },
    safeText(v) {
        if (v === null || v === undefined || v === '') return '–';
        return String(v);
    },
    normalizeMoney(v) {
        if (v === null || v === undefined) return null;
        const s = String(v).trim().toLowerCase();
        if (['yes', 'sim', 'true', '1'].includes(s)) return 'yes';
        if (['no', 'não', 'nao', 'false', '0'].includes(s)) return 'no';
        return String(v);
    },
    stageClass(stage) {
        const s = String(stage || '').toLowerCase();
        if (s.includes('lead')) return 'badge--stage-lead';
        if (s.includes('apresent')) return 'badge--stage-apresentacao';
        if (s.includes('intera')) return 'badge--stage-interacao';
        return 'badge--stage-outro';
    },
};

// ========================================
// DOM Elements
// ========================================
const dom = { byId: (id) => document.getElementById(id) };

const elements = {
    entryStartInput: dom.byId('entryStartDate'),
    entryEndInput: dom.byId('entryEndDate'),
    applyFilters: dom.byId('applyFilters'),
    clearEntryDates: dom.byId('clearEntryDates'),
    quickSearch: dom.byId('quickSearch'),

    leadsBody: dom.byId('leadsBody'),
    totalCount: dom.byId('totalCount'),

    leadsPageInfo: dom.byId('leadsPageInfo'),

    loadingOverlay: dom.byId('loadingOverlay'),
    errorToast: dom.byId('errorToast'),
    errorMessage: dom.byId('errorMessage'),
    closeToast: dom.byId('closeToast'),
};

// ========================================
// State
// ========================================
const state = {
    sort: { key: 'entry_date', direction: 'desc' },
    leadsData: [],
    filtered: [],
    pagination: { page: 1, pageSize: 25 },
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
    renderEmptyState(message = 'Sem dados', colspan = 12) {
        return `<tr><td colspan="${colspan}" style="padding:24px;color:#94a3b8;text-align:center;">${message}</td></tr>`;
    },
};

// ========================================
// Transform
// ========================================
function normalizeLeadRow(l) {
    const managerId = Number(l.manager_id ?? 0) || 0;
    const manager = CONFIG.MANAGER_MAP[managerId] || managerId || '–';

    const externalId = l.external_id ? String(l.external_id) : '';
    const chatUrl = externalId ? `${CONFIG.CHAT_URL_PREFIX}${externalId}` : null;

    const entryIso = l.created_at ? String(l.created_at) : null;
    const purchaseIso = l.purchased_at ? String(l.purchased_at) : null;

    const team = l.team ?? null;
    const money = utils.normalizeMoney(l.money ?? null);
    const challenge = l.challenge ?? null;
    const system = l.system ?? null;

    return {
        entry_date: entryIso ? entryIso.slice(0, 10) : null,
        purchase_date: purchaseIso ? purchaseIso.slice(0, 10) : null,

        tag: l.tag ?? null,
        phone: l.phone ?? null,

        manager,
        chat_url: chatUrl,

        stage: l.stage ?? null,

        team,
        money,
        system,
        challenge, // "Desafio" vai no final
    };
}


// ========================================
// Sorting & Pagination
// ========================================
function sortRows(items) {
    const { key, direction } = state.sort;
    const dir = direction === 'asc' ? 1 : -1;

    const parseDate = (v) => (v ? new Date(String(v) + 'T00:00:00').getTime() : 0);

    return [...items].sort((a, b) => {
        const aVal = a[key];
        const bVal = b[key];

        // datas
        if (key === 'entry_date' || key === 'purchase_date') {
            return (parseDate(aVal) - parseDate(bVal)) * dir;
        }

        // texto
        return String(aVal ?? '').localeCompare(String(bVal ?? ''), 'pt-BR') * dir;
    });
}

function paginate(items, page, pageSize) {
    const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    const p = Math.max(1, Math.min(page, totalPages));
    return { slice: items.slice((p - 1) * pageSize, p * pageSize), page: p, totalPages };
}

function updatePaginationUI(meta) {
    if (elements.leadsPageInfo) elements.leadsPageInfo.textContent = `${meta.page} / ${meta.totalPages}`;
    document.querySelectorAll(`.pagination[data-channel="leads"] .pg-btn`).forEach(btn => {
        const action = btn.getAttribute('data-action');
        btn.disabled = (action === 'prev' && meta.page <= 1) || (action === 'next' && meta.page >= meta.totalPages);
    });
}

// ========================================
// Render
// ========================================
function renderTable() {
    const sorted = sortRows(state.filtered);

    if (elements.totalCount) elements.totalCount.textContent = String(sorted.length);

    const meta = paginate(sorted, state.pagination.page, state.pagination.pageSize);
    state.pagination.page = meta.page;

    if (!elements.leadsBody) return;

    if (!meta.slice.length) {
        elements.leadsBody.innerHTML = ui.renderEmptyState('Sem dados para o filtro atual.', 11);

        updatePaginationUI({ page: 1, totalPages: 1 });
        return;
    }

    elements.leadsBody.innerHTML = meta.slice.map(r => {
        const stageText = utils.safeText(r.stage);
        const moneyNorm = r.money === null ? null : String(r.money).toLowerCase();
        const moneyClass = moneyNorm === 'yes' ? 'badge--money-yes' : (moneyNorm === 'no' ? 'badge--money-no' : 'badge--neutral');

        return `
  <tr>
    <td>${utils.toBRDate(r.entry_date)}</td>
    <td>${utils.toBRDate(r.purchase_date)}</td>
    <td>${utils.safeText(r.tag)}</td>
    <td>${utils.safeText(r.phone)}</td>
    <td>${utils.safeText(r.manager)}</td>
    <td>
      ${r.chat_url ? `<a class="table-link" href="${r.chat_url}" target="_blank" rel="noopener noreferrer">Abrir</a>` : '–'}
    </td>
    <td><span class="badge ${utils.stageClass(stageText)}">${stageText}</span></td>
    <td>${utils.safeText(r.team)}</td>
    <td><span class="badge ${moneyClass}">${utils.safeText(r.money)}</span></td>
    <td>${utils.safeText(r.system)}</td>
    <td>${utils.safeText(r.challenge)}</td>
  </tr>
`;

    }).join('');

    updatePaginationUI(meta);
}

// ========================================
// Filtering
// ========================================
function applySearchFilter() {
    const q = String(elements.quickSearch?.value ?? '').trim().toLowerCase();
    if (!q) {
        state.filtered = [...state.leadsData];
        return;
    }

    state.filtered = state.leadsData.filter(r => {
        const hay = [
            r.tag, r.phone, r.manager, r.stage, r.team, r.money, r.system, r.challenge,
        ].map(v => String(v ?? '').toLowerCase()).join(' | ');

        return hay.includes(q);
    });
}


// ========================================
// Data Loading
// ========================================
async function loadLeads() {
    const params = {
        entry_start: elements.entryStartInput.value,
        entry_end: elements.entryEndInput.value,
        _ts: Date.now(),
    };

    ui.showLoading();
    try {
        const url = `${CONFIG.LEADS_ENDPOINT}?${new URLSearchParams(params)}`;
        const response = await fetch(url);
        const data = await response.json();

        const root = Array.isArray(data) ? data[0] : data;
        const leads = Array.isArray(root?.leads) ? root.leads : [];

        state.leadsData = leads.map(normalizeLeadRow);
        state.pagination.page = 1;

        applySearchFilter();
        renderTable();
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

    elements.applyFilters.onclick = () => loadLeads();
    elements.clearEntryDates.onclick = () => {
        elements.entryStartInput.value = '2025-01-01';
        loadLeads();
    };
    elements.closeToast.onclick = () => ui.hideError();

    elements.quickSearch.oninput = () => {
        applySearchFilter();
        state.pagination.page = 1;
        renderTable();
    };

    // Paginação
    document.querySelectorAll('.pagination[data-channel="leads"]').forEach(wrap => {
        wrap.onclick = (e) => {
            const btn = e.target.closest('.pg-btn');
            if (!btn) return;
            state.pagination.page += (btn.dataset.action === 'next' ? 1 : -1);
            renderTable();
        };
        wrap.querySelector('select').onchange = (e) => {
            state.pagination.pageSize = Number(e.target.value);
            state.pagination.page = 1;
            renderTable();
        };
    });

    // Ordenação
    document.querySelectorAll('th[data-sort]').forEach(th => {
        th.onclick = () => {
            const key = th.dataset.sort;

            state.sort.direction =
                (state.sort.key === key && state.sort.direction === 'desc') ? 'asc' : 'desc';
            state.sort.key = key;

            document.querySelectorAll('th[data-sort]').forEach(x => x.classList.remove('active'));
            th.classList.add('active');

            renderTable();
        };
    });

    // default active sort header
    const defaultTh = document.querySelector('th[data-sort="entry_date"]');
    defaultTh?.classList.add('active');

    loadLeads();
}

document.addEventListener('DOMContentLoaded', init);
