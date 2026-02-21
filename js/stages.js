const CONFIG = {
  FUNNEL_ENDPOINT: "https://n8n.clinicaexperts.com.br/webhook/funnel",
};

// --------------------------------------------------
// Funil (ajuste de proporção visual)
// --------------------------------------------------
// 1 = linear (padrão) | 0.5 = raiz (recomendado) | 0.35 = mais agressivo
const FUNNEL_VISUAL_EXPONENT = 0.5;

const toFunnelVisualValue = (value) => {
  const n = Math.max(0, Number(value) || 0);
  // Mantém ordenação (monotônico) e "comprime" diferenças grandes.
  return Math.pow(n, FUNNEL_VISUAL_EXPONENT);
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

  moneyStatusChart: $id("moneyStatusChart"),

  // tabela (se você mantiver)
  channelFunnelBody: $id("channelFunnelBody"),

  // 3 funis (se você adicionar no HTML)
  channelFunnelGoogle: $id("channelFunnelGoogle"),
  channelFunnelFacebook: $id("channelFunnelFacebook"),
  channelFunnelOrganic: $id("channelFunnelOrganic"),

  loadingOverlay: $id("loadingOverlay"),
  errorToast: $id("errorToast"),
  errorMessage: $id("errorMessage"),
  closeToast: $id("closeToast"),
};

const state = {
  funnelData: null,
  charts: {
    moneyStatus: null,
    byChannel: {
      google: null,
      facebook: null,
      organic: null,
    },
  },
};

// ----------------------------
// Funnel chart (amCharts)
// ----------------------------

