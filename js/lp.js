(() => {
  const page = document.documentElement.getAttribute("data-page");
  if (page !== "lp-conversoes") return;

  // Ajuste para o seu webhook real (precisa retornar: { resumo: {...}, por_lp: [...] })
  const CONFIG = {
    ENDPOINT: "https://n8n.clinicaexperts.com.br/webhook/analytics",
    TIMEOUT_MS: 20000,
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
    parseDate(value) {
      if (!value) return null;
      const s = String(value).trim();
      if (!s) return null;
      // input[type=date] usa YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const d = new Date(`${s}T00:00:00`);
        return isNaN(d) ? null : d;
      }
      const d = new Date(s);
      return isNaN(d) ? null : d;
    },
    toInt(v) {
      const n = Number(String(v ?? "").replace(/,/g, ".").trim());
      return Number.isFinite(n) ? Math.trunc(n) : 0;
    },
    toFloat(v) {
      const n = Number(String(v ?? "").replace(/,/g, ".").trim());
      return Number.isFinite(n) ? n : 0;
    },
    fmtInt(n) {
      return (Number(n) || 0).toLocaleString("pt-BR");
    },
    fmtPct(frac) {
      const v = Number(frac);
      if (!Number.isFinite(v)) return "—";
      const pct = v <= 1.2 ? v * 100 : v; // aceita 0-1 ou 0-100
      const out = pct >= 10 ? pct.toFixed(1) : pct.toFixed(2);
      return `${out.replace(".", ",")}%`;
    },
    pctClass(frac) {
      const v = Number(frac);
      const pct = Number.isFinite(v) ? (v <= 1.2 ? v * 100 : v) : 0;
      if (pct >= 10) return "pill pill--good";
      if (pct >= 5) return "pill pill--mid";
      return "pill pill--bad";
    },
    escapeHtml(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    },
  };

  const dom = { byId: (id) => document.getElementById(id) };

  const el = {
    entryStart: dom.byId("entryStartDate"),
    entryEnd: dom.byId("entryEndDate"),
    apply: dom.byId("applyFilters"),
    clear: dom.byId("clearAllFilters"),

    presetPrevDay: dom.byId("presetPrevDay"),
    presetNextDay: dom.byId("presetNextDay"),
    preset7: dom.byId("preset7"),
    preset14: dom.byId("preset14"),
    preset30: dom.byId("preset30"),

    // KPIs
    kpiVisits: dom.byId("kpiVisits"),
    kpiLeads: dom.byId("kpiLeads"),
    kpiConv: dom.byId("kpiConv"),
    kpiLps: dom.byId("kpiLps"),

    // KPI por LP
    lpKpis: dom.byId("lpKpis"),

    loading: dom.byId("loadingOverlay"),
    toast: dom.byId("errorToast"),
    toastMsg: dom.byId("errorMessage"),
    toastClose: dom.byId("closeToast"),
  };

  const ui = {
    showLoading() {
      el.loading?.classList.add("active");
    },
    hideLoading() {
      el.loading?.classList.remove("active");
    },
    showError(msg) {
      if (!el.toast) return;
      el.toastMsg.textContent = msg;
      el.toast.classList.add("active");
      setTimeout(() => this.hideError(), 4500);
    },
    hideError() {
      el.toast?.classList.remove("active");
    },
    emptyHtml(message) {
      return `<div style="color:#94a3b8;padding:12px;">${utils.escapeHtml(message)}</div>`;
    },
  };

  function extractRoot(data) {
    if (Array.isArray(data)) {
      if (data.length === 1 && data[0] && typeof data[0] === "object") return data[0];
      const anyWithPorLp = data.find((x) => x && typeof x === "object" && Array.isArray(x.por_lp));
      if (anyWithPorLp) return anyWithPorLp;
      return { por_lp: data };
    }
    if (data && typeof data === "object") return data;
    return {};
  }

  function normalizeRow(x) {
    const lp = x?.lp ?? x?.path ?? x?.url ?? x?.pagina ?? null;
    const nome = x?.nome ?? x?.name ?? null;
    const visitas = utils.toInt(x?.visitas ?? x?.visits ?? x?.total_visitas ?? 0);
    const leads = utils.toInt(x?.leads ?? x?.total_leads ?? x?.conversions ?? 0);

    let conv = utils.toFloat(x?.conversao ?? x?.conversion ?? 0);
    if (typeof x?.conversao === "string" && String(x.conversao).includes("%")) {
      conv = utils.toFloat(String(x.conversao).replace("%", ""));
    }
    if (conv > 1.2 && conv <= 100) conv = conv / 100;

    // fallback: calcula se não veio
    if (!Number.isFinite(conv) || conv <= 0) conv = visitas ? leads / visitas : 0;

    return {
      lp: lp ? String(lp) : "—",
      nome: nome ? String(nome) : (lp ? String(lp) : "—"),
      visitas,
      leads,
      conversao: conv,
    };
  }

  function renderGlobalKpis(resumo, rows) {
    const totalVisits = resumo?.total_visitas ?? rows.reduce((s, r) => s + (r.visitas || 0), 0);
    const totalLeads = resumo?.total_leads ?? rows.reduce((s, r) => s + (r.leads || 0), 0);
    const conv = resumo?.conversao ?? (totalVisits ? totalLeads / totalVisits : 0);

    if (el.kpiVisits) el.kpiVisits.textContent = utils.fmtInt(totalVisits);
    if (el.kpiLeads) el.kpiLeads.textContent = utils.fmtInt(totalLeads);
    if (el.kpiConv) el.kpiConv.textContent = utils.fmtPct(conv);
    if (el.kpiLps) el.kpiLps.textContent = utils.fmtInt(rows.length);
  }

  function renderLpKpis(rows) {
    if (!el.lpKpis) return;

    if (!rows.length) {
      el.lpKpis.innerHTML = ui.emptyHtml("Sem dados para o filtro atual.");
      return;
    }

    // ordena por visitas desc (como padrão visual)
    // ordena por conversão desc (de cima para baixo / esquerda para direita)
    const list = [...rows].sort((a, b) => {
      const ca = Number(a.conversao) || 0;
      const cb = Number(b.conversao) || 0;
      if (cb !== ca) return cb - ca;

      const la = Number(a.leads) || 0;
      const lb = Number(b.leads) || 0;
      if (lb !== la) return lb - la;

      const va = Number(a.visitas) || 0;
      const vb = Number(b.visitas) || 0;
      return vb - va;
    });


    el.lpKpis.innerHTML = list
      .map((r) => {
        const title = (r.nome || r.lp || "—").toString();
        const path = (r.lp || "—").toString();
        const convTxt = utils.fmtPct(r.conversao);
        const pillCls = utils.pctClass(r.conversao);

        return `
          <div class="lp-kpi-card">
            <div class="lp-kpi-name">${utils.escapeHtml(title)}</div>
            <div class="lp-kpi-path mono">${utils.escapeHtml(path)}</div>
            <div class="lp-kpi-metric"><span class="${pillCls}">${convTxt}</span></div>
            <div class="lp-kpi-sub">${utils.fmtInt(r.visitas)} visitas • ${utils.fmtInt(r.leads)} leads</div>
          </div>
        `;
      })
      .join("");
  }

  async function loadData() {
    const params = {
      entry_start: el.entryStart?.value || "",
      entry_end: el.entryEnd?.value || "",
      _ts: Date.now(),
    };

    ui.showLoading();
    try {
      const url = `${CONFIG.ENDPOINT}?${new URLSearchParams(params)}`;
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);

      const res = await fetch(url, { cache: "no-store", signal: controller.signal });
      clearTimeout(t);

      const raw = await res.text();
      if (!res.ok) {
        const snippet = raw ? raw.slice(0, 220) : "";
        throw new Error(`HTTP ${res.status}${snippet ? ` — ${snippet}` : ""}`);
      }

      const text = (raw || "").trim();
      const data = text ? JSON.parse(text) : [];
      const root = extractRoot(data);

      const resumo = root?.resumo && typeof root.resumo === "object" ? root.resumo : null;
      const porLp = Array.isArray(root?.por_lp) ? root.por_lp : [];

      const rows = porLp.map(normalizeRow);

      renderGlobalKpis(resumo, rows);
      renderLpKpis(rows);
    } catch (e) {
      const msg =
        e?.name === "AbortError"
          ? `Timeout (${Math.round(CONFIG.TIMEOUT_MS / 1000)}s) no webhook`
          : (e?.message || String(e));

      ui.showError(`Erro: ${msg}`);
      renderGlobalKpis(null, []);
      renderLpKpis([]);
    } finally {
      ui.hideLoading();
    }
  }

  function applyPresetDays(days) {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (days - 1));
    if (el.entryStart) el.entryStart.value = utils.getDateString(start);
    if (el.entryEnd) el.entryEnd.value = utils.getDateString(end);
    loadData();
  }

  function applyRelativeDay(delta) {
    const startStr = el.entryStart?.value || "";
    const endStr = el.entryEnd?.value || "";
    const baseStr = startStr || endStr || utils.today();

    const baseDate = utils.parseDate(baseStr) || new Date();
    baseDate.setDate(baseDate.getDate() + delta);

    const ds = utils.getDateString(baseDate);
    if (el.entryStart) el.entryStart.value = ds;
    if (el.entryEnd) el.entryEnd.value = ds;
    loadData();
  }

  function init() {
    const today = utils.today();
    if (el.entryStart) el.entryStart.value = today;
    if (el.entryEnd) el.entryEnd.value = today;

    el.apply?.addEventListener("click", loadData);

    el.clear?.addEventListener("click", () => {
      const today = utils.today();
      if (el.entryStart) el.entryStart.value = today;
      if (el.entryEnd) el.entryEnd.value = today;
      loadData();
    });

    el.preset7?.addEventListener("click", () => applyPresetDays(7));
    el.preset14?.addEventListener("click", () => applyPresetDays(14));
    el.preset30?.addEventListener("click", () => applyPresetDays(30));

    el.presetPrevDay?.addEventListener("click", () => applyRelativeDay(-1));
    el.presetNextDay?.addEventListener("click", () => applyRelativeDay(1));

    el.toastClose?.addEventListener("click", () => ui.hideError());

    loadData();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
