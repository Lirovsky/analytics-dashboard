(() => {
  const page = document.documentElement.getAttribute("data-page");
  if (page !== "mrr") return;

  const CONFIG = {
    MRR_ENDPOINT: "https://n8n.clinicaexperts.com.br/webhook/mrr",
  };

  const DEBUG_UNMAPPED = new URLSearchParams(window.location.search).has("debug");
  const DEBUG_SAMPLE_LIMIT = 60;

  const NAO_INFORMADO_VALUE = "__nao_informado__";
  const COLOR_NAO_INFORMADO = "#000000";
  const COLOR_OUTROS = "#ffffff";
  const COLOR_OUTROS_BORDER = "#cbd5e1";

  // Paleta (troque o hex abaixo pelo roxo desejado)
  const PRIMARY_PURPLE = "#b580ff"; // roxo clarorgb(181, 128, 255)
  const PRIMARY_PURPLE_RGBA = "rgba(181, 128, 255, 0.99)";
  const PRIMARY_PURPLE_BORDER = "rgba(181, 128, 255, 0.99)";


  const PIE_PALETTE = [
    "rgb(54, 162, 235)",
    "rgb(255, 99, 132)",
    "rgb(255, 159, 64)",
    "rgb(255, 205, 86)",
    "rgb(75, 192, 192)",
    "rgb(153, 102, 255)",
    "rgb(201, 203, 207)",
    "rgb(22, 163, 74)",
    "rgb(14, 116, 144)",
    "rgb(234, 88, 12)",
    "rgb(190, 18, 60)",
    "rgb(37, 99, 235)",
  ];

  if (window.Chart && window.ChartDataLabels && typeof window.Chart.register === "function") {
    window.Chart.register(window.ChartDataLabels);
    window.Chart.defaults.plugins = window.Chart.defaults.plugins || {};
    window.Chart.defaults.plugins.datalabels = window.Chart.defaults.plugins.datalabels || {};
    window.Chart.defaults.plugins.datalabels.display = false;
  }

  const utils = {
    getDateString(date) {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    },
    parseDate(value) {
      if (!value) return null;
      const s = String(value).trim();
      if (!s) return null;
      // YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const d = new Date(`${s}T00:00:00`);
        return isNaN(d) ? null : d;
      }
      // YYYY-MM-DD HH:mm(:ss)
      if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/.test(s)) {
        const d = new Date(s.replace(" ", "T"));
        return isNaN(d) ? null : d;
      }
      const d = new Date(s);
      return isNaN(d) ? null : d;
    },
    monthKeyFromDate(d) {
      if (!d) return null;
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      return `${y}-${m}`;
    },
    escapeHtml(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    },
    normalizeMoney(value) {
      const v = String(value ?? "").trim().toLowerCase();
      if (!v) return "unknown";
      if (["yes", "sim", "true", "1", "y"].includes(v)) return "yes";
      if (["no", "não", "nao", "false", "0", "n"].includes(v)) return "no";
      return "unknown";
    },
    moneyLabel(norm) {
      if (norm === "yes") return "Sim";
      if (norm === "no") return "Não";
      return "Não informado";
    },
    toNumber(value) {
      if (value === null || value === undefined || value === "") return 0;
      const s0 = String(value).trim();
      if (!s0) return 0;
      // mantém só dígitos, ponto, vírgula e sinal
      let s = s0.replace(/[^\d.,-]/g, "");
      if (!s) return 0;

      const hasDot = s.includes(".");
      const hasComma = s.includes(",");
      if (hasDot && hasComma) {
        // decimal é o último separador
        if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
          s = s.replace(/\./g, "").replace(",", ".");
        } else {
          s = s.replace(/,/g, "");
        }
      } else if (hasComma) {
        s = s.replace(",", ".");
      }
      const n = Number(s);
      return Number.isFinite(n) ? n : 0;
    },
    formatBRL(value, { maximumFractionDigits = 2 } = {}) {
      const n = Number(value) || 0;
      return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
        maximumFractionDigits,
      }).format(n);
    },
    formatNumberBR(value, { maximumFractionDigits = 0 } = {}) {
      const n = Number(value) || 0;
      return new Intl.NumberFormat("pt-BR", { maximumFractionDigits }).format(n);
    },
    formatIntBR(value) {
      const n = Number(value) || 0;
      return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(Math.trunc(n));
    },
    formatPct(value, { digits = 1 } = {}) {
      if (value === null || value === undefined || !Number.isFinite(value)) return "–";
      const pct = value * 100;
      return `${pct.toFixed(digits)}%`;
    },
  };

  const $id = (id) => document.getElementById(id);

  const elements = {
    entryStartInput: $id("entryStartDate"),
    entryEndInput: $id("entryEndDate"),

    managerSelect: $id("managerSelect"),
    planSelect: $id("planSelect"),
    channelSelect: $id("channelSelect"),
    entryTypeSelect: $id("entryTypeSelect"),
    areaSelect: $id("areaSelect"),
    timeSelect: $id("timeSelect"),
    moneySelect: $id("moneySelect"),
    quickSearch: $id("globalSearch"),

    presetMonth: $id("presetMonth"),
    presetPrevMonth: $id("presetPrevMonth"),
    preset30: $id("preset30"),
    preset90: $id("preset90"),

    applyFilters: $id("applyFilters"),
    clearAllFilters: $id("clearAllFilters"),

    totalCount: $id("totalCount"),

    kpiMrrTotal: $id("kpiMrrTotal"),
    kpiMrrMoM: $id("kpiMrrMoM"),
    kpiArpa: $id("kpiArpa"),
    kpiAcv: $id("kpiAcv"),

    loadingOverlay: $id("loadingOverlay"),
    errorToast: $id("errorToast"),
    errorMessage: $id("errorMessage"),
    closeToast: $id("closeToast"),
  };

  const state = {
    rows: [],
    filtered: [],
    charts: {},
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
  };

  function getSelectedValues(selectEl) {
    if (!selectEl) return [];
    return Array.from(selectEl.selectedOptions || [])
      .map((o) => o.value)
      .filter((v) => String(v).trim() !== "");
  }

  function uniqueSorted(rows, key) {
    const set = new Set();
    rows.forEach((r) => {
      const v = String(r?.[key] ?? "").trim();
      if (v) set.add(v);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }

  function setOptions(selectEl, values, { keepSelected = true, includeNotInformed = false } = {}) {
    if (!selectEl) return;
    const isMultiple = selectEl.hasAttribute("multiple");
    const current = keepSelected ? new Set(getSelectedValues(selectEl)) : new Set();

    const optionsHtml = [];
    if (!isMultiple) optionsHtml.push('<option value="">Todos</option>');
    values.forEach((v) => {
      optionsHtml.push(`<option value="${utils.escapeHtml(v)}">${utils.escapeHtml(v)}</option>`);
    });
    if (includeNotInformed) {
      const hasLabel = values.some((v) => String(v ?? "").trim().toLowerCase() === "não informado");
      if (!hasLabel) optionsHtml.push(`<option value="${NAO_INFORMADO_VALUE}">Não informado</option>`);
    }
    selectEl.innerHTML = optionsHtml.join("");

    if (keepSelected && current.size) {
      Array.from(selectEl.options).forEach((o) => {
        if (current.has(o.value)) o.selected = true;
      });
    }
  }

  function matchesSelectValue(rowValue, selectedValues) {
    if (!selectedValues || !selectedValues.length) return true;

    const v = String(rowValue ?? "").trim();
    const wantsNaoInformado = selectedValues.includes(NAO_INFORMADO_VALUE);
    if (!v) return wantsNaoInformado;
    return selectedValues.includes(v);
  }

  function normalizeLabelKey(label) {
    return String(label ?? "").trim().toLowerCase();
  }
  function isNaoInformadoLabel(label) {
    const k = normalizeLabelKey(label);
    return k === "não informado" || k === "nao informado" || String(label) === NAO_INFORMADO_VALUE;
  }
  function isOutrosLabel(label) {
    return normalizeLabelKey(label) === "outros";
  }
  function pieColorForLabel(label, index) {
    if (isNaoInformadoLabel(label)) return COLOR_NAO_INFORMADO;
    if (isOutrosLabel(label)) return COLOR_OUTROS;
    return PIE_PALETTE[index % PIE_PALETTE.length];
  }
  function pieBorderForLabel(label) {
    if (isOutrosLabel(label)) return COLOR_OUTROS_BORDER;
    return "#ffffff";
  }

  function pieDataset(data, labels) {
    const safeLabels = Array.isArray(labels) ? labels : [];
    return {
      data,
      radius: "88%",
      hoverOffset: 4,
      backgroundColor: safeLabels.map((l, i) => pieColorForLabel(l, i)),
      borderColor: safeLabels.map((l) => pieBorderForLabel(l)),
      borderWidth: 2,
    };
  }

  const PIE_OPTIONS = {
    responsive: true,
    aspectRatio: 1.4,
    plugins: {
      legend: { position: "bottom", labels: { boxWidth: 9, font: { size: 12 } } },
      datalabels: {
        display: true,
        anchor: "end",
        align: "end",
        offset: 8,
        clamp: false,
        clip: false,
        font: { size: 11, weight: "700" },
        color: "rgba(15, 23, 42, 0.9)",
        formatter: (value, ctx) => {
          const v = Number(value) || 0;
          if (v <= 0) return "";
          const data = ctx?.chart?.data?.datasets?.[ctx.datasetIndex]?.data || [];
          const total = data.reduce((sum, x) => sum + (Number(x) || 0), 0);
          if (!total) return "";
          const pct = (v / total) * 100;
          if (pct > 0 && pct < 1) return "<1%";
          return `${Math.round(pct)}%`;
        },
      },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const lbl = String(ctx.label ?? "");
            const v = Number(ctx.parsed) || 0;
            return `${lbl}: ${utils.formatBRL(v, { maximumFractionDigits: 2 })}`;
          },
        },
      },
    },
    layout: { padding: { top: 18, right: 18, bottom: 22, left: 18 } },
  };

  const DL_FONT = { size: 11, weight: "700" };

  function formatBarLabel(value) {
    const v = Number(value) || 0;
    if (!v) return "";
    return utils.formatBRL(v, { maximumFractionDigits: 0 });
  }

  /**
   * Decide se o label cabe "dentro" da barra.
   * Regras:
   * - Para barra vertical: precisa ter altura suficiente (barHeight) e, opcionalmente, largura suficiente.
   * - Para barra horizontal: precisa ter largura suficiente (barWidth).
   */
  function labelFitsInBar(context, labelText) {
    try {
      const chart = context?.chart;
      if (!chart || !labelText) return false;

      const meta = chart.getDatasetMeta(context.datasetIndex);
      const el = meta?.data?.[context.dataIndex];
      if (!el) return false;

      const props = typeof el.getProps === "function"
        ? el.getProps(["x", "y", "base", "width", "height"], true)
        : el;

      const indexAxis = chart.options?.indexAxis ?? "x";

      // Medir texto
      const ctx = chart.ctx;
      const fontSize = DL_FONT.size ?? 11;
      const weight = DL_FONT.weight ?? "700";
      const family = chart.options?.font?.family
        ?? "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif";

      ctx.save();
      ctx.font = `${weight} ${fontSize}px ${family}`;
      const textW = ctx.measureText(String(labelText)).width;
      ctx.restore();

      const textH = fontSize;

      const padX = 10; // folga para não encostar nas bordas da barra
      const padY = 10;

      if (indexAxis === "y") {
        // barras horizontais
        const barW = Math.abs((props.base ?? 0) - (props.x ?? 0));
        const barH = props.height ?? 0;
        return barW >= textW + padX && barH >= textH + 6;
      }

      // barras verticais
      const barH = Math.abs((props.base ?? 0) - (props.y ?? 0));
      const barW = props.width ?? 0;

      // Prioriza altura (diferencia barras grandes/pequenas)
      if (barH < textH + padY) return false;

      // Se a barra for extremamente estreita, evita colocar dentro (tende a vazar e ficar ruim)
      if (barW > 0 && barW < 18) return false;

      return true;
    } catch (_) {
      return false;
    }
  }

  const BAR_OPTIONS = {
    responsive: true,

    // Dá espaço para labels acima das barras (quando não couberem dentro)
    layout: { padding: { top: 20, right: 12, bottom: 6, left: 10 } },

    plugins: {
      legend: { display: false },
      datalabels: {
        display: true,

        // Âncora no topo da barra; "align" decide se fica dentro (start) ou fora (end)
        anchor: "end",
        align: (ctx) => {
          const v = ctx?.dataset?.data?.[ctx.dataIndex];
          const label = formatBarLabel(v);
          if (!label) return "end";
          return labelFitsInBar(ctx, label) ? "start" : "end";
        },
        offset: (ctx) => {
          const v = ctx?.dataset?.data?.[ctx.dataIndex];
          const label = formatBarLabel(v);
          if (!label) return 0;
          return labelFitsInBar(ctx, label) ? 4 : 6;
        },

        // Mantém o número dentro da área visível do gráfico (evita cortar no topo)
        clamp: true,
        clip: true,

        font: DL_FONT,
        color: "rgba(15, 23, 42, 0.9)",

        formatter: (value) => formatBarLabel(value),
      },

      tooltip: {
        callbacks: {
          label: (ctx) =>
            utils.formatBRL(Number(ctx.parsed?.y ?? ctx.parsed) || 0, {
              maximumFractionDigits: 2,
            }),
        },
      },
    },

    scales: {
      y: {
        // Dá folga no topo para os datalabels não ficarem fora do canvas
        grace: "12%",
        ticks: {
          callback: (v) => {
            const n = Number(v) || 0;
            if (Math.abs(n) >= 1000) return utils.formatBRL(n, { maximumFractionDigits: 0 });
            return String(n);
          },
        },
        grid: { color: "rgba(148, 163, 184, 0.25)" },
      },
      x: {
        grid: { display: false },
      },
    },
  };

  const LINE_OPTIONS = {
    responsive: true,

    layout: { padding: { top: 18, right: 12, bottom: 6, left: 10 } },

    plugins: {
      legend: { display: false },

      // Labels sempre visíveis acima dos pontos
      datalabels: {
        display: true,
        anchor: "end",
        align: "top",
        offset: 6,
        clamp: true,
        clip: true,
        font: DL_FONT,
        color: "rgba(15, 23, 42, 0.9)",
        formatter: (value) => {
          const v = Number(value) || 0;
          if (!v) return "";
          // Sem centavos (trunca) e sem "R$" no label
          return utils.formatIntBR(v);
        },
      },

      tooltip: {
        callbacks: {
          // Tooltip completo com centavos
          label: (ctx) => utils.formatBRL(Number(ctx.parsed?.y ?? 0), { maximumFractionDigits: 2 }),
        },
      },
    },

    scales: {
      y: {
        // Folga no topo para labels não cortarem
        grace: "14%",
        grid: { color: "rgba(148, 163, 184, 0.25)" },
        ticks: {
          callback: (v) => utils.formatBRL(Number(v) || 0, { maximumFractionDigits: 0 }),
        },
      },
      x: {
        grid: { display: false },
      },
    },
  };

  function barDataset(values) {
    return {
      data: values,
      backgroundColor: PRIMARY_PURPLE_RGBA,
      borderColor: PRIMARY_PURPLE_BORDER,
      borderWidth: 1,
    };
  }

  function lineDataset(values, extra = {}) {
    return {
      data: values,
      borderColor: PRIMARY_PURPLE_BORDER,
      pointBackgroundColor: PRIMARY_PURPLE_BORDER,
      pointBorderColor: PRIMARY_PURPLE_BORDER,
      ...extra,
    };
  }


  function ensureChart(id, config) {
    const canvas = $id(id);
    if (!canvas || !window.Chart) return null;

    if (state.charts[id]) {
      const chart = state.charts[id];
      chart.config.data = config.data;
      chart.config.options = config.options;
      chart.config.type = config.type;
      chart.update();
      return chart;
    }

    state.charts[id] = new Chart(canvas, config);
    return state.charts[id];
  }

  // --- Derivações de aquisição ---
  function deriveChannel(leadTag) {
    const t = String(leadTag ?? "").toLowerCase();
    if (!t) return "Não informado";

    if (t.includes("trial")) return "Trial";
    if (t.includes("google") || t.includes("adwords") || t.includes("gads")) return "Google";
    if (t.includes("meta") || t.includes("facebook") || t.includes("instagram") || t.includes("fb")) return "Meta";
    if (t.includes("org") || t.includes("seo") || t.includes("geo") || t.includes("orgânico") || t.includes("organico")) return "Orgânico";
    return "Outros";
  }

  function deriveEntryType(leadTag) {
    const t = String(leadTag ?? "").toLowerCase();
    if (!t) return "Não informado";
    if (t.includes("trial")) return "Trial";
    if (t.includes("demo")) return "Demo";
    if (t.includes("lp") || t.includes("landing") || t.includes("form") || t.includes("formul")) return "LP formulário";
    return "Outros";
  }

  function usersBucket(teamValue) {
    const raw = String(teamValue ?? "").trim();
    if (!raw) return "Não informado";
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return "Não informado";
    if (n <= 2) return "1-2";
    if (n <= 5) return "3-5";
    if (n <= 10) return "6-10";
    return "11+";
  }

  function getField(obj, keys) {
    for (const k of keys) {
      if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
    }
    return null;
  }

  function normalizeRow(s) {
    const saleDateRaw = getField(s, ["sale_date", "saleDate", "date", "created_at", "createdAt"]);
    const saleDate = saleDateRaw ? String(saleDateRaw) : null;
    const saleDateObj = utils.parseDate(saleDate);

    const mrr = utils.toNumber(getField(s, ["mrr", "mrr_value", "monthly_recurring_revenue"]));
    const totalValue = utils.toNumber(getField(s, ["total_value", "totalValue", "value"]));
    const recurrence = String(getField(s, ["recurrence"]) ?? "").trim();

    // ACV: se for mensal (ou não anual), anualiza por mrr * 12; se for anual e tiver total_value, usa total_value
    const isAnnual = recurrence.toLowerCase().includes("anual");
    const acv = isAnnual ? (totalValue || (mrr * 12)) : (mrr * 12);

    const leadTag = getField(s, ["lead_tag", "leadTag", "tag", "origin", "source"]) ?? null;

    const channel = deriveChannel(leadTag);
    const entryType = deriveEntryType(leadTag);

    return {
      sale_date: saleDate,
      sale_date_obj: saleDateObj,
      month_key: utils.monthKeyFromDate(saleDateObj),

      manager: getField(s, ["manager", "seller", "vendedor"]) ?? null,
      manager_id: getField(s, ["manager_id", "managerId"]) ?? null,
      customer_id: getField(s, ["customer_id", "customerId"]) ?? null,

      plan: getField(s, ["plan", "plan_id", "plano"]) ?? null,
      recurrence,
      payment_method: getField(s, ["payment_method", "paymentMethod"]) ?? null,

      mrr,
      total_value: totalValue,
      acv,

      team: getField(s, ["team", "time"]) ?? null,
      area: getField(s, ["area"]) ?? null,
      money: utils.normalizeMoney(getField(s, ["money"])),
      system: getField(s, ["system", "sistema"]) ?? null,
      challenge: getField(s, ["challenge", "desafio"]) ?? null,

      lead_tag: leadTag,
      channel,
      entry_type: entryType,
      users_bucket: usersBucket(getField(s, ["team", "time"])),
    };
  }

  function debugNaoInformados(rawSales, normalized) {
    const toStr = (v) => (v === null || v === undefined ? "" : String(v));
    const issues = { manager: [], plan: [], channel: [], entryType: [] };

    for (let i = 0; i < normalized.length; i++) {
      const r = normalized[i] || {};
      const raw = rawSales?.[i] || {};

      const manager = toStr(r.manager).trim();
      const plan = toStr(r.plan).trim();
      const channel = toStr(r.channel).trim();
      const entryType = toStr(r.entry_type).trim();
      const leadTag = toStr(r.lead_tag).trim();

      // VENDEDOR: pega casos vazios OU literalmente "Não informado"
      if (!manager || isNaoInformadoLabel(manager)) {
        issues.manager.push({
          i,
          sale_date: r.sale_date,
          customer_id: r.customer_id,
          manager,
          manager_id: r.manager_id,
          raw_manager: raw.manager ?? raw.seller ?? raw.vendedor ?? null,
          raw_manager_id: raw.manager_id ?? raw.managerId ?? null,
        });
      }

      // PLANO: vazio ou contendo "não informado"
      if (!plan || /não informado|nao informado/i.test(plan)) {
        issues.plan.push({
          i,
          sale_date: r.sale_date,
          customer_id: r.customer_id,
          plan,
          raw_plan: raw.plan ?? raw.plano ?? raw.plan_id ?? raw.planId ?? null,
          raw_recurrence: raw.recurrence ?? null,
        });
      }

      // CANAL: só vira "Não informado" quando lead_tag está vazio
      if (!channel || channel === "Não informado") {
        issues.channel.push({
          i,
          sale_date: r.sale_date,
          customer_id: r.customer_id,
          channel,
          lead_tag: leadTag,
          raw_lead_tag: raw.lead_tag ?? raw.leadTag ?? raw.tag ?? raw.origin ?? raw.source ?? null,
        });
      }

      // TIPO DE ENTRADA: mesma lógica do canal
      if (!entryType || entryType === "Não informado") {
        issues.entryType.push({
          i,
          sale_date: r.sale_date,
          customer_id: r.customer_id,
          entry_type: entryType,
          lead_tag: leadTag,
          raw_lead_tag: raw.lead_tag ?? raw.leadTag ?? raw.tag ?? raw.origin ?? raw.source ?? null,
        });
      }
    }

    const countBy = (arr, key) =>
      arr.reduce((acc, o) => {
        const k = String(o[key] ?? "null");
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {});

    console.groupCollapsed(
      `[MRR DEBUG] Não informados: vendedor=${issues.manager.length} plano=${issues.plan.length} canal=${issues.channel.length} entrada=${issues.entryType.length}`
    );

    if (issues.manager.length) {
      console.groupCollapsed("Vendedor — por manager_id");
      console.log(countBy(issues.manager, "manager_id"));
      console.table(issues.manager.slice(0, DEBUG_SAMPLE_LIMIT));
      console.groupEnd();
    }

    if (issues.plan.length) {
      console.groupCollapsed("Plano — amostras");
      console.table(issues.plan.slice(0, DEBUG_SAMPLE_LIMIT));
      console.groupEnd();
    }

    if (issues.channel.length) {
      console.groupCollapsed("Canal — (normalmente lead_tag vazio)");
      console.table(issues.channel.slice(0, DEBUG_SAMPLE_LIMIT));
      console.groupEnd();
    }

    if (issues.entryType.length) {
      console.groupCollapsed("Tipo de entrada — (normalmente lead_tag vazio)");
      console.table(issues.entryType.slice(0, DEBUG_SAMPLE_LIMIT));
      console.groupEnd();
    }

    console.groupEnd();
  }


  function refreshFilterOptions(rows) {
    setOptions(elements.managerSelect, uniqueSorted(rows, "manager"), { keepSelected: true, includeNotInformed: true });
    setOptions(elements.planSelect, uniqueSorted(rows, "plan"), { keepSelected: true, includeNotInformed: true });
    setOptions(elements.channelSelect, uniqueSorted(rows, "channel"), { keepSelected: true, includeNotInformed: false });
    setOptions(elements.entryTypeSelect, uniqueSorted(rows, "entry_type"), { keepSelected: true, includeNotInformed: false });
    setOptions(elements.areaSelect, uniqueSorted(rows, "area"), { keepSelected: true, includeNotInformed: true });
    setOptions(elements.timeSelect, uniqueSorted(rows, "team"), { keepSelected: true, includeNotInformed: true });
  }

  function groupSum(rows, key, valueKey) {
    const acc = new Map();
    rows.forEach((r) => {
      const k = String(r?.[key] ?? "").trim() || "Não informado";
      const v = Number(r?.[valueKey]) || 0;
      acc.set(k, (acc.get(k) || 0) + v);
    });
    return Array.from(acc.entries()).sort((a, b) => (b[1] || 0) - (a[1] || 0));
  }

  function buildPieFromEntries(entries, topN = 6, minPct = 0.02) {
    const total = entries.reduce((sum, [, v]) => sum + (Number(v) || 0), 0);
    if (!total) return { labels: [], data: [] };
    const labels = [];
    const data = [];
    let otherSum = 0;

    entries.forEach(([kRaw, vRaw]) => {
      const k = String(kRaw ?? "").trim() || "Não informado";
      const v = Number(vRaw) || 0;
      if (v <= 0) return;
      const pct = v / total;
      const isNaoInformado = ["não informado", "nao informado"].includes(k.toLowerCase());
      if (labels.length < topN && (pct >= minPct || isNaoInformado)) {
        labels.push(k);
        data.push(v);
      } else {
        otherSum += v;
      }
    });
    if (otherSum > 0) {
      labels.push("Outros");
      data.push(otherSum);
    }
    return { labels, data };
  }

  function computeKpisAndCharts() {
    const rows = state.filtered || [];

    const totalMrr = rows.reduce((sum, r) => sum + (Number(r.mrr) || 0), 0);

    const uniqueCustomers = new Set(rows.map((r) => String(r.customer_id ?? "").trim()).filter(Boolean));
    const arpa = uniqueCustomers.size ? (totalMrr / uniqueCustomers.size) : 0;
    const avgAcv = rows.length ? (rows.reduce((sum, r) => sum + (Number(r.acv) || 0), 0) / rows.length) : 0;

    // MoM: usa soma do MRR por mês dentro do range filtrado (quando tiver 2+ meses)
    const byMonth = new Map();
    rows.forEach((r) => {
      const mk = r.month_key;
      if (!mk) return;
      byMonth.set(mk, (byMonth.get(mk) || 0) + (Number(r.mrr) || 0));
    });
    const months = Array.from(byMonth.keys()).sort((a, b) => a.localeCompare(b));

    // Série diária (MRR por dia)
    const byDay = new Map();
    rows.forEach((r) => {
      const d = r.sale_date_obj;
      if (!d) return;
      const dk = utils.getDateString(d);
      byDay.set(dk, (byDay.get(dk) || 0) + (Number(r.mrr) || 0));
    });
    const days = Array.from(byDay.keys()).sort((a, b) => a.localeCompare(b));
    const yearsInDays = new Set(days.map((k) => String(k).slice(0, 4)));
    let mom = null;
    if (months.length >= 2) {
      const cur = months[months.length - 1];
      const prev = months[months.length - 2];
      const curV = byMonth.get(cur) || 0;
      const prevV = byMonth.get(prev) || 0;
      mom = prevV > 0 ? (curV - prevV) / prevV : null;
    }

    if (elements.kpiMrrTotal) elements.kpiMrrTotal.textContent = utils.formatBRL(totalMrr, { maximumFractionDigits: 2 });
    if (elements.kpiMrrMoM) elements.kpiMrrMoM.textContent = mom === null ? "–" : utils.formatPct(mom, { digits: 1 });
    if (elements.kpiArpa) elements.kpiArpa.textContent = utils.formatBRL(arpa, { maximumFractionDigits: 2 });
    if (elements.kpiAcv) elements.kpiAcv.textContent = utils.formatBRL(avgAcv, { maximumFractionDigits: 2 });

    // --- charts ---
    // MRR por mês
    const seriesLabels = months;
    const seriesData = months.map((m) => byMonth.get(m) || 0);
    ensureChart("chartMrrByMonth", {
      type: "line",
      data: {
        labels: seriesLabels,
        datasets: [lineDataset(seriesData, {
          label: "MRR",
          borderWidth: 2,
          tension: 0.3,
          fill: false,
          pointRadius: 3,
        })],
      },
      options: LINE_OPTIONS,
    });

    // MRR por dia
    const dayLabels = days.map((k) => {
      const dd = String(k).slice(8, 10);
      const mm = String(k).slice(5, 7);
      const yy = String(k).slice(0, 4);
      return yearsInDays.size > 1 ? `${dd}/${mm}/${yy}` : `${dd}/${mm}`;
    });
    const dayData = days.map((d) => byDay.get(d) || 0);
    ensureChart("chartMrrByDay", {
      type: "line",
      data: {
        labels: dayLabels,
        datasets: [lineDataset(dayData, {
          label: "MRR",
          borderWidth: 2,
          tension: 0.25,
          fill: false,
          pointRadius: dayData.length > 40 ? 0 : 2,
        })],
      },
      options: {
        ...LINE_OPTIONS,
        plugins: {
          ...(LINE_OPTIONS.plugins || {}),
          datalabels: {
            ...(LINE_OPTIONS.plugins?.datalabels || {}),
            display: () => dayData.length <= 40,
          },
        },
      },
    });

    // Receita por plano
    const planEntries = groupSum(rows, "plan", "mrr");
    ensureChart("chartRevenueByPlan", {
      type: "bar",
      data: {
        labels: planEntries.map(([k]) => k),
        datasets: [barDataset(planEntries.map(([, v]) => v))],
      },
      options: BAR_OPTIONS,
    });

    // Receita por área
    const areaEntries = groupSum(rows, "area", "mrr");
    ensureChart("chartRevenueByArea", {
      type: "bar",
      data: {
        labels: areaEntries.map(([k]) => k),
        datasets: [barDataset(areaEntries.map(([, v]) => v))],
      },
      options: BAR_OPTIONS,
    });

    // Receita por nº de usuários (bucket)
    const bucketEntries = groupSum(rows, "users_bucket", "mrr");
    // ordena buckets em ordem lógica
    const bucketOrder = { "1-2": 1, "3-5": 2, "6-10": 3, "11+": 4, "Não informado": 99 };
    bucketEntries.sort((a, b) => (bucketOrder[a[0]] ?? 50) - (bucketOrder[b[0]] ?? 50));
    ensureChart("chartRevenueByUsers", {
      type: "bar",
      data: {
        labels: bucketEntries.map(([k]) => k),
        datasets: [barDataset(bucketEntries.map(([, v]) => v))],
      },
      options: BAR_OPTIONS,
    });

    // MRR por canal (barra)
    const channelEntries = groupSum(rows, "channel", "mrr");
    ensureChart("chartMrrByChannel", {
      type: "bar",
      data: {
        labels: channelEntries.map(([k]) => k),
        datasets: [barDataset(channelEntries.map(([, v]) => v))],
      },
      options: BAR_OPTIONS,
    });

    // Ticket médio por canal (ARPA por canal) = MRR do canal / clientes únicos do canal
    const channelAgg = new Map();
    rows.forEach((r) => {
      const ch = String(r.channel ?? "Não informado").trim() || "Não informado";
      if (!channelAgg.has(ch)) channelAgg.set(ch, { mrr: 0, customers: new Set() });
      channelAgg.get(ch).mrr += (Number(r.mrr) || 0);
      const cid = String(r.customer_id ?? "").trim();
      if (cid) channelAgg.get(ch).customers.add(cid);
    });
    const arpaByChannel = Array.from(channelAgg.entries())
      .map(([ch, v]) => [ch, v.customers.size ? (v.mrr / v.customers.size) : 0])
      .sort((a, b) => (b[1] || 0) - (a[1] || 0));

    ensureChart("chartArpaByChannel", {
      type: "bar",
      data: {
        labels: arpaByChannel.map(([k]) => k),
        datasets: [barDataset(arpaByChannel.map(([, v]) => v))],
      },
      options: {
        ...BAR_OPTIONS,
        plugins: {
          ...(BAR_OPTIONS.plugins || {}),
          datalabels: {
            ...(BAR_OPTIONS.plugins?.datalabels || {}),
            formatter: (value) => {
              const v = Number(value) || 0;
              if (!v) return "";
              return utils.formatBRL(v, { maximumFractionDigits: 0 });
            },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => utils.formatBRL(Number(ctx.parsed?.y ?? ctx.parsed) || 0, { maximumFractionDigits: 2 }),
            },
          },
        },
      },
    });
  }

  function applyAllFiltersAndRender() {
    const managers = getSelectedValues(elements.managerSelect);
    const plans = getSelectedValues(elements.planSelect);
    const channels = getSelectedValues(elements.channelSelect);
    const entryTypes = getSelectedValues(elements.entryTypeSelect);
    const areas = getSelectedValues(elements.areaSelect);
    const times = getSelectedValues(elements.timeSelect);
    const moneyMode = String(elements.moneySelect?.value || "").trim();
    const q = String(elements.quickSearch?.value ?? "").trim().toLowerCase();

    let out = [...state.rows];

    if (moneyMode) out = out.filter((r) => r.money === moneyMode);
    if (managers.length) out = out.filter((r) => matchesSelectValue(r.manager, managers));
    if (plans.length) out = out.filter((r) => matchesSelectValue(r.plan, plans));
    if (channels.length) out = out.filter((r) => matchesSelectValue(r.channel, channels));
    if (entryTypes.length) out = out.filter((r) => matchesSelectValue(r.entry_type, entryTypes));
    if (areas.length) out = out.filter((r) => matchesSelectValue(r.area, areas));
    if (times.length) out = out.filter((r) => matchesSelectValue(r.team, times));

    if (q) {
      out = out.filter((r) => {
        const hay = [
          r.sale_date,
          r.manager,
          r.plan,
          r.recurrence,
          r.payment_method,
          r.area,
          r.team,
          r.channel,
          r.entry_type,
          r.lead_tag,
          utils.moneyLabel(r.money),
        ]
          .map((v) => String(v ?? "").toLowerCase())
          .join(" | ");
        return hay.includes(q);
      });
    }

    state.filtered = out;
    if (elements.totalCount) elements.totalCount.textContent = String(out.length);
    computeKpisAndCharts();
  }

  async function loadMRR() {
    const params = {
      entry_start: elements.entryStartInput?.value || "",
      entry_end: elements.entryEndInput?.value || "",
      _ts: Date.now(),
    };

    ui.showLoading();
    try {
      const url = `${CONFIG.MRR_ENDPOINT}?${new URLSearchParams(params)}`;
      const response = await fetch(url, { cache: "no-store" });
      const rawText = await response.text();
      if (!response.ok) {
        const snippet = rawText ? rawText.slice(0, 220) : "";
        throw new Error(`HTTP ${response.status}${snippet ? ` — ${snippet}` : ""}`);
      }

      const text = (rawText || "").trim();
      const data = text ? JSON.parse(text) : [];

      const root = Array.isArray(data) ? (data[0] ?? data) : data;
      const sales = Array.isArray(root?.sales)
        ? root.sales
        : Array.isArray(root?.rows)
          ? root.rows
          : Array.isArray(root)
            ? root
            : [];

      const normalized = sales.map(normalizeRow);
      state.rows = normalized;
      if (DEBUG_UNMAPPED) debugNaoInformados(sales, normalized);

      refreshFilterOptions(normalized);
      applyAllFiltersAndRender();
    } catch (e) {
      ui.showError(`Erro: ${e.message}`);
      state.rows = [];
      state.filtered = [];
      if (elements.totalCount) elements.totalCount.textContent = "0";
      computeKpisAndCharts();
    } finally {
      ui.hideLoading();
    }
  }

  function init() {
    // default: mês atual (do 1º dia até hoje)
    const end = new Date();
    const start = new Date(end.getFullYear(), end.getMonth(), 1);

    if (elements.entryStartInput) elements.entryStartInput.value = utils.getDateString(start);
    if (elements.entryEndInput) elements.entryEndInput.value = utils.getDateString(end);

    const applyPresetDays = (days) => {
      const e = new Date();
      const s = new Date();
      s.setDate(e.getDate() - (days - 1));
      if (elements.entryStartInput) elements.entryStartInput.value = utils.getDateString(s);
      if (elements.entryEndInput) elements.entryEndInput.value = utils.getDateString(e);
      loadMRR();
    };

    const applyPresetMonth = (offsetMonths) => {
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
      const last = new Date(now.getFullYear(), now.getMonth() + offsetMonths + 1, 0);
      if (elements.entryStartInput) elements.entryStartInput.value = utils.getDateString(first);
      if (elements.entryEndInput) elements.entryEndInput.value = utils.getDateString(last);
      loadMRR();
    };
    const applyPresetCurrentMonth = () => {
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      if (elements.entryStartInput) elements.entryStartInput.value = utils.getDateString(first);
      if (elements.entryEndInput) elements.entryEndInput.value = utils.getDateString(now);
      loadMRR();
    };


    elements.preset30?.addEventListener("click", () => applyPresetDays(30));
    elements.preset90?.addEventListener("click", () => applyPresetDays(90));
    elements.presetMonth?.addEventListener("click", () => applyPresetMonth(0));
    elements.presetPrevMonth?.addEventListener("click", () => applyPresetMonth(-1));

    elements.applyFilters?.addEventListener("click", loadMRR);
    elements.clearAllFilters?.addEventListener("click", () => {
      applyPresetCurrentMonth();

      if (elements.moneySelect) elements.moneySelect.value = "";
      if (elements.quickSearch) elements.quickSearch.value = "";
      [
        elements.managerSelect,
        elements.planSelect,
        elements.channelSelect,
        elements.entryTypeSelect,
        elements.areaSelect,
        elements.timeSelect,
      ]
        .filter(Boolean)
        .forEach((sel) => {
          sel.value = "";
        });
    });

    const onAnyFilterChange = () => applyAllFiltersAndRender();
    [
      elements.managerSelect,
      elements.planSelect,
      elements.channelSelect,
      elements.entryTypeSelect,
      elements.areaSelect,
      elements.timeSelect,
      elements.moneySelect,
    ]
      .filter(Boolean)
      .forEach((el) => el.addEventListener("change", onAnyFilterChange));

    let searchTimer = null;
    elements.quickSearch?.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => applyAllFiltersAndRender(), 200);
    });

    elements.closeToast?.addEventListener("click", () => ui.hideError());

    loadMRR();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