const funnelChart = {
  // -------- Money Status (funil principal) --------
  disposeMoneyStatusChart() {
    const chartRef = state.charts.moneyStatus;
    if (!chartRef) return;
    try {
      chartRef.root.dispose();
    } catch (_) {
      // ignore
    }
    state.charts.moneyStatus = null;
  },

  ensureMoneyStatusChart() {
    if (state.charts.moneyStatus) return state.charts.moneyStatus;
    if (!elements.moneyStatusChart) return null;

    if (typeof am5 === "undefined" || typeof am5percent === "undefined") {
      ui.showError("amCharts não carregou (verifique bloqueio de scripts).");
      return null;
    }

    // limpa qualquer placeholder
    elements.moneyStatusChart.innerHTML = "";

    const root = am5.Root.new("moneyStatusChart");
    root.setThemes([am5themes_Animated.new(root)]);

    root.numberFormatter.setAll({
      intlLocales: "pt-BR",
      numberFormat: "#,###.##",
    });

    const chart = root.container.children.push(
      am5percent.SlicedChart.new(root, {
        layout: root.verticalLayout,
      })
    );

    const series = chart.series.push(
      am5percent.FunnelSeries.new(root, {
        alignLabels: false,
        orientation: "vertical",
        valueField: "value", // valor visual comprimido
        categoryField: "category",
      })
    );

    // Labels no centro do slice (sempre com valores REAIS)
    series.labels.template.setAll({
      text: "{category}: {rawValueText} ({cumPctText})",
      centerX: am5.p50,
      x: am5.p50,
      oversizedBehavior: "wrap",
      fontSize: 12,
    });

    // Tooltip com detalhes (reais)
    series.slices.template.setAll({
      tooltipText:
        "{category}\nAcumulado: {rawValueText} ({cumPctText})\nNo estágio: {stageCountText} ({stagePctText})",
    });

    // Remove ticks (mais limpo)
    series.ticks.template.setAll({
      forceHidden: true,
    });

    state.charts.moneyStatus = { root, chart, series, appeared: false };
    return state.charts.moneyStatus;
  },

  buildMoneyStatusData(moneyStatusPayload) {
    const stages = moneyStatusPayload?.stages;
    if (!stages) return null;

    // contagem "no estágio" (a mesma da tabela anterior)
    const stageCounts = STAGES_ORDER.map((stage) => sumMoneyStageCount(stages, stage));
    const totalAll = stageCounts.reduce((acc, n) => acc + (n || 0), 0);

    // valor do funil = acumulado (etapa atual + todas as etapas abaixo)
    let remaining = totalAll;

    return STAGES_ORDER.map((stage, idx) => {
      const stageCount = stageCounts[idx] || 0;
      const stagePct = totalAll > 0 ? (stageCount / totalAll) * 100 : 0;
      const cumPct = totalAll > 0 ? (remaining / totalAll) * 100 : 0;

      const rawCum = remaining;
      const visualCum = toFunnelVisualValue(rawCum);

      const item = {
        category: stage,

        // tamanho do slice (comprimido)
        value: visualCum,

        // valores reais para exibição
        rawValue: rawCum,
        rawValueText: utils.formatNumber(rawCum),

        // extras (no estágio)
        stageCount,
        stageCountText: utils.formatNumber(stageCount),
        stagePctText: utils.formatPercentage(stagePct),

        // acumulado %
        cumPctText: utils.formatPercentage(cumPct),
      };

      remaining -= stageCount;
      return item;
    });
  },

  renderMoneyStatus(moneyStatusPayload) {
    if (!elements.moneyStatusChart) return;

    if (!moneyStatusPayload?.stages) {
      this.disposeMoneyStatusChart();
      elements.moneyStatusChart.innerHTML = `
        <div class="empty-state" style="padding: 24px;">
          <div class="empty-state__icon">📊</div>
          <p>Sem dados de funil</p>
        </div>
      `;
      return;
    }

    const chartRef = this.ensureMoneyStatusChart();
    if (!chartRef) return;

    const data = this.buildMoneyStatusData(moneyStatusPayload);
    if (!data) {
      elements.moneyStatusChart.innerHTML = `
        <div class="empty-state" style="padding: 24px;">
          <div class="empty-state__icon">📊</div>
          <p>Sem dados de funil</p>
        </div>
      `;
      return;
    }

    chartRef.series.data.setAll(data);

    if (!chartRef.appeared) {
      chartRef.series.appear(900);
      chartRef.chart.appear(900, 80);
      chartRef.appeared = true;
    }
  },

  // -------- By Channel (3 funis lado a lado) --------
  disposeByChannelCharts() {
    const refs = state.charts.byChannel;
    if (!refs) return;

    ["google", "facebook", "organic"].forEach((k) => {
      const ref = refs[k];
      if (!ref) return;
      try {
        ref.root.dispose();
      } catch (_) {
        // ignore
      }
      refs[k] = null;
    });
  },

  ensureByChannelChart(channelKey, element) {
    if (!element) return null;
    if (state.charts.byChannel?.[channelKey]) return state.charts.byChannel[channelKey];

    if (typeof am5 === "undefined" || typeof am5percent === "undefined") {
      ui.showError("amCharts não carregou (verifique bloqueio de scripts).");
      return null;
    }

    // limpa qualquer placeholder
    element.innerHTML = "";

    const root = am5.Root.new(element.id);
    root.setThemes([am5themes_Animated.new(root)]);

    root.numberFormatter.setAll({
      intlLocales: "pt-BR",
      numberFormat: "#,###.##",
    });

    const chart = root.container.children.push(
      am5percent.SlicedChart.new(root, {
        layout: root.verticalLayout,
      })
    );

    const series = chart.series.push(
      am5percent.FunnelSeries.new(root, {
        alignLabels: false,
        orientation: "vertical",
        valueField: "value",
        categoryField: "category",
      })
    );

    series.labels.template.setAll({
      text: "{category}: {rawValueText} ({cumPctText})",
      centerX: am5.p50,
      x: am5.p50,
      oversizedBehavior: "wrap",
      fontSize: 12,
    });

    series.slices.template.setAll({
      tooltipText:
        "{category}\nAcumulado: {rawValueText} ({cumPctText})\nNo estágio: {stageCountText} ({stagePctText})",
    });

    series.ticks.template.setAll({ forceHidden: true });

    const ref = { root, chart, series, appeared: false };
    state.charts.byChannel[channelKey] = ref;
    return ref;
  },

  buildByChannelData(byChannelPayload, channelKey) {
    const stages = byChannelPayload?.stages;
    if (!stages) return null;

    const stageCounts = STAGES_ORDER.map((stage) => {
      const s = stages?.[stage];
      return (s?.[channelKey]?.count || 0) * 1;
    });

    const totalAll = stageCounts.reduce((acc, n) => acc + (n || 0), 0);
    let remaining = totalAll;

    return STAGES_ORDER.map((stage, idx) => {
      const stageCount = stageCounts[idx] || 0;
      const stagePct = totalAll > 0 ? (stageCount / totalAll) * 100 : 0;
      const cumPct = totalAll > 0 ? (remaining / totalAll) * 100 : 0;

      const rawCum = remaining;
      const visualCum = toFunnelVisualValue(rawCum);

      const item = {
        category: stage,
        value: visualCum,

        rawValue: rawCum,
        rawValueText: utils.formatNumber(rawCum),

        stageCount,
        stageCountText: utils.formatNumber(stageCount),
        stagePctText: utils.formatPercentage(stagePct),

        cumPctText: utils.formatPercentage(cumPct),
      };

      remaining -= stageCount;
      return item;
    });
  },

  renderByChannelFunnels(byChannelPayload) {
    const targets = [
      { key: "google", el: elements.channelFunnelGoogle },
      { key: "facebook", el: elements.channelFunnelFacebook },
      { key: "organic", el: elements.channelFunnelOrganic },
    ];

    // Se nenhum container existir, não faz nada (HTML não foi alterado)
    const hasAny = targets.some((t) => !!t.el);
    if (!hasAny) return;

    if (!byChannelPayload?.stages) {
      // sem dados => limpa charts + placeholder
      targets.forEach(({ key, el }) => {
        if (!el) return;
        const ref = state.charts.byChannel?.[key];
        if (ref) {
          try {
            ref.root.dispose();
          } catch (_) { }
          state.charts.byChannel[key] = null;
        }
        el.innerHTML = `
          <div class="empty-state" style="padding: 24px;">
            <div class="empty-state__icon">📊</div>
            <p>Sem dados</p>
          </div>
        `;
      });
      return;
    }

    targets.forEach(({ key, el }) => {
      if (!el) return;

      const chartRef = this.ensureByChannelChart(key, el);
      if (!chartRef) return;

      const data = this.buildByChannelData(byChannelPayload, key);
      if (!data) return;

      chartRef.series.data.setAll(data);

      if (!chartRef.appeared) {
        chartRef.series.appear(900);
        chartRef.chart.appear(900, 80);
        chartRef.appeared = true;
      }
    });
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
  "1ª Interação": "Apresentação",
};

const STAGES_ORDER = ["Lead", "Apresentação", "Proposta Enviada", "Pagamento Pendente", "Assinatura"];

const bucketKeys = (stageLabel) =>
  stageLabel === "Apresentação" ? ["Apresentação", "1ª Interação"] : [stageLabel];

const readMoneyCount = (stages, key) => {
  const v = stages?.[key];
  if (!v) return 0;
  if (typeof v.count === "number") return v.count || 0;
  if (v.all && typeof v.all.count === "number") return v.all.count || 0;
  return 0;
};

const sumMoneyStageCount = (stages, stageLabel) =>
  bucketKeys(stageLabel).reduce((acc, k) => acc + readMoneyCount(stages, k), 0);

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
    // Mantido por compatibilidade: agora vira funil (chart)
    funnelChart.renderMoneyStatus(data);
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

  // skeleton da tabela (se existir)
  if (elements.channelFunnelBody) elements.channelFunnelBody.innerHTML = ui.renderSkeleton(6, 7);

  try {
    const params = { entry_start: entryStart, entry_end: entryEnd };

    const rawStage = elements.stageSelect?.value?.trim() || "";
    if (rawStage) params.stage = STAGE_VALUE_MAP[rawStage] || rawStage;

    const res = await api.fetchFunnel(params);
    const payload = Array.isArray(res) ? res[0] : res;

    state.funnelData = payload;

    funnelRender.moneyStatusTable(payload?.moneyStatus || null);

    // tabela (se você mantiver)
    funnelRender.channelTable(payload?.byChannel || null);

    // 3 funis por canal (se os containers existirem no HTML)
    funnelChart.renderByChannelFunnels(payload?.byChannel || null);
  } catch (e) {
    ui.showError(`Failed to load funnel: ${e.message}`);

    if (elements.moneyStatusChart) {
      funnelChart.disposeMoneyStatusChart();
      elements.moneyStatusChart.innerHTML = `
        <div class="empty-state" style="padding: 24px;">
          <div class="empty-state__icon">⚠️</div>
          <p>Erro ao carregar</p>
        </div>
      `;
    }

    // limpa tabela
    if (elements.channelFunnelBody) {
      elements.channelFunnelBody.innerHTML = ui.renderEmptyState("Erro ao carregar", 7);
    }

    // limpa funis por canal
    funnelChart.disposeByChannelCharts();
    [elements.channelFunnelGoogle, elements.channelFunnelFacebook, elements.channelFunnelOrganic].forEach((el) => {
      if (!el) return;
      el.innerHTML = `
        <div class="empty-state" style="padding: 24px;">
          <div class="empty-state__icon">⚠️</div>
          <p>Erro ao carregar</p>
        </div>
      `;
    });
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