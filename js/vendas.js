(() => {
    const page = document.documentElement.getAttribute('data-page');
    if (page !== 'vendas') return;

    // ========================================
    // Configuration
    // ========================================
    const CONFIG = {
        // Ajuste caso seu webhook seja outro (ex: /webhook/vendas)
        SALES_ENDPOINT: 'https://n8n.clinicaexperts.com.br/webhook/vendas',
    };

    const NAO_INFORMADO_VALUE = '__nao_informado__';

    // ========================================
    // Chart.js plugin (datalabels)
    // ========================================
    if (window.Chart && window.ChartDataLabels && typeof window.Chart.register === 'function') {
        window.Chart.register(window.ChartDataLabels);
        window.Chart.defaults.plugins = window.Chart.defaults.plugins || {};
        window.Chart.defaults.plugins.datalabels = window.Chart.defaults.plugins.datalabels || {};
        window.Chart.defaults.plugins.datalabels.display = false;
    }

    // ========================================
    // Utilities
    // ========================================
    const utils = {
        getDateString(date) {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
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
                const d = new Date(s.replace(' ', 'T'));
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
            return String(value ?? '')
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#039;');
        },

        normalizeMoney(value) {
            const v = String(value ?? '').trim().toLowerCase();
            if (!v) return 'unknown';
            if (['yes', 'sim', 'true', '1', 'y'].includes(v)) return 'yes';
            if (['no', 'não', 'nao', 'false', '0', 'n'].includes(v)) return 'no';
            return 'unknown';
        },

        moneyLabel(norm) {
            if (norm === 'yes') return 'Sim';
            if (norm === 'no') return 'Não';
            return 'Não informado';
        },
    };

    function getSelectedValues(selectEl) {
        if (!selectEl) return [];
        return Array.from(selectEl.selectedOptions || [])
            .map((o) => o.value)
            .filter((v) => String(v).trim() !== '');
    }

    function uniqueSorted(rows, key) {
        const set = new Set();
        rows.forEach((r) => {
            const v = String(r?.[key] ?? '').trim();
            if (v) set.add(v);
        });
        return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    }

    function setOptions(selectEl, values, { keepSelected = true, includeNotInformed = false } = {}) {
        if (!selectEl) return;

        const isMultiple = selectEl.hasAttribute('multiple');
        const current = keepSelected ? new Set(getSelectedValues(selectEl)) : new Set();

        const optionsHtml = [];
        if (!isMultiple) optionsHtml.push('<option value="">Todos</option>');

        values.forEach((v) => {
            optionsHtml.push(`<option value="${utils.escapeHtml(v)}">${utils.escapeHtml(v)}</option>`);
        });

        if (includeNotInformed) {
            const hasLabel = values.some((v) => String(v ?? '').trim().toLowerCase() === 'não informado');
            if (!hasLabel) optionsHtml.push(`<option value="${NAO_INFORMADO_VALUE}">Não informado</option>`);
        }

        selectEl.innerHTML = optionsHtml.join('');

        if (keepSelected && current.size) {
            Array.from(selectEl.options).forEach((o) => {
                if (current.has(o.value)) o.selected = true;
            });
        }
    }

    function matchesSelectValue(rowValue, selectedValues) {
        if (!selectedValues || !selectedValues.length) return true;

        const v = String(rowValue ?? '').trim();
        const wantsNaoInformado = selectedValues.includes(NAO_INFORMADO_VALUE);

        if (!v) return wantsNaoInformado;
        return selectedValues.includes(v);
    }

    function countBy(rows, key, { normalizeFn } = {}) {
        const acc = {};
        rows.forEach((r) => {
            const raw = r?.[key];
            const k = normalizeFn ? normalizeFn(raw) : (String(raw ?? '').trim() || 'Não informado');
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
            const k = String(kRaw ?? '').trim() || 'Não informado';
            const v = Number(vRaw) || 0;
            if (v <= 0) return;

            const pct = v / total;
            const isNaoInformado = k.toLowerCase() === 'não informado' || k.toLowerCase() === 'nao informado';

            if (labels.length < topN && (pct >= minPct || isNaoInformado)) {
                labels.push(k);
                data.push(v);
            } else {
                otherSum += v;
            }
        });

        if (otherSum > 0) {
            labels.push('Outros');
            data.push(otherSum);
        }

        return { labels, data };
    }

    // ========================================
    // Pie colors + options
    // ========================================
    const COLOR_NAO_INFORMADO = '#000000';
    const COLOR_OUTROS = '#ffffff';
    const COLOR_OUTROS_BORDER = '#cbd5e1';

    const PIE_PALETTE = [
        'rgb(54, 162, 235)',
        'rgb(255, 99, 132)',
        'rgb(255, 159, 64)',
        'rgb(255, 205, 86)',
        'rgb(75, 192, 192)',
        'rgb(153, 102, 255)',
        'rgb(201, 203, 207)',
        'rgb(22, 163, 74)',
        'rgb(14, 116, 144)',
        'rgb(234, 88, 12)',
        'rgb(190, 18, 60)',
        'rgb(37, 99, 235)',
    ];

    function normalizeLabelKey(label) {
        return String(label ?? '').trim().toLowerCase();
    }
    function isNaoInformadoLabel(label) {
        const k = normalizeLabelKey(label);
        return k === 'não informado' || k === 'nao informado' || String(label) === NAO_INFORMADO_VALUE;
    }
    function isOutrosLabel(label) {
        return normalizeLabelKey(label) === 'outros';
    }
    function pieColorForLabel(label, index) {
        if (isNaoInformadoLabel(label)) return COLOR_NAO_INFORMADO;
        if (isOutrosLabel(label)) return COLOR_OUTROS;
        return PIE_PALETTE[index % PIE_PALETTE.length];
    }
    function pieBorderForLabel(label) {
        if (isOutrosLabel(label)) return COLOR_OUTROS_BORDER;
        return '#ffffff';
    }

    const PIE_OPTIONS = {
        responsive: true,
        aspectRatio: 1.35,
        plugins: {
            legend: {
                position: 'bottom',
                labels: { boxWidth: 9, font: { size: 12 } },
            },
            datalabels: {
                display: true,
                anchor: 'end',
                align: 'end',
                offset: 8,
                clamp: false,
                clip: false,
                font: { size: 11, weight: '700' },
                color: 'rgba(15, 23, 42, 0.9)',
                formatter: (value, ctx) => {
                    const v = Number(value) || 0;
                    if (v <= 0) return '';
                    const data = ctx?.chart?.data?.datasets?.[ctx.datasetIndex]?.data || [];
                    const total = data.reduce((sum, x) => sum + (Number(x) || 0), 0);
                    if (!total) return '';
                    const pct = (v / total) * 100;
                    if (pct > 0 && pct < 1) return '<1%';
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
            radius: '88%',
            hoverOffset: 4,
            backgroundColor: safeLabels.map((l, i) => pieColorForLabel(l, i)),
            borderColor: safeLabels.map((l) => pieBorderForLabel(l)),
            borderWidth: 2,
        };
    }

    // ========================================
    // DOM Elements
    // ========================================
    const dom = { byId: (id) => document.getElementById(id) };

    const elements = {
        entryStartInput: dom.byId('entryStartDate'),
        entryEndInput: dom.byId('entryEndDate'),

        managerSelect: dom.byId('managerSelect'),
        moneySelect: dom.byId('moneySelect'),
        areaSelect: dom.byId('areaSelect'),
        timeSelect: dom.byId('timeSelect'),
        sistemaSelect: dom.byId('sistemaSelect'),
        desafioSelect: dom.byId('desafioSelect'),

        quickSearch: dom.byId('globalSearch'),

        presetPrevDay: dom.byId('presetPrevDay'),
        presetNextDay: dom.byId('presetNextDay'),
        clearVendor: dom.byId('clearVendor'),

        preset7: dom.byId('preset7'),
        preset14: dom.byId('preset14'),
        preset30: dom.byId('preset30'),

        applyFilters: dom.byId('applyFilters'),
        clearEntryDates: dom.byId('clearEntryDates'),
        clearAllFilters: dom.byId('clearAllFilters'),

        totalCount: dom.byId('totalCount'),

        loadingOverlay: dom.byId('loadingOverlay'),
        errorToast: dom.byId('errorToast'),
        errorMessage: dom.byId('errorMessage'),
        closeToast: dom.byId('closeToast'),
    };

    // ========================================
    // State
    // ========================================
    const state = {
        salesData: [],
        filtered: [],
        charts: {},
    };

    // ========================================
    // UI Helpers
    // ========================================
    const ui = {
        showLoading() {
            elements.loadingOverlay?.classList.add('active');
        },
        hideLoading() {
            elements.loadingOverlay?.classList.remove('active');
        },
        showError(message) {
            if (!elements.errorToast) return;
            elements.errorMessage.textContent = message;
            elements.errorToast.classList.add('active');
            setTimeout(() => this.hideError(), 4500);
        },
        hideError() {
            elements.errorToast?.classList.remove('active');
        },
    };

    // ========================================
    // Chart handling
    // ========================================
    function ensureChart(id, config) {
        const canvas = document.getElementById(id);
        if (!canvas || !window.Chart) return null;

        if (state.charts[id]) {
            const chart = state.charts[id];

            const isPieLike = ['pie', 'doughnut', 'polarArea'].includes(chart.config?.type);
            const prevLabels = Array.isArray(chart.data?.labels) ? chart.data.labels : [];
            const hiddenLabelKeys = new Set();

            if (isPieLike && typeof chart.getDataVisibility === 'function') {
                prevLabels.forEach((lbl, i) => {
                    if (!chart.getDataVisibility(i)) hiddenLabelKeys.add(normalizeLabelKey(lbl));
                });
            }

            chart.config.data = config.data;
            chart.config.options = config.options;

            if (isPieLike && hiddenLabelKeys.size && Array.isArray(config?.data?.labels)) {
                chart._hiddenIndices = {};
                config.data.labels.forEach((lbl, i) => {
                    if (hiddenLabelKeys.has(normalizeLabelKey(lbl))) {
                        if (typeof chart.getDataVisibility === 'function' && chart.getDataVisibility(i)) {
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

        // Área
        const areaPie = buildPieFromCounts(countBy(rows, 'area'), 7);
        ensureChart('chartArea', {
            type: 'pie',
            data: { labels: areaPie.labels, datasets: [pieDataset(areaPie.data, areaPie.labels)] },
            options: PIE_OPTIONS,
        });

        // Sistema
        const sysPie = buildPieFromCounts(countBy(rows, 'system'), 8);
        ensureChart('chartSistema', {
            type: 'pie',
            data: { labels: sysPie.labels, datasets: [pieDataset(sysPie.data, sysPie.labels)] },
            options: PIE_OPTIONS,
        });

        // Time
        const timePie = buildPieFromCounts(countBy(rows, 'team'), 8);
        ensureChart('chartTime', {
            type: 'pie',
            data: { labels: timePie.labels, datasets: [pieDataset(timePie.data, timePie.labels)] },
            options: PIE_OPTIONS,
        });

        // Desafio
        const desPie = buildPieFromCounts(countBy(rows, 'challenge'), 8);
        ensureChart('chartDesafio', {
            type: 'pie',
            data: { labels: desPie.labels, datasets: [pieDataset(desPie.data, desPie.labels)] },
            options: PIE_OPTIONS_NO_LEGEND,
        });

        // Money
        const moneyCounts = countBy(rows, 'money', { normalizeFn: utils.normalizeMoney });
        const moneyLabels = ['Sim', 'Não', 'Não informado'];
        ensureChart('chartMoney', {
            type: 'pie',
            data: {
                labels: moneyLabels,
                datasets: [pieDataset([moneyCounts.yes || 0, moneyCounts.no || 0, moneyCounts.unknown || 0], moneyLabels)],
            },
            options: PIE_OPTIONS,
        });

        // Vendedor (manager)
        const managerPie = buildPieFromCounts(countBy(rows, 'manager'), 10);
        ensureChart('chartManager', {
            type: 'pie',
            data: { labels: managerPie.labels, datasets: [pieDataset(managerPie.data, managerPie.labels)] },
            options: PIE_OPTIONS,
        });

        // Plano (plan_id)
        const planPie = buildPieFromCounts(countBy(rows, 'plan_id'), 10);
        ensureChart('chartPlan', {
            type: 'pie',
            data: { labels: planPie.labels, datasets: [pieDataset(planPie.data, planPie.labels)] },
            options: PIE_OPTIONS,
        });

        // Pagamento (payment_method)
        const payPie = buildPieFromCounts(countBy(rows, 'payment_method'), 10);
        ensureChart('chartPayment', {
            type: 'pie',
            data: { labels: payPie.labels, datasets: [pieDataset(payPie.data, payPie.labels)] },
            options: PIE_OPTIONS,
        });
    }

    // ========================================
    // Transform (payload -> row)
    // ========================================
    function getField(obj, keys) {
        for (const k of keys) {
            if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
        }
        return null;
    }

    function normalizeSaleRow(s) {
        return {
            created_at: getField(s, ['created_at', 'createdAt', 'date']) ? String(getField(s, ['created_at', 'createdAt', 'date'])) : null,
            manager: getField(s, ['manager', 'seller', 'vendedor']) ?? null,
            plan_id: getField(s, ['plan_id', 'plan', 'plano']) ?? null,
            payment_method: getField(s, ['payment_method', 'payment', 'metodo_pagamento']) ?? null,

            team: getField(s, ['team', 'time']) ?? null,
            money: utils.normalizeMoney(getField(s, ['money'])),
            challenge: getField(s, ['challenge', 'desafio']) ?? null,
            system: getField(s, ['system', 'sistema']) ?? null,
            area: getField(s, ['area']) ?? null,
        };
    }

    // ========================================
    // Filtering
    // ========================================
    function refreshFilterOptions(rows) {
        setOptions(elements.managerSelect, uniqueSorted(rows, 'manager'), { keepSelected: true, includeNotInformed: true });
        setOptions(elements.areaSelect, uniqueSorted(rows, 'area'), { keepSelected: true, includeNotInformed: true });
        setOptions(elements.timeSelect, uniqueSorted(rows, 'team'), { keepSelected: true, includeNotInformed: true });
        setOptions(elements.sistemaSelect, uniqueSorted(rows, 'system'), { keepSelected: true, includeNotInformed: true });
        setOptions(elements.desafioSelect, uniqueSorted(rows, 'challenge'), { keepSelected: true, includeNotInformed: true });
    }

    function applyAllFiltersAndRender() {
        const moneyMode = (elements.moneySelect?.value || '').trim(); // '', yes, no, unknown
        const managers = getSelectedValues(elements.managerSelect);
        const areas = getSelectedValues(elements.areaSelect);
        const times = getSelectedValues(elements.timeSelect);
        const sistemas = getSelectedValues(elements.sistemaSelect);
        const desafios = getSelectedValues(elements.desafioSelect);
        const q = String(elements.quickSearch?.value ?? '').trim().toLowerCase();

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
                ]
                    .map((v) => String(v ?? '').toLowerCase())
                    .join(' | ');

                return hay.includes(q);
            });
        }

        state.filtered = out;
        if (elements.totalCount) elements.totalCount.textContent = String(out.length);
        updateCharts();
    }

    // ========================================
    // Data Loading
    // ========================================
    async function loadSales() {
        const params = {
            entry_start: elements.entryStartInput?.value || '',
            entry_end: elements.entryEndInput?.value || '',
            _ts: Date.now(),
        };

        ui.showLoading();
        try {
            const url = `${CONFIG.SALES_ENDPOINT}?${new URLSearchParams(params)}`;
            const response = await fetch(url, { cache: 'no-store' });
            const rawText = await response.text();

            if (!response.ok) {
                const snippet = rawText ? rawText.slice(0, 220) : '';
                throw new Error(`HTTP ${response.status}${snippet ? ` — ${snippet}` : ''}`);
            }

            const text = (rawText || '').trim();
            const data = text ? JSON.parse(text) : [];

            const root = Array.isArray(data) ? data[0] : data;
            const sales = Array.isArray(root?.sales) ? root.sales : (Array.isArray(root) ? root : []);

            state.salesData = sales.map(normalizeSaleRow);
            refreshFilterOptions(state.salesData);

            applyAllFiltersAndRender();
        } catch (e) {
            ui.showError(`Erro: ${e.message}`);
            state.salesData = [];
            state.filtered = [];
            if (elements.totalCount) elements.totalCount.textContent = '0';
            updateCharts();
        } finally {
            ui.hideLoading();
        }
    }

    // ========================================
    // Initialization
    // ========================================
    function init() {
        const today = utils.today();
        if (elements.entryStartInput) elements.entryStartInput.value = today;
        if (elements.entryEndInput) elements.entryEndInput.value = today;

        if (elements.applyFilters) elements.applyFilters.addEventListener('click', loadSales);

        if (elements.clearVendor) {
            elements.clearVendor.addEventListener('click', () => {
                if (elements.managerSelect) elements.managerSelect.value = '';
                applyAllFiltersAndRender();
            });
        }

        if (elements.clearAllFilters) {
            elements.clearAllFilters.addEventListener('click', () => {
                const today = utils.today();

                if (elements.entryStartInput) elements.entryStartInput.value = today;
                if (elements.entryEndInput) elements.entryEndInput.value = today;

                if (elements.moneySelect) elements.moneySelect.value = '';
                if (elements.quickSearch) elements.quickSearch.value = '';

                [elements.managerSelect, elements.areaSelect, elements.timeSelect, elements.sistemaSelect, elements.desafioSelect]
                    .filter(Boolean)
                    .forEach((sel) => { sel.value = ''; });

                loadSales();
            });
        }


        if (elements.clearAllFilters) {
            elements.clearAllFilters.addEventListener('click', () => {
                if (elements.moneySelect) elements.moneySelect.value = '';
                if (elements.quickSearch) elements.quickSearch.value = '';

                [elements.managerSelect, elements.areaSelect, elements.timeSelect, elements.sistemaSelect, elements.desafioSelect]
                    .filter(Boolean)
                    .forEach((sel) => { sel.value = ''; });

                applyAllFiltersAndRender();
            });
        }

        const onAnyFilterChange = () => applyAllFiltersAndRender();
        [elements.managerSelect, elements.moneySelect, elements.areaSelect, elements.timeSelect, elements.sistemaSelect, elements.desafioSelect]
            .filter(Boolean)
            .forEach((el) => el.addEventListener('change', onAnyFilterChange));

        let searchTimer = null;
        if (elements.quickSearch) {
            elements.quickSearch.addEventListener('input', () => {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(() => applyAllFiltersAndRender(), 200);
            });
        }

        const applyPresetDays = (days) => {
            const end = new Date();
            const start = new Date();
            start.setDate(end.getDate() - (days - 1));
            if (elements.entryStartInput) elements.entryStartInput.value = utils.getDateString(start);
            if (elements.entryEndInput) elements.entryEndInput.value = utils.getDateString(end);
            loadSales();
        };
        if (elements.preset7) elements.preset7.addEventListener('click', () => applyPresetDays(7));
        if (elements.preset14) elements.preset14.addEventListener('click', () => applyPresetDays(14));
        if (elements.preset30) elements.preset30.addEventListener('click', () => applyPresetDays(30));

        const applyRelativeDay = (delta) => {
            const startStr = elements.entryStartInput?.value || '';
            const endStr = elements.entryEndInput?.value || '';
            let baseStr = startStr || endStr || utils.today();
            if (startStr && endStr && startStr === endStr) baseStr = startStr;

            const baseDate = utils.parseDateTime(baseStr) || new Date();
            baseDate.setDate(baseDate.getDate() + delta);

            const ds = utils.getDateString(baseDate);
            if (elements.entryStartInput) elements.entryStartInput.value = ds;
            if (elements.entryEndInput) elements.entryEndInput.value = ds;

            loadSales();
        };

        if (elements.presetPrevDay) elements.presetPrevDay.addEventListener('click', () => applyRelativeDay(-1));
        if (elements.presetNextDay) elements.presetNextDay.addEventListener('click', () => applyRelativeDay(1));


        if (elements.closeToast) elements.closeToast.addEventListener('click', () => ui.hideError());

        loadSales();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
