// ========================================
// Configuration
// ========================================
const CONFIG = {
    ENDPOINT: "https://n8n.clinicaexperts.com.br/webhook/tabela-vendas-lp",
};

// ========================================
// Utilities
// ========================================
const utils = {
    safeText(v) {
        if (v === null || v === undefined || v === "") return "–";
        return String(v);
    },
    asUrl(v) {
        if (!v) return null;
        const s = String(v).trim();
        if (!s) return null;
        // aceita http/https e também URL sem protocolo (corrige)
        if (/^https?:\/\//i.test(s)) return s;
        if (/^[a-z0-9.-]+\.[a-z]{2,}(\S*)$/i.test(s)) return `https://${s}`;
        return s; // fallback (ex.: já vem formatado)
    },
    // pega primeiro array encontrado por chaves candidatas
    pickArray(root, keys) {
        for (const k of keys) {
            const v = root?.[k];
            if (Array.isArray(v)) return v;
        }
        return null;
    },
    // tenta achar objeto raiz
    normalizeRoot(data) {
        if (Array.isArray(data)) return data[0] ?? {};
        return data ?? {};
    },
};

// ========================================
// DOM Elements
// ========================================
const dom = { byId: (id) => document.getElementById(id) };

const elements = {
    quickSearch: dom.byId("quickSearch"),
    refreshData: dom.byId("refreshData"),
    clearSearch: dom.byId("clearSearch"),

    planilhasBody: dom.byId("planilhasBody"),
    influencersBody: dom.byId("influencersBody"),

    planilhasCount: dom.byId("planilhasCount"),
    influencersCount: dom.byId("influencersCount"),
    vendedoresBody: dom.byId("vendedoresBody"),
    vendedoresCount: dom.byId("vendedoresCount"),


    loadingOverlay: dom.byId("loadingOverlay"),
    errorToast: dom.byId("errorToast"),
    errorMessage: dom.byId("errorMessage"),
    closeToast: dom.byId("closeToast"),

};

// ========================================
// State
// ========================================
const state = {
    rawPlanilhas: [],
    rawInfluencers: [],
    filteredPlanilhas: [],
    filteredInfluencers: [],
    sort: { key: null, direction: "asc" },
    rawVendedores: [],
    filteredVendedores: [],

};

// ========================================
// UI Helpers
// ========================================
const ui = {
    showLoading() { elements.loadingOverlay?.classList.add("active"); },
    hideLoading() { elements.loadingOverlay?.classList.remove("active"); },
    showError(message) {
        if (!elements.errorToast) return;
        elements.errorMessage.textContent = message;
        elements.errorToast.classList.add("active");
        setTimeout(() => this.hideError(), 4500);
    },
    hideError() { elements.errorToast?.classList.remove("active"); },
    renderEmptyState(message = "Sem dados", colspan = 2) {
        return `<tr><td colspan="${colspan}" style="padding:24px;color:#94a3b8;text-align:center;">${message}</td></tr>`;
    },
};

// ========================================
// Normalizers (flexível para o payload do n8n)
// ========================================
function normalizePlanilhaRow(x) {
    // variações comuns de nome/link
    const name =
        x?.name ?? x?.titulo ?? x?.planilha ?? x?.label ?? x?.sheet_name ?? x?.nome ?? null;

    const url =
        x?.url ?? x?.link ?? x?.href ?? x?.spreadsheet_url ?? x?.sheet_url ?? null;

    // "status" (ex.: "*" do Sheets)
    const status = x?.status ?? x?.flag ?? x?.star ?? x?.favorite ?? x?.ativo ?? x?.is_active ?? "";

    return {
        planilha_name: utils.safeText(name),
        planilha_url: utils.asUrl(url),
        status: String(status ?? "").trim(),
    };
}

function normalizeVendedorRow(x) {
    const url = x?.url ?? x?.link ?? x?.href ?? x?.vendedor_url ?? null;
    const name = x?.name ?? x?.vendedor ?? x?.seller ?? x?.nome ?? null;

    return {
        vendedor_url: utils.asUrl(url),
        vendedor_name: utils.safeText(name),
    };
}


function normalizeInfluencerRow(x) {
    const url = x?.url ?? x?.link ?? x?.href ?? x?.influencer_url ?? null;
    const name = x?.name ?? x?.pagina ?? x?.page ?? x?.nome ?? null;

    return {
        influencer_url: utils.asUrl(url),
        influencer_name: utils.safeText(name),
    };
}

function splitDataByBestGuess(data) {
    /**
     * Aceita estes formatos:
     * A) { planilhas: [...], influencers: [...] }
     * B) { links: [...], paginas: [...] }
     * C) [{...}] (array solto) -> tenta separar por "section/type", senão assume planilhas
     */
    const root = utils.normalizeRoot(data);

    const vendedores =
        utils.pickArray(root, ["vendedores", "sellers", "vendedor_pages", "vendedores_pages"]) || null;


    // formato A/B
    const planilhas =
        utils.pickArray(root, ["planilhas", "spreadsheets", "sheets", "links", "vendas", "vendas_links"]) || null;

    const influencers =
        utils.pickArray(root, ["influencers", "paginas", "pages", "lp_pages"]) || null;

    if (planilhas || influencers || vendedores) {
        return {
            vendedores: (vendedores || []).map(normalizeVendedorRow),
            planilhas: (planilhas || []).map(normalizePlanilhaRow),
            influencers: (influencers || []).map(normalizeInfluencerRow),
        };
    }


    // formato C (array)
    if (Array.isArray(data)) {
        const items = data;
        const p = [];
        const inf = [];

        for (const it of items) {
            const section = String(it?.section ?? it?.type ?? it?.grupo ?? "").toLowerCase();
            if (section.includes("influ")) inf.push(normalizeInfluencerRow(it));
            else if (section.includes("pagina") || section.includes("page")) inf.push(normalizeInfluencerRow(it));
            else if (section.includes("planilha") || section.includes("sheet") || section.includes("venda")) p.push(normalizePlanilhaRow(it));
            else p.push(normalizePlanilhaRow(it)); // fallback
        }

        return { planilhas: p, influencers: inf };
    }

    return { vendedores: [], planilhas: [], influencers: [] };


}

// ========================================
// Filtering
// ========================================
function applySearchFilter() {
    const q = String(elements.quickSearch?.value ?? "").trim().toLowerCase();

    if (!q) {
        state.filteredVendedores = [...state.rawVendedores];
        state.filteredPlanilhas = [...state.rawPlanilhas];
        state.filteredInfluencers = [...state.rawInfluencers];
        return;
    }

    state.filteredVendedores = state.rawVendedores.filter((r) => {
        const hay = [r.vendedor_name, r.vendedor_url]
            .map(v => String(v ?? "").toLowerCase())
            .join(" | ");
        return hay.includes(q);
    });

    state.filteredPlanilhas = state.rawPlanilhas.filter((r) => {
        const hay = [r.planilha_name, r.planilha_url, r.status]
            .map(v => String(v ?? "").toLowerCase())
            .join(" | ");
        return hay.includes(q);
    });

    state.filteredInfluencers = state.rawInfluencers.filter((r) => {
        const hay = [r.influencer_name, r.influencer_url]
            .map(v => String(v ?? "").toLowerCase())
            .join(" | ");
        return hay.includes(q);
    });
}


// ========================================
// Sorting
// ========================================
function sortItems(items) {
    const { key, direction } = state.sort;
    if (!key) return [...items];

    const dir = direction === "asc" ? 1 : -1;

    return [...items].sort((a, b) => {
        const aVal = String(a?.[key] ?? "");
        const bVal = String(b?.[key] ?? "");
        return aVal.localeCompare(bVal, "pt-BR") * dir;
    });
}

function setActiveSortHeader(th) {
    document.querySelectorAll("th[data-sort]").forEach(x => x.classList.remove("active"));
    th.classList.add("active");
}

// ========================================
// Render
// ========================================
function renderPlanilhas() {
    const rows = sortItems(state.filteredPlanilhas);

    if (elements.planilhasCount) elements.planilhasCount.textContent = String(rows.length);

    if (!elements.planilhasBody) return;
    if (!rows.length) {
        elements.planilhasBody.innerHTML = ui.renderEmptyState("Sem planilhas para o filtro atual.", 2);
        return;
    }

    elements.planilhasBody.innerHTML = rows.map((r) => {
        const isStar = r.status === "*" || String(r.status).toLowerCase() === "true" || String(r.status).toLowerCase() === "yes";

        return `
      <tr>
        <td>${utils.safeText(r.planilha_name)}</td>
        <td>
          ${r.planilha_url
                ? `<a class="table-link" href="${r.planilha_url}" target="_blank" rel="noopener noreferrer">${r.planilha_url}</a>`
                : "–"}
        </td>
      </tr>
    `;
    }).join("");
}
function renderVendedores() {
    const rows = sortItems(state.filteredVendedores);

    if (elements.vendedoresCount) elements.vendedoresCount.textContent = String(rows.length);

    if (!elements.vendedoresBody) return;
    if (!rows.length) {
        elements.vendedoresBody.innerHTML = ui.renderEmptyState("Sem vendedores para o filtro atual.", 2);
        return;
    }

    elements.vendedoresBody.innerHTML = rows.map((r) => {
        return `
      <tr>
        <td>${utils.safeText(r.vendedor_name)}</td>
        <td>
          ${r.vendedor_url
                ? `<a class="table-link" href="${r.vendedor_url}" target="_blank" rel="noopener noreferrer">${r.vendedor_url}</a>`
                : "–"}
        </td>
      </tr>
    `;
    }).join("");
}


function renderInfluencers() {
    const rows = sortItems(state.filteredInfluencers);

    if (elements.influencersCount) elements.influencersCount.textContent = String(rows.length);

    if (!elements.influencersBody) return;
    if (!rows.length) {
        elements.influencersBody.innerHTML = ui.renderEmptyState("Sem influencers para o filtro atual.", 2);
        return;
    }

    elements.influencersBody.innerHTML = rows.map((r) => {
        return `
    <tr>
      <td>${utils.safeText(r.influencer_name)}</td>
      <td>
        ${r.influencer_url
                ? `<a class="table-link" href="${r.influencer_url}" target="_blank" rel="noopener noreferrer">${r.influencer_url}</a>`
                : "–"}
      </td>
    </tr>
  `;
    }).join("");

}

function renderAll() {
    renderVendedores();
    renderPlanilhas();
    renderInfluencers();
}


// ========================================
// Data Loading
// ========================================
async function loadData() {
    ui.showLoading();

    try {
        const url = `${CONFIG.ENDPOINT}?${new URLSearchParams({ _ts: Date.now() })}`;
        const response = await fetch(url);

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        const split = splitDataByBestGuess(data);

        state.rawVendedores = split.vendedores || [];
        state.rawPlanilhas = split.planilhas || [];
        state.rawInfluencers = split.influencers || [];


        applySearchFilter();
        renderAll();
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
    elements.refreshData.onclick = () => loadData();
    elements.clearSearch.onclick = () => {
        elements.quickSearch.value = "";
        applySearchFilter();
        renderAll();
    };

    elements.closeToast.onclick = () => ui.hideError();

    elements.quickSearch.oninput = () => {
        applySearchFilter();
        renderAll();
    };

    // Ordenação (clicável no header)
    document.querySelectorAll("th[data-sort]").forEach((th) => {
        th.onclick = () => {
            const key = th.dataset.sort;

            state.sort.direction =
                (state.sort.key === key && state.sort.direction === "asc") ? "desc" : "asc";
            state.sort.key = key;

            setActiveSortHeader(th);
            renderAll();
        };
    });

    loadData();
}

document.addEventListener("DOMContentLoaded", init);
