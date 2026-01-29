const CONFIG = {
  FUNNEL_ENDPOINT: "https://n8n.clinicaexperts.com.br/webhook/funnel",
};

const formatters = {
  number: new Intl.NumberFormat("pt-BR"),
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
  formatPercentage(value) {
    const n = this.safeNumber(value);
    return n === null ? "–" : `${n.toFixed(2)}%`;
  },
  safeDivide(numerator, denominator) {
    const n = Number(numerator);
    const d = Number(denominator);
    if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
    return n / d;
  },
};

const $id = (id) => document.getElementById(id);

const elements = {
  entryStartInput: $id("entryStartDate"),
  entryEndInput: $id("entryEndDate"),
  stageSelect: $id("stageSelect"),
  applyEntryOnly: $id("applyEntryOnly"),

  moneyStatusBody: $id("moneyStatusBody"),
  channelFunnelBody: $id("channelFunnelBody"),

  loadingOverlay: $id("loadingOverlay"),
  errorToast: $id("errorToast"),
  errorMessage: $id("errorMessage"),
  closeToast: $id("closeToast"),
};

const state = {
  funnelData: null,
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
    if (elements.errorMessage) elements.errorMessage.textContent = message;
    elements.errorToast.classList.add("active");
    setTimeout(() => this.hideError(), 4500);
  },
  hideError() {
    elements.errorToast?.classList.remove("active");
  },
  renderSkeleton(count, colspan) {
    return Array(count)
      .fill(0)
      .map(
        () =>
          `<tr><td colspan="${colspan}"><div class="skeleton" style="width:100%;height:20px;"></div></td></tr>`
      )
      .join("");
  },
  renderEmptyState(message, colspan) {
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

const api = {
  buildUrl(base, paramsObj) {
    const params = new URLSearchParams();
    Object.entries(paramsObj || {}).forEach(([k, v]) => {
      if (v !== null && v !== undefined && String(v).trim() !== "") params.set(k, v);
    });
    params.set("_ts", Date.now());
    return `${base}?${params.toString()}`;
  },

  async fetchFunnel(paramsObj) {
    const url = this.buildUrl(CONFIG.FUNNEL_ENDPOINT, paramsObj);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  },
};

const STAGE_VALUE_MAP = {
  Assinou: "Assinatura",
};

const STAGES_ORDER = [
  "Lead",
  "1ª Interação",
  "Apresentação",
  "Proposta Enviada",
  "Pagamento Pendente",
  "Assinatura",
];

const funnelRender = {
  row(stage, groups, highlight = false) {
    const cls = highlight ? "row-subscription" : "";
    const cells = groups
      .map(
        (g) => `
          <td>${utils.formatNumber(g.count)}</td>
          <td>${utils.formatPercentage(g.percentage)}</td>
        `
      )
      .join("");

    return `
      <tr class="${cls}">
        <td>${stage}</td>
        ${cells}
      </tr>
    `;
  },

  totalRow(stage, groups) {
    const cells = groups
      .map(
        (g) => `
          <td><strong>${utils.formatNumber(g.count)}</strong></td>
          <td><strong>${utils.formatPercentage(g.percentage)}</strong></td>
        `
      )
      .join("");

    return `
      <tr class="total-row">
        <td><strong>${stage}</strong></td>
        ${cells}
      </tr>
    `;
  },

  totalRowCountsOnly(stage, counts) {
    const cells = counts.map((c) => `<td><strong>${utils.formatNumber(c)}</strong></td><td></td>`).join("");
    return `
      <tr class="total-row">
        <td><strong>${stage}</strong></td>
        ${cells}
      </tr>
    `;
  },

  buildTotalByChannelCountsOnly(stages) {
    const keys = ["google", "facebook", "organic"];
    return keys.map((k) => STAGES_ORDER.reduce((acc, s) => acc + (stages?.[s]?.[k]?.count || 0), 0));
  },

  buildTotalMoneyStatus(stages) {
    const allCount = STAGES_ORDER.reduce((acc, s) => acc + (stages?.[s]?.all?.count || 0), 0);
    const yesCount = STAGES_ORDER.reduce((acc, s) => acc + (stages?.[s]?.moneyYes?.count || 0), 0);
    const noCount = STAGES_ORDER.reduce((acc, s) => acc + (stages?.[s]?.moneyNo?.count || 0), 0);
    const otherCount = STAGES_ORDER.reduce((acc, s) => acc + (stages?.[s]?.moneyOther?.count || 0), 0);

    const pct = (count) => {
      const v = utils.safeDivide(count, allCount);
      return v === null ? 0 : Number((v * 100).toFixed(2));
    };

    return [
      { count: allCount, percentage: 100 },
      { count: yesCount, percentage: pct(yesCount) },
      { count: noCount, percentage: pct(noCount) },
      { count: otherCount, percentage: pct(otherCount) },
    ];
  },

  buildConversandoMoneyStatus(stages) {
    const sumStages = ["Apresentação", "Proposta Enviada", "Pagamento Pendente", "Assinatura"];
    const keys = ["all", "moneyYes", "moneyNo", "moneyOther"];

    return keys.map((k) => {
      const pct = sumStages.reduce((acc, s) => acc + (stages?.[s]?.[k]?.percentage || 0), 0);
      const count = sumStages.reduce((acc, s) => acc + (stages?.[s]?.[k]?.count || 0), 0);
      return { count, percentage: Number(pct.toFixed(2)) };
    });
  },

  buildConversandoByChannel(stages) {
    const sumStages = ["Apresentação", "Proposta Enviada", "Pagamento Pendente", "Assinatura"];
    const keys = ["google", "facebook", "organic"];

    return keys.map((k) => {
      const pct = sumStages.reduce((acc, s) => acc + (stages?.[s]?.[k]?.percentage || 0), 0);
      const count = sumStages.reduce((acc, s) => acc + (stages?.[s]?.[k]?.count || 0), 0);
      return { count, percentage: Number(pct.toFixed(2)) };
    });
  },

  moneyStatusTable(data) {
    if (!elements.moneyStatusBody) return;

    if (!data?.stages) {
      elements.moneyStatusBody.innerHTML = ui.renderEmptyState("Sem dados de funil", 9);
      return;
    }

    const rows = STAGES_ORDER.map((stage) => {
      const s = data.stages[stage] || {};
      const groups = [
        s.all || { count: 0, percentage: 0 },
        s.moneyYes || { count: 0, percentage: 0 },
        s.moneyNo || { count: 0, percentage: 0 },
        s.moneyOther || { count: 0, percentage: 0 },
      ];
      return this.row(stage, groups, stage === "Assinatura");
    }).join("");

    const conversando = this.row("Conversando", this.buildConversandoMoneyStatus(data.stages));
    const total = this.totalRow("Total", this.buildTotalMoneyStatus(data.stages));

    elements.moneyStatusBody.innerHTML = rows + conversando + total;
  },

  channelTable(data) {
    if (!elements.channelFunnelBody) return;

    if (!data?.stages) {
      elements.channelFunnelBody.innerHTML = ui.renderEmptyState("Sem dados de funil", 7);
      return;
    }

    const rows = STAGES_ORDER.map((stage) => {
      const s = data.stages[stage] || {};
      const groups = [
        s.google || { count: 0, percentage: 0 },
        s.facebook || { count: 0, percentage: 0 },
        s.organic || { count: 0, percentage: 0 },
      ];
      return this.row(stage, groups, stage === "Assinatura");
    }).join("");

    const conversando = this.row("Conversando", this.buildConversandoByChannel(data.stages));
    const total = this.totalRowCountsOnly("Total", this.buildTotalByChannelCountsOnly(data.stages));

    elements.channelFunnelBody.innerHTML = rows + conversando + total;
  },
};

async function loadStages() {
  const entryStart = elements.entryStartInput?.value || "";
  const entryEnd = elements.entryEndInput?.value || "";

  if (!entryStart || !entryEnd) {
    ui.showError("Selecione as datas de entrada");
    return;
  }

  ui.showLoading();
  if (elements.moneyStatusBody) elements.moneyStatusBody.innerHTML = ui.renderSkeleton(6, 9);
  if (elements.channelFunnelBody) elements.channelFunnelBody.innerHTML = ui.renderSkeleton(6, 7);

  try {
    const params = { entry_start: entryStart, entry_end: entryEnd };

    const rawStage = elements.stageSelect?.value?.trim() || "";
    if (rawStage) params.stage = STAGE_VALUE_MAP[rawStage] || rawStage;

    const res = await api.fetchFunnel(params);
    const payload = Array.isArray(res) ? res[0] : res;

    state.funnelData = payload;

    funnelRender.moneyStatusTable(payload?.moneyStatus || null);
    funnelRender.channelTable(payload?.byChannel || null);
  } catch (e) {
    ui.showError(`Failed to load funnel: ${e.message}`);
    if (elements.moneyStatusBody) elements.moneyStatusBody.innerHTML = ui.renderEmptyState("Erro ao carregar", 9);
    if (elements.channelFunnelBody) elements.channelFunnelBody.innerHTML = ui.renderEmptyState("Erro ao carregar", 7);
  } finally {
    ui.hideLoading();
  }
}

function init() {
  const today = utils.today();
  if (elements.entryStartInput) elements.entryStartInput.value = today;
  if (elements.entryEndInput) elements.entryEndInput.value = today;

  elements.closeToast?.addEventListener("click", () => ui.hideError());
  elements.applyEntryOnly?.addEventListener("click", loadStages);

  const onEnter = (e) => {
    if (e.key === "Enter") loadStages();
  };

  elements.entryStartInput?.addEventListener("keypress", onEnter);
  elements.entryEndInput?.addEventListener("keypress", onEnter);

  loadStages();
}

document.addEventListener("DOMContentLoaded", init);
