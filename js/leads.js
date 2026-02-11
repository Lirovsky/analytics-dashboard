(() => {
    const page = document.documentElement.getAttribute('data-page');
    if (page !== 'leads') return;

    const CONFIG = {
        LEADS_ENDPOINT: 'https://n8n.clinicaexperts.com.br/webhook/leads',
        CHAT_URL_PREFIX: 'https://app-utalk.umbler.com/chats/',
        MANAGER_MAP: {
        },
    };

    const NAO_INFORMADO_VALUE = '__nao_informado__';

    const ICP_AREAS = new Set([
        'dentistry',
        'aesthetic',
        'physiotherapy',
        'medicine',
        'biomedicine',
    ]);


    if (window.Chart && window.ChartDataLabels && typeof window.Chart.register === 'function') {
        window.Chart.register(window.ChartDataLabels);
        window.Chart.defaults.plugins = window.Chart.defaults.plugins || {};
        window.Chart.defaults.plugins.datalabels = window.Chart.defaults.plugins.datalabels || {};
        window.Chart.defaults.plugins.datalabels.display = false;
    }

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

        toBRDate(isoLike) {
            if (!isoLike) return '–';
            const s = String(isoLike).slice(0, 10); // YYYY-MM-DD
            const [y, m, d] = s.split('-');
            if (!y || !m || !d) return '–';
            return `${d}/${m}/${y}`;
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

            if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) {
                const [y, m, d] = s.split('/');
                const dt = new Date(`${y}-${m}-${d}T00:00:00`);
                return isNaN(dt) ? null : dt;
            }

            const d = new Date(s);
            return isNaN(d) ? null : d;
        },

        toBRDateTime(value) {
            const d = this.parseDateTime(value);
            if (!d) return '–';

            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const yyyy = d.getFullYear();
            const hh = String(d.getHours()).padStart(2, '0');
            const min = String(d.getMinutes()).padStart(2, '0');

            return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
        },

        safeText(v) {
            if (v === null || v === undefined || v === '') return '–';
            return String(v);
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
        stageClass(stage) {
            const s = String(stage || '').toLowerCase();
            if (s.includes('lead')) return 'badge--stage-lead';
            if (s.includes('apresent')) return 'badge--stage-apresentacao';
            if (s.includes('intera')) return 'badge--stage-interacao';
            return 'badge--stage-outro';
        },

        removeDiacritics(value) {
            return String(value ?? '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '');
        },
        originFromTag(tag) {
            const raw = String(tag ?? '').trim();
            if (!raw) return 'Orgânico';

            const low = raw.toLowerCase();
            const noAccents = this.removeDiacritics(low);

            if (low.startsWith('trial')) return 'Trial';
            if (low.endsWith('_facebook') || low.endsWith('_google')) return 'LP';
            if (noAccents.includes('organico')) return 'Orgânico';
            return 'Orgânico';
        },
    };

    function getSelectedValues(selectEl) {
        if (!selectEl) return [];
        return Array.from(selectEl.selectedOptions || [])
            .map((o) => o.value)
            .filter((v) => String(v).trim() !== '');
    }

    function getCheckedValues(containerEl) {
        if (!containerEl) return [];
        return Array.from(containerEl.querySelectorAll('input[type="checkbox"]:checked'))
            .map((i) => i.value)
            .filter((v) => String(v).trim() !== '');
    }

    // ====== UI: Área multi-select (dropdown com checkboxes) ======
    function setAreaMenuOpen(open) {
        if (!elements?.areaMulti || !elements?.areaTrigger) return;
        elements.areaMulti.classList.toggle('is-open', !!open);
        elements.areaTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function updateAreaTriggerText() {
        if (!elements?.areaTriggerText) return;

        const selected = getCheckedValues(elements.areaCheckboxes);

        if (!selected.length) {
            elements.areaTriggerText.textContent = 'Todos';
            return;
        }

        if (selected.length === 1) {
            const v = selected[0];
            elements.areaTriggerText.textContent = v === NAO_INFORMADO_VALUE ? 'Não informado' : v;
            return;
        }

        elements.areaTriggerText.textContent = `${selected.length} selecionadas`;
    }

    function setAllAreaCheckboxes(checked) {
        if (!elements?.areaCheckboxes) return;
        elements.areaCheckboxes
            .querySelectorAll('input[type="checkbox"]')
            .forEach((i) => (i.checked = !!checked));
        updateAreaTriggerText();
    }

    function setCheckboxOptions(containerEl, values, { keepSelected = true, includeNotInformed = false } = {}) {
        if (!containerEl) return;

        const current = keepSelected ? new Set(getCheckedValues(containerEl)) : new Set();

        const safeValues = Array.isArray(values) ? values : [];
        const finalValues = [...safeValues];

        if (includeNotInformed && !finalValues.includes(NAO_INFORMADO_VALUE)) {
            finalValues.push(NAO_INFORMADO_VALUE);
        }

        containerEl.innerHTML = finalValues
            .map((v) => {
                const label = v === NAO_INFORMADO_VALUE ? 'Não informado' : v;
                const checked = current.has(v) ? 'checked' : '';
                return `
        <label class="multi-select__item">
          <input type="checkbox" value="${utils.escapeHtml(v)}" ${checked} />
          <span>${utils.escapeHtml(label)}</span>
        </label>
      `;
            })
            .join('');

        updateAreaTriggerText();
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

    const COLOR_NAO_INFORMADO = '#000000';
    const COLOR_OUTROS = '#ffffff';
    const COLOR_OUTROS_BORDER = '#cbd5e1';

    const PIE_PALETTE = [
        'rgb(54, 162, 235)',   // azul
        'rgb(255, 99, 132)',   // rosa/vermelho
        'rgb(255, 159, 64)',   // laranja
        'rgb(255, 205, 86)',   // amarelo
        'rgb(75, 192, 192)',   // teal
        'rgb(153, 102, 255)',  // roxo
        'rgb(201, 203, 207)',  // cinza
        'rgb(22, 163, 74)',    // verde
        'rgb(14, 116, 144)',   // ciano escuro
        'rgb(234, 88, 12)',    // laranja escuro
        'rgb(190, 18, 60)',    // vermelho escuro
        'rgb(37, 99, 235)',    // azul forte
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

    const dom = { byId: (id) => document.getElementById(id) };

    const elements = {
        entryStartInput: dom.byId('entryStartDate'),
        entryEndInput: dom.byId('entryEndDate'),
        applyFilters: dom.byId('applyFilters'),
        clearAllFilters: dom.byId('clearAllFilters'),
        moneySelect: dom.byId('moneySelect'),

        // Área (multi-select)
        areaMulti: dom.byId('areaMulti'),
        areaTrigger: dom.byId('areaTrigger'),
        areaTriggerText: dom.byId('areaTriggerText'),
        areaMenu: dom.byId('areaMenu'),
        areaSelectAll: dom.byId('areaSelectAll'),
        areaClear: dom.byId('areaClear'),
        areaCheckboxes: dom.byId('areaCheckboxes'),

        sellerSelect: dom.byId('sellerSelect'),

        timeSelect: dom.byId('timeSelect'),
        sistemaSelect: dom.byId('sistemaSelect'),
        desafioSelect: dom.byId('desafioSelect'),
        tagSelect: dom.byId('tagSelect'),
        stageSelect: dom.byId('stageSelect'),


        preset7: dom.byId('preset7'),
        preset14: dom.byId('preset14'),
        preset30: dom.byId('preset30'),
        presetPrevDay: dom.byId('presetPrevDay'),
        presetNextDay: dom.byId('presetNextDay'),

        leadsBody: dom.byId('leadsBody'),
        totalCount: dom.byId('totalCount'),
        leadsPageInfo: dom.byId('leadsPageInfo'),

        loadingOverlay: dom.byId('loadingOverlay'),
        errorToast: dom.byId('errorToast'),
        errorMessage: dom.byId('errorMessage'),
        closeToast: dom.byId('closeToast'),

        // KPIs
        kpiTotal: dom.byId('kpiTotal'),
        kpiShown: dom.byId('kpiShown'),
        kpiMoneyPct: dom.byId('kpiMoneyPct'),
        kpiIcpPct: dom.byId('kpiIcpPct'),
        kpiIcpOrganicPct: dom.byId('kpiIcpOrganicPct'),
        kpiMoneyOrganicPct: dom.byId('kpiMoneyOrganicPct'),
        kpiOrganicTotal: dom.byId('kpiOrganicTotal'),
    };

    // depois do objeto elements:
    elements.exportPhonesCsv = dom.byId('exportPhonesCsv');

    function csvEscape(v) {
        const s = String(v ?? '');
        if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
        return s;
    }

    function downloadCsv(filename, rows) {
        const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();

        URL.revokeObjectURL(url);
    }

    function exportPhonesFromFiltered() {
        const phones = (state.filtered || [])
            .map(r => String(r?.phone ?? '').trim())
            .filter(Boolean);

        // opcional: remover duplicados
        const unique = Array.from(new Set(phones));

        // 1 coluna (phone) ou inclua outras colunas se quiser (tag, origem, etc.)
        const rows = [
            ['phone'],
            ...unique.map(p => [p]),
        ];

        const stamp = utils.today();
        downloadCsv(`telefones-filtrados-${stamp}.csv`, rows);
    }

    if (elements.exportPhonesCsv) {
        elements.exportPhonesCsv.addEventListener('click', exportPhonesFromFiltered);
    }

    const state = {
        sort: { key: 'entry_date', direction: 'desc' },
        leadsData: [],
        filtered: [],
        pagination: { page: 1, pageSize: 20 },
        charts: {},
    };

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
        renderEmptyState(message = 'Sem dados', colspan = 12) {
            return `<tr><td colspan="${colspan}" style="padding:24px;color:#94a3b8;text-align:center;">${message}</td></tr>`;
        },
    };

    function getField(obj, keys) {
        for (const k of keys) {
            if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
        }
        return null;
    }

    function normalizeLeadRow(l) {
        // 1) tenta pegar nome direto (porque seu backend já está mandando "manager": "Zedles")
        const managerNameRaw = getField(l, ['manager', 'manager_name', 'managerName']);
        const managerName = String(managerNameRaw ?? '').trim();

        // 2) fallback: tenta pegar manager_id (pode ser número OU string)
        const rawManagerId = getField(l, ['manager_id', 'managerId', 'MANAGER_ID']);

        let manager = '–';

        if (managerName) {
            manager = managerName;
        } else {
            const maybeNum = Number(rawManagerId);
            if (!Number.isNaN(maybeNum) && maybeNum > 0) {
                manager = CONFIG.MANAGER_MAP[maybeNum] || String(maybeNum);
            } else {
                const maybeName = String(rawManagerId ?? '').trim();
                manager = maybeName || '–';
            }
        }

        const externalId = getField(l, ['external_id', 'externalId', 'chat_id', 'chatId']);
        const chatUrl = externalId ? `${CONFIG.CHAT_URL_PREFIX}${String(externalId)}` : null;

        const entryIso = getField(l, ['created_at', 'createdAt', 'entry_date', 'entryDate', 'ENTRADA']);
        const purchaseIso = getField(l, ['purchased_at', 'purchasedAt', 'purchase_date', 'purchaseDate']);

        const tag = getField(l, ['tag', 'TAG']) ?? null;
        const origem = utils.originFromTag(tag);

        const team = getField(l, ['team', 'time', 'TIME', 'Time']) ?? null;
        const area = getField(l, ['area', 'AREA', 'Área', 'Area']) ?? null;

        const moneyNorm = utils.normalizeMoney(getField(l, ['money', 'MONEY', 'tem_money', 'temMoney']));
        const system = getField(l, ['system', 'SISTEMA', 'Sistema', 'SYSTEM']) ?? null;
        const challenge = getField(l, ['challenge', 'DESAFIO', 'Desafio', 'CHALLENGE']) ?? null;

        return {
            entry_date: entryIso ? String(entryIso) : null,
            purchase_date: purchaseIso ? String(purchaseIso).slice(0, 10) : null,
            tag,
            origem,
            phone: getField(l, ['phone', 'PHONE', 'contato', 'Contato']) ?? null,
            manager,
            chat_url: chatUrl,
            stage: getField(l, ['stage', 'STAGE', 'etapa', 'Etapa']) ?? null,
            team,
            area,
            money: moneyNorm,
            system,
            challenge,
        };
    }

    function sortRows(items) {
        const { key, direction } = state.sort;
        const dir = direction === 'asc' ? 1 : -1;

        const parseDate = (v) => {
            const d = utils.parseDateTime(v);
            return d ? d.getTime() : 0;
        };

        return [...items].sort((a, b) => {
            const aVal = a[key];
            const bVal = b[key];

            if (key === 'entry_date' || key === 'purchase_date') {
                return (parseDate(aVal) - parseDate(bVal)) * dir;
            }

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
        document.querySelectorAll(`.pagination[data-channel="leads"] .pg-btn`).forEach((btn) => {
            const action = btn.getAttribute('data-action');
            btn.disabled = (action === 'prev' && meta.page <= 1) || (action === 'next' && meta.page >= meta.totalPages);
        });
    }

    function renderTable() {
        const sorted = sortRows(state.filtered);

        if (elements.totalCount) elements.totalCount.textContent = String(sorted.length);

        const meta = paginate(sorted, state.pagination.page, state.pagination.pageSize);
        state.pagination.page = meta.page;

        if (!elements.leadsBody) return;

        if (!meta.slice.length) {
            elements.leadsBody.innerHTML = ui.renderEmptyState('Sem dados para o filtro atual.', 12);
            updatePaginationUI({ page: 1, totalPages: 1 });
            return;
        }

        elements.leadsBody.innerHTML = meta.slice
            .map((r) => {
                const stageText = utils.safeText(r.stage);
                const moneyClass = r.money === 'yes' ? 'badge--money-yes' : (r.money === 'no' ? 'badge--money-no' : 'badge--neutral');

                return `
          <tr>
            <td>${utils.toBRDateTime(r.entry_date)}</td>

            <td>${utils.toBRDate(r.purchase_date)}</td>
            <td>${utils.safeText(r.tag)}</td>
            <td>${utils.safeText(r.phone)}</td>
            <td>${utils.safeText(r.manager)}</td>
            <td>${r.chat_url ? `<a class="table-link" href="${r.chat_url}" target="_blank" rel="noopener noreferrer">Abrir</a>` : '–'}</td>
            <td><span class="badge ${utils.stageClass(stageText)}">${stageText}</span></td>
            <td>${utils.safeText(r.team)}</td>
            <td>${utils.safeText(r.area)}</td>
            <td><span class="badge ${moneyClass}">${utils.moneyLabel(r.money)}</span></td>
            <td>${utils.safeText(r.system)}</td>
            <td>${utils.safeText(r.challenge)}</td>
          </tr>
        `;
            })
            .join('');

        updatePaginationUI(meta);
    }

    function isOrganic(row) {
        const o = utils.removeDiacritics(String(row?.origem ?? '').trim().toLowerCase());
        return o === 'organico';
    }

    function isIcp(row) {
        const area = String(row?.area ?? '').trim().toLowerCase();
        return row?.money === 'yes' && ICP_AREAS.has(area);
    }

    function pct(part, total) {
        if (!total) return null;
        return Math.round((part / total) * 100);
    }

    function setKpi(el, value, title) {
        if (!el) return;
        el.textContent = value == null ? '—' : String(value);
        if (title != null) el.title = String(title);
    }

    function updateKpis(rows) {
        const shown = Array.isArray(rows) ? rows : [];
        const totalAll = Array.isArray(state.leadsData) ? state.leadsData.length : 0;
        const totalShown = shown.length;

        const moneyYes = shown.reduce((acc, r) => acc + (r?.money === 'yes' ? 1 : 0), 0);
        const moneyPct = pct(moneyYes, totalShown);

        const icpCount = shown.reduce((acc, r) => acc + (isIcp(r) ? 1 : 0), 0);
        const icpPct = pct(icpCount, totalShown);

        const organic = shown.filter(isOrganic);
        const totalOrganic = organic.length;
        const moneyOrganicYes = organic.reduce((acc, r) => acc + (r?.money === 'yes' ? 1 : 0), 0);
        const moneyOrganicPct = pct(moneyOrganicYes, totalOrganic);

        const icpOrganicCount = organic.reduce((acc, r) => acc + (isIcp(r) ? 1 : 0), 0);
        const icpOrganicPct = pct(icpOrganicCount, totalOrganic);

        setKpi(elements.kpiTotal, totalAll);
        setKpi(elements.kpiShown, totalShown);
        setKpi(elements.kpiOrganicTotal, totalOrganic);

        setKpi(elements.kpiMoneyPct, moneyPct == null ? null : `${moneyPct}%`, moneyPct == null ? null : `${moneyYes}/${totalShown}`);
        setKpi(
            elements.kpiMoneyOrganicPct,
            moneyOrganicPct == null ? null : `${moneyOrganicPct}%`,
            moneyOrganicPct == null ? null : `${moneyOrganicYes}/${totalOrganic}`
        );

        setKpi(elements.kpiIcpPct, icpPct == null ? null : `${icpPct}%`, icpPct == null ? null : `${icpCount}/${totalShown}`);
        setKpi(elements.kpiIcpOrganicPct, icpOrganicPct == null ? null : `${icpOrganicPct}%`, icpOrganicPct == null ? null : `${icpOrganicCount}/${totalOrganic}`);
    }

    function updateCharts() {
        const rows = state.filtered || [];

        const origemLabels = ['Trial', 'LP', 'Orgânico'];
        const origemCounts = { Trial: 0, LP: 0, 'Orgânico': 0 };

        rows.forEach((r) => {
            const o = String(r?.origem ?? 'Orgânico').trim() || 'Orgânico';
            if (o === 'Trial') origemCounts.Trial += 1;
            else if (o === 'LP') origemCounts.LP += 1;
            else origemCounts['Orgânico'] += 1;
        });

        ensureChart('chartOrigem', {
            type: 'pie',
            data: {
                labels: origemLabels,
                datasets: [pieDataset([origemCounts.Trial, origemCounts.LP, origemCounts['Orgânico']], origemLabels)],
            },
            options: PIE_OPTIONS,
        });

        const areaPie = buildPieFromCounts(countBy(rows, 'area'), 7);
        ensureChart('chartArea', {
            type: 'pie',
            data: { labels: areaPie.labels, datasets: [pieDataset(areaPie.data, areaPie.labels)] },
            options: PIE_OPTIONS,
        });

        const sysPie = buildPieFromCounts(countBy(rows, 'system'), 8);
        ensureChart('chartSistema', {
            type: 'pie',
            data: { labels: sysPie.labels, datasets: [pieDataset(sysPie.data, sysPie.labels)] },
            options: PIE_OPTIONS,
        });

        const timePie = buildPieFromCounts(countBy(rows, 'team'), 8);
        ensureChart('chartTime', {
            type: 'pie',
            data: { labels: timePie.labels, datasets: [pieDataset(timePie.data, timePie.labels)] },
            options: PIE_OPTIONS,
        });

        const desPie = buildPieFromCounts(countBy(rows, 'challenge'), 8);
        ensureChart('chartDesafio', {
            type: 'pie',
            data: { labels: desPie.labels, datasets: [pieDataset(desPie.data, desPie.labels)] },
            options: PIE_OPTIONS_NO_LEGEND,
        });

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
    }

    function applyAllFiltersAndRender({ resetPage = false } = {}) {
        if (resetPage) state.pagination.page = 1;

        const moneyMode = (elements.moneySelect?.value || '').trim();
        const areas = getCheckedValues(elements.areaCheckboxes);
        const sellers = getSelectedValues(elements.sellerSelect);

        const times = getSelectedValues(elements.timeSelect);
        const sistemas = getSelectedValues(elements.sistemaSelect);
        const desafios = getSelectedValues(elements.desafioSelect);
        const tags = getSelectedValues(elements.tagSelect);
        const stages = getSelectedValues(elements.stageSelect);


        let out = [...state.leadsData];

        if (moneyMode) out = out.filter((r) => utils.normalizeMoney(r.money) === moneyMode);

        if (areas.length) out = out.filter((r) => matchesSelectValue(r.area, areas));
        if (sellers.length) out = out.filter((r) => matchesSelectValue(r.manager, sellers));

        if (times.length) out = out.filter((r) => matchesSelectValue(r.team, times));
        if (sistemas.length) out = out.filter((r) => matchesSelectValue(r.system, sistemas));
        if (desafios.length) out = out.filter((r) => matchesSelectValue(r.challenge, desafios));
        if (tags.length) out = out.filter((r) => matchesSelectValue(r.tag, tags));
        if (stages.length) out = out.filter((r) => matchesSelectValue(r.stage, stages));


        state.filtered = out;
        updateKpis(state.filtered);
        renderTable();
        updateCharts();
    }

    function refreshFilterOptions(rows) {
        setCheckboxOptions(elements.areaCheckboxes, uniqueSorted(rows, 'area'), { keepSelected: true, includeNotInformed: true });

        setOptions(elements.sellerSelect, uniqueSorted(rows, 'manager'), { keepSelected: true, includeNotInformed: true });

        setOptions(elements.timeSelect, uniqueSorted(rows, 'team'), { keepSelected: true, includeNotInformed: true });
        setOptions(elements.sistemaSelect, uniqueSorted(rows, 'system'), { keepSelected: true, includeNotInformed: true });
        setOptions(elements.desafioSelect, uniqueSorted(rows, 'challenge'), { keepSelected: true, includeNotInformed: true });
        setOptions(elements.tagSelect, uniqueSorted(rows, 'tag'), { keepSelected: true, includeNotInformed: true });

        setOptions(elements.stageSelect, uniqueSorted(rows, 'stage'), { keepSelected: true, includeNotInformed: true });


        updateAreaTriggerText();
    }

    async function loadLeads() {
        const params = {
            entry_start: elements.entryStartInput?.value || '',
            entry_end: elements.entryEndInput?.value || '',
            _ts: Date.now(),
        };

        ui.showLoading();
        try {
            const url = `${CONFIG.LEADS_ENDPOINT}?${new URLSearchParams(params)}`;
            const response = await fetch(url, { cache: 'no-store' });
            const rawText = await response.text();
            if (!response.ok) {
                const snippet = rawText ? rawText.slice(0, 220) : '';
                throw new Error(`HTTP ${response.status}${snippet ? ` — ${snippet}` : ''}`);
            }
            const text = (rawText || '').trim();
            const data = text ? JSON.parse(text) : [];

            const root = Array.isArray(data) ? data[0] : data;
            const leads = Array.isArray(root?.leads) ? root.leads : [];

            state.leadsData = leads.map(normalizeLeadRow);
            refreshFilterOptions(state.leadsData);

            applyAllFiltersAndRender({ resetPage: true });
        } catch (e) {
            ui.showError(`Erro: ${e.message}`);
            state.leadsData = [];
            state.filtered = [];
            renderTable();
            updateCharts();
            updateKpis([]);
        } finally {
            ui.hideLoading();
        }
    }

    function init() {
        const today = utils.today();
        if (elements.entryStartInput) elements.entryStartInput.value = today;
        if (elements.entryEndInput) elements.entryEndInput.value = today;

        if (elements.applyFilters) elements.applyFilters.addEventListener('click', loadLeads);

        if (elements.clearAllFilters) {
            elements.clearAllFilters.addEventListener('click', () => {
                if (elements.moneySelect) elements.moneySelect.value = '';
                if (elements.sellerSelect) elements.sellerSelect.value = '';

                [elements.moneySelect, elements.sellerSelect, elements.stageSelect, elements.timeSelect, elements.sistemaSelect, elements.desafioSelect, elements.tagSelect]
                    .filter(Boolean)
                    .forEach((sel) => {
                        if (!sel) return;
                        if (sel.hasAttribute('multiple')) {
                            Array.from(sel.options).forEach((o) => (o.selected = false));
                        } else {
                            sel.value = '';
                        }
                    });

                setAllAreaCheckboxes(false);
                setAreaMenuOpen(false);

                loadLeads();
            });
        }

        const onAnyFilterChange = () => applyAllFiltersAndRender({ resetPage: true });

        [elements.moneySelect, elements.sellerSelect, elements.stageSelect, elements.timeSelect, elements.sistemaSelect, elements.desafioSelect, elements.tagSelect]
            .filter(Boolean)
            .forEach((el) => el.addEventListener('change', onAnyFilterChange));


        // change nos checkboxes de área (delegação)
        if (elements.areaCheckboxes) {
            elements.areaCheckboxes.addEventListener('change', () => {
                updateAreaTriggerText();
                onAnyFilterChange();
            });
        }

        // ====== eventos do dropdown de Área ======
        if (elements.areaTrigger) {
            elements.areaTrigger.addEventListener('click', (e) => {
                e.preventDefault();
                const open = !elements.areaMulti?.classList.contains('is-open');
                setAreaMenuOpen(open);
            });
        }

        if (elements.areaSelectAll) {
            elements.areaSelectAll.addEventListener('click', (e) => {
                e.preventDefault();
                setAllAreaCheckboxes(true);
                onAnyFilterChange();
            });
        }

        if (elements.areaClear) {
            elements.areaClear.addEventListener('click', (e) => {
                e.preventDefault();
                setAllAreaCheckboxes(false);
                onAnyFilterChange();
            });
        }

        // fechar ao clicar fora
        document.addEventListener('pointerdown', (e) => {
            const wrap = elements.areaMulti;
            if (!wrap) return;
            if (wrap.classList.contains('is-open') && !wrap.contains(e.target)) setAreaMenuOpen(false);
        });

        // fechar no ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') setAreaMenuOpen(false);
        });

        const applyPresetDays = (days) => {
            const end = new Date();
            const start = new Date();
            start.setDate(end.getDate() - (days - 1));
            if (elements.entryStartInput) elements.entryStartInput.value = utils.getDateString(start);
            if (elements.entryEndInput) elements.entryEndInput.value = utils.getDateString(end);
            loadLeads();
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

            loadLeads();
        };

        if (elements.presetPrevDay) elements.presetPrevDay.addEventListener('click', () => applyRelativeDay(-1));
        if (elements.presetNextDay) elements.presetNextDay.addEventListener('click', () => applyRelativeDay(1));

        if (elements.closeToast) elements.closeToast.addEventListener('click', () => ui.hideError());

        document.querySelectorAll('.pagination[data-channel="leads"]').forEach((wrap) => {
            wrap.addEventListener('click', (e) => {
                const btn = e.target.closest('.pg-btn');
                if (!btn) return;
                state.pagination.page += btn.dataset.action === 'next' ? 1 : -1;
                renderTable();
            });

            const sel = wrap.querySelector('select.pg-size');
            if (sel) {
                sel.addEventListener('change', (e) => {
                    state.pagination.pageSize = Number(e.target.value);
                    state.pagination.page = 1;
                    renderTable();
                });
            }
        });

        document.querySelectorAll('th[data-sort]').forEach((th) => {
            th.addEventListener('click', () => {
                const key = th.dataset.sort;

                state.sort.direction = state.sort.key === key && state.sort.direction === 'desc' ? 'asc' : 'desc';
                state.sort.key = key;

                document.querySelectorAll('th[data-sort]').forEach((x) => x.classList.remove('active'));
                th.classList.add('active');

                renderTable();
            });
        });

        const defaultTh = document.querySelector('th[data-sort="entry_date"]');
        defaultTh?.classList.add('active');

        loadLeads();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
