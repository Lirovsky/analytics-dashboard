(() => {
    const page = document.documentElement.getAttribute("data-page");
    if (page !== "vendas") return;

    const CONFIG = {
        SALES_ENDPOINT: "https://n8n.clinicaexperts.com.br/webhook/vendas",
    };

    const NAO_INFORMADO_VALUE = "__nao_informado__";
    const COLOR_NAO_INFORMADO = "#000000";
    const COLOR_OUTROS = "#ffffff";
    const COLOR_OUTROS_BORDER = "#cbd5e1";

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
        today() {
            return this.getDateString(new Date());
        },
        parseDateTime(value) {
            if (!value) return null;
            const s = String(value).trim();
            if (!s) return null;

            if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
                const d = new Date(s);
                return isNaN(d) ? null : d;
            }

            if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/.test(s)) {
                const d = new Date(s.replace(" ", "T"));
                return isNaN(d) ? null : d;
            }

            if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
                const d = new Date(`${s}T00:00:00`);
                return isNaN(d) ? null : d;
            }

            const d = new Date(s);
            return isNaN(d) ? null : d;
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

        // Origem da venda (lead_tag / lead_underline_tag)
        // Regras:
        // - null/undefined/"" => "Não informado"
        // - termina com "_facebook" (case-insensitive) => "Meta"
        // - termina com "_google" (case-insensitive) => "Google"
        // - demais => "Orgânico"
        normalizeLeadOrigin(value) {
            const s = String(value ?? "").trim();
            if (!s) return "Não informado";
            const v = s.toLowerCase();
            if (v === "undefined" || v === "null") return "Não informado";
            if (v.endsWith("_facebook")) return "Meta";
            if (v.endsWith("_google")) return "Google";
            return "Orgânico";
        },

        formatBRL(value) {
            const n = Number(value);
            if (!Number.isFinite(n)) return "—";
            try {
                return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
            } catch {
                return `R$ ${n.toFixed(2)}`;
            }
        },

        formatPct(value) {
            const n = Number(value);
            if (!Number.isFinite(n)) return "—";
            return `${n.toFixed(2).replace(".", ",")}%`;
        },
    };

    const $id = (id) => document.getElementById(id);

    const elements = {
        entryStartInput: $id("entryStartDate"),
        entryEndInput: $id("entryEndDate"),

        managerSelect: $id("managerSelect"),
        moneySelect: $id("moneySelect"),
        areaSelect: $id("areaSelect"),
        timeSelect: $id("timeSelect"),
        sistemaSelect: $id("sistemaSelect"),
        desafioSelect: $id("desafioSelect"),
        quickSearch: $id("globalSearch"),

        presetPrevDay: $id("presetPrevDay"),
        presetNextDay: $id("presetNextDay"),
        preset7: $id("preset7"),
        preset14: $id("preset14"),
        preset30: $id("preset30"),

        applyFilters: $id("applyFilters"),
        clearVendor: $id("clearVendor"),
        clearAllFilters: $id("clearAllFilters"),

        totalCount: $id("totalCount"),


        kpiSalesTotal: $id("kpiSalesTotal"),
        kpiTicketMedioMensal: $id("kpiTicketMedioMensal"),
        kpiTaxaConversao: $id("kpiTaxaConversao"),
        loadingOverlay: $id("loadingOverlay"),
        errorToast: $id("errorToast"),
        errorMessage: $id("errorMessage"),
        closeToast: $id("closeToast"),
    };

    const state = {
        salesData: [],
        filtered: [],
        meta: {
            vendasPorVendedor: [],
            ticketTotals: null,
            ticketByManager: {},
        },
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

    function countBy(rows, key, { normalizeFn } = {}) {
        const acc = {};
        rows.forEach((r) => {
            const raw = r?.[key];
            const k = normalizeFn ? normalizeFn(raw) : String(raw ?? "").trim() || "Não informado";
            acc[k] = (acc[k] || 0) + 1;
        });
        return acc;
    }

    function buildPieFromCounts(counts, topN = 8, minPct = 0.02) {
        const entries = Object.entries(counts || {}).sort((a, b) => (b[1] || 0) - (a[1] || 0));
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

    const PIE_OPTIONS = {
        responsive: true,
        aspectRatio: 1.35,
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
        },
        layout: { padding: { top: 18, right: 18, bottom: 22, left: 18 } },
    };

    const PIE_OPTIONS_NO_LEGEND = {
        ...PIE_OPTIONS,
        plugins: { ...(PIE_OPTIONS.plugins || {}), legend: { display: false } },
    };

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

    function ensureChart(id, config) {
        const canvas = $id(id);
        if (!canvas || !window.Chart) return null;

        if (state.charts[id]) {
            const chart = state.charts[id];

            const isPieLike = ["pie", "doughnut", "polarArea"].includes(chart.config?.type);
            const prevLabels = Array.isArray(chart.data?.labels) ? chart.data.labels : [];
            const hiddenLabelKeys = new Set();

            if (isPieLike && typeof chart.getDataVisibility === "function") {
                prevLabels.forEach((lbl, i) => {
                    if (!chart.getDataVisibility(i)) hiddenLabelKeys.add(normalizeLabelKey(lbl));
                });
            }

            chart.config.data = config.data;
            chart.config.options = config.options;

            if (isPieLike && hiddenLabelKeys.size && Array.isArray(config?.data?.labels)) {
                config.data.labels.forEach((lbl, i) => {
                    if (hiddenLabelKeys.has(normalizeLabelKey(lbl))) {
                        if (typeof chart.getDataVisibility === "function" && chart.getDataVisibility(i)) {
                            chart.toggleDataVisibility(i);
                        }
                    }
                });
            }

            chart.update();
            return chart;
        }

        state.charts[id] = new Chart(canvas, config);
        return state.charts[id];
    }

    function updateCharts() {
        const rows = state.filtered || [];

        const areaPie = buildPieFromCounts(countBy(rows, "area"), 7);
        ensureChart("chartArea", {
            type: "pie",
            data: { labels: areaPie.labels, datasets: [pieDataset(areaPie.data, areaPie.labels)] },
            options: PIE_OPTIONS,
        });

        const sysPie = buildPieFromCounts(countBy(rows, "system"), 8);
        ensureChart("chartSistema", {
            type: "pie",
            data: { labels: sysPie.labels, datasets: [pieDataset(sysPie.data, sysPie.labels)] },
            options: PIE_OPTIONS,
        });

        const timePie = buildPieFromCounts(countBy(rows, "team"), 8);
        ensureChart("chartTime", {
            type: "pie",
            data: { labels: timePie.labels, datasets: [pieDataset(timePie.data, timePie.labels)] },
            options: PIE_OPTIONS,
        });

        const desPie = buildPieFromCounts(countBy(rows, "challenge"), 8);
        ensureChart("chartDesafio", {
            type: "pie",
            data: { labels: desPie.labels, datasets: [pieDataset(desPie.data, desPie.labels)] },
            options: PIE_OPTIONS_NO_LEGEND,
        });

        const moneyCounts = countBy(rows, "money", { normalizeFn: utils.normalizeMoney });
        const moneyLabels = ["Sim", "Não", "Não informado"];
        ensureChart("chartMoney", {
            type: "pie",
            data: {
                labels: moneyLabels,
                datasets: [pieDataset([moneyCounts.yes || 0, moneyCounts.no || 0, moneyCounts.unknown || 0], moneyLabels)],
            },
            options: PIE_OPTIONS,
        });

        const managerPie = buildPieFromCounts(countBy(rows, "manager"), 10);
        ensureChart("chartManager", {
            type: "pie",
            data: { labels: managerPie.labels, datasets: [pieDataset(managerPie.data, managerPie.labels)] },
            options: PIE_OPTIONS,
        });

        const planPie = buildPieFromCounts(countBy(rows, "plan_id"), 10);
        ensureChart("chartPlan", {
            type: "pie",
            data: { labels: planPie.labels, datasets: [pieDataset(planPie.data, planPie.labels)] },
            options: PIE_OPTIONS,
        });

        const payPie = buildPieFromCounts(countBy(rows, "payment_method"), 10);
        ensureChart("chartPayment", {
            type: "pie",
            data: { labels: payPie.labels, datasets: [pieDataset(payPie.data, payPie.labels)] },
            options: PIE_OPTIONS,
        });

        // Origem da venda (Meta / Google / Orgânico / Não informado)
        const originLabels = ["Meta", "Google", "Orgânico", "Não informado"];
        const originCounts = countBy(rows, "lead_origin");
        ensureChart("chartOrigem", {
            type: "pie",
            data: {
                labels: originLabels,
                datasets: [
                    pieDataset(
                        originLabels.map((l) => originCounts[l] || 0),
                        originLabels
                    ),
                ],
            },
            options: PIE_OPTIONS,
        });
    }

    function getField(obj, keys) {
        for (const k of keys) {
            if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
        }
        return null;
    }

    function normalizeSaleRow(s) {
        const created = getField(s, ["created_at", "createdAt", "date"]);
        const leadUnderlineTag = getField(s, ["lead_underline_tag", "leadUnderlineTag", "lead_underline", "leadUnderline"]);
        const leadTag = getField(s, ["lead_tag", "leadTag", "tag", "origem", "origin"]);
        const originRaw = leadUnderlineTag ?? leadTag;
        return {
            created_at: created ? String(created) : null,
            manager: getField(s, ["manager", "seller", "vendedor"]) ?? null,
            plan_id: getField(s, ["plan_id", "plan", "plano"]) ?? null,
            payment_method: getField(s, ["payment_method", "payment", "metodo_pagamento"]) ?? null,
            team: getField(s, ["team", "time"]) ?? null,
            money: utils.normalizeMoney(getField(s, ["money"])),
            challenge: getField(s, ["challenge", "desafio"]) ?? null,
            system: getField(s, ["system", "sistema"]) ?? null,
            area: getField(s, ["area"]) ?? null,

            // novo campo (no payload) + fallback para lead_tag
            lead_underline_tag: leadUnderlineTag ?? null,
            lead_tag: leadTag ?? null,
            lead_origin: utils.normalizeLeadOrigin(originRaw),
        };
    }

    function refreshFilterOptions(rows) {
        setOptions(elements.managerSelect, uniqueSorted(rows, "manager"), { keepSelected: true, includeNotInformed: true });
        setOptions(elements.areaSelect, uniqueSorted(rows, "area"), { keepSelected: true, includeNotInformed: true });
        setOptions(elements.timeSelect, uniqueSorted(rows, "team"), { keepSelected: true, includeNotInformed: true });
        setOptions(elements.sistemaSelect, uniqueSorted(rows, "system"), { keepSelected: true, includeNotInformed: true });
        setOptions(elements.desafioSelect, uniqueSorted(rows, "challenge"), { keepSelected: true, includeNotInformed: true });
    }

    function applyAllFiltersAndRender() {
        const moneyMode = String(elements.moneySelect?.value || "").trim();
        const managers = getSelectedValues(elements.managerSelect);
        const areas = getSelectedValues(elements.areaSelect);
        const times = getSelectedValues(elements.timeSelect);
        const sistemas = getSelectedValues(elements.sistemaSelect);
        const desafios = getSelectedValues(elements.desafioSelect);
        const q = String(elements.quickSearch?.value ?? "").trim().toLowerCase();

        let out = [...state.salesData];

        if (moneyMode) out = out.filter((r) => utils.normalizeMoney(r.money) === moneyMode);
        if (managers.length) out = out.filter((r) => matchesSelectValue(r.manager, managers));
        if (areas.length) out = out.filter((r) => matchesSelectValue(r.area, areas));
        if (times.length) out = out.filter((r) => matchesSelectValue(r.team, times));
        if (sistemas.length) out = out.filter((r) => matchesSelectValue(r.system, sistemas));
        if (desafios.length) out = out.filter((r) => matchesSelectValue(r.challenge, desafios));

        if (q) {
            out = out.filter((r) => {
                const hay = [
                    r.created_at,
                    r.manager,
                    r.plan_id,
                    r.payment_method,
                    r.team,
                    r.area,
                    utils.moneyLabel(r.money),
                    r.system,
                    r.challenge,
                    r.lead_origin,
                    r.lead_underline_tag,
                    r.lead_tag,
                ]
                    .map((v) => String(v ?? "").toLowerCase())
                    .join(" | ");

                return hay.includes(q);
            });
        }

        state.filtered = out;
        if (elements.totalCount) elements.totalCount.textContent = String(out.length);
        if (elements.kpiSalesTotal) elements.kpiSalesTotal.textContent = String(out.length);

        // KPIs extras (ticket médio mensal e taxa de conversão)
        // Regras:
        // - Se vendedor = "Todos", usa totais.ticket_medio_mensal e conversão geral (soma vendas / soma leads entregues)
        // - Se vendedor selecionado, usa managers[].ticket_medio_mensal e vendas_por_vendedor[].taxa_conversao_pct
        const selectedManager = String(elements.managerSelect?.value || "").trim();

        // Ticket médio mensal
        const ticketTotals = state.meta?.ticketTotals;
        const ticketByManager = state.meta?.ticketByManager || {};
        const ticketValue = selectedManager
            ? ticketByManager[selectedManager]
            : ticketTotals?.ticket_medio_mensal;
        if (elements.kpiTicketMedioMensal) {
            elements.kpiTicketMedioMensal.textContent = utils.formatBRL(ticketValue);
        }

        // Conversão
        const vendasPorVendedor = Array.isArray(state.meta?.vendasPorVendedor) ? state.meta.vendasPorVendedor : [];
        let convPct = null;
        if (selectedManager) {
            const row = vendasPorVendedor.find((x) => String(x?.vendedor ?? "").trim() === selectedManager);
            convPct = row?.taxa_conversao_pct ?? null;
        } else {
            const sums = vendasPorVendedor.reduce(
                (acc, r) => {
                    acc.vendas += Number(r?.total_vendas) || 0;
                    acc.leads += Number(r?.leads_entregues) || 0;
                    return acc;
                },
                { vendas: 0, leads: 0 }
            );
            convPct = sums.leads > 0 ? (sums.vendas / sums.leads) * 100 : 0;
        }
        if (elements.kpiTaxaConversao) {
            elements.kpiTaxaConversao.textContent = utils.formatPct(convPct);
        }

        updateCharts();
    }

    async function loadSales() {
        const params = {
            entry_start: elements.entryStartInput?.value || "",
            entry_end: elements.entryEndInput?.value || "",
            _ts: Date.now(),
        };

        ui.showLoading();
        try {
            const url = `${CONFIG.SALES_ENDPOINT}?${new URLSearchParams(params)}`;
            const response = await fetch(url, { cache: "no-store" });
            const rawText = await response.text();

            if (!response.ok) {
                const snippet = rawText ? rawText.slice(0, 220) : "";
                throw new Error(`HTTP ${response.status}${snippet ? ` — ${snippet}` : ""}`);
            }

            const text = (rawText || "").trim();
            const data = text ? JSON.parse(text) : [];

            const first = Array.isArray(data) ? data[0] : data;
            const second = Array.isArray(data) ? data[1] : null;

            // meta para KPIs
            state.meta.vendasPorVendedor = Array.isArray(first?.vendas_por_vendedor) ? first.vendas_por_vendedor : [];
            state.meta.ticketTotals = second?.totais ?? null;
            state.meta.ticketByManager = Array.isArray(second?.managers)
                ? second.managers.reduce((acc, r) => {
                    const k = String(r?.manager ?? "").trim();
                    if (k) acc[k] = r?.ticket_medio_mensal;
                    return acc;
                }, {})
                : {};

            const sales = Array.isArray(first?.sales) ? first.sales : Array.isArray(first) ? first : [];

            state.salesData = sales.map(normalizeSaleRow);
            refreshFilterOptions(state.salesData);

            applyAllFiltersAndRender();
        } catch (e) {
            ui.showError(`Erro: ${e.message}`);
            state.salesData = [];
            state.filtered = [];
            state.meta.vendasPorVendedor = [];
            state.meta.ticketTotals = null;
            state.meta.ticketByManager = {};
            if (elements.totalCount) elements.totalCount.textContent = "0";
            if (elements.kpiSalesTotal) elements.kpiSalesTotal.textContent = "0";
            if (elements.kpiTicketMedioMensal) elements.kpiTicketMedioMensal.textContent = "—";
            if (elements.kpiTaxaConversao) elements.kpiTaxaConversao.textContent = "—";
            updateCharts();
        } finally {
            ui.hideLoading();
        }
    }

    function init() {
        const today = utils.today();
        if (elements.entryStartInput) elements.entryStartInput.value = today;
        if (elements.entryEndInput) elements.entryEndInput.value = today;

        elements.applyFilters?.addEventListener("click", loadSales);

        elements.clearVendor?.addEventListener("click", () => {
            if (elements.managerSelect) elements.managerSelect.value = "";
            applyAllFiltersAndRender();
        });

        elements.clearAllFilters?.addEventListener("click", () => {
            const today = utils.today();
            if (elements.entryStartInput) elements.entryStartInput.value = today;
            if (elements.entryEndInput) elements.entryEndInput.value = today;

            if (elements.moneySelect) elements.moneySelect.value = "";
            if (elements.quickSearch) elements.quickSearch.value = "";

            [elements.managerSelect, elements.areaSelect, elements.timeSelect, elements.sistemaSelect, elements.desafioSelect]
                .filter(Boolean)
                .forEach((sel) => {
                    sel.value = "";
                });

            loadSales();
        });

        const onAnyFilterChange = () => applyAllFiltersAndRender();
        [elements.managerSelect, elements.moneySelect, elements.areaSelect, elements.timeSelect, elements.sistemaSelect, elements.desafioSelect]
            .filter(Boolean)
            .forEach((el) => el.addEventListener("change", onAnyFilterChange));

        let searchTimer = null;
        elements.quickSearch?.addEventListener("input", () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => applyAllFiltersAndRender(), 200);
        });

        const applyPresetDays = (days) => {
            const end = new Date();
            const start = new Date();
            start.setDate(end.getDate() - (days - 1));
            if (elements.entryStartInput) elements.entryStartInput.value = utils.getDateString(start);
            if (elements.entryEndInput) elements.entryEndInput.value = utils.getDateString(end);
            loadSales();
        };

        elements.preset7?.addEventListener("click", () => applyPresetDays(7));
        elements.preset14?.addEventListener("click", () => applyPresetDays(14));
        elements.preset30?.addEventListener("click", () => applyPresetDays(30));

        const applyRelativeDay = (delta) => {
            const startStr = elements.entryStartInput?.value || "";
            const endStr = elements.entryEndInput?.value || "";
            let baseStr = startStr || endStr || utils.today();
            if (startStr && endStr && startStr === endStr) baseStr = startStr;

            const baseDate = utils.parseDateTime(baseStr) || new Date();
            baseDate.setDate(baseDate.getDate() + delta);

            const ds = utils.getDateString(baseDate);
            if (elements.entryStartInput) elements.entryStartInput.value = ds;
            if (elements.entryEndInput) elements.entryEndInput.value = ds;

            loadSales();
        };

        elements.presetPrevDay?.addEventListener("click", () => applyRelativeDay(-1));
        elements.presetNextDay?.addEventListener("click", () => applyRelativeDay(1));

        elements.closeToast?.addEventListener("click", () => ui.hideError());

        loadSales();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
