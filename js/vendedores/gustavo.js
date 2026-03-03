(() => {
    const page = document.documentElement.getAttribute('data-page');
    if (page !== 'leads-gustavo') return;

    const CONFIG = {
        ENDPOINT: 'https://n8n.clinicaexperts.com.br/webhook/new-leads-vendedor-individual',
    };

    // Nome "fixo" do vendedor (use aliases normalizados: minúsculo + sem acentos)
    const FIXED_VENDOR_ALIASES = new Set(['gustavo']);
    const NAO_INFORMADO_VALUE = '__nao_informado__';

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

        escapeHtml(value) {
            return String(value ?? '')
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#039;');
        },

        parseAnyDate(s) {
            if (!s) return null;
            const str = String(s).trim();

            if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(str + 'T00:00:00');

            // Common DB timestamp format: "YYYY-MM-DD HH:MM:SS"
            if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str)) {
                return new Date(str.replace(' ', 'T'));
            }

            if (/^\d{4}\/\d{2}\/\d{2}$/.test(str)) {
                const [yyyy, mm, dd] = str.split('/');
                return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
            }

            if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
                const [dd, mm, yyyy] = str.split('/');
                return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
            }

            const d = new Date(str);
            return isNaN(d) ? null : d;
        },

        formatDatePt(value) {
            const d = this.parseAnyDate(value);
            if (!d) return String(value ?? '');
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const yyyy = d.getFullYear();
            return `${dd}/${mm}/${yyyy}`;
        },
        formatCurrencyBRL(value) {
            const n = Number(value);
            if (!Number.isFinite(n)) return '—';
            return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        },

        removeDiacritics(value) {
            return String(value ?? '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '');
        },

        // Cores/bordas (mesma lógica do leads-vendedor.js)
        stageClass(stage) {
            const s = this.removeDiacritics(String(stage || '').toLowerCase());
            if (s.includes('lead')) return 'badge--stage-lead';
            // Negociação deve ser rosa
            if (s.includes('negoci') || s.includes('negoti')) return 'badge--stage-negociacao';
            if (s.includes('apresent')) return 'badge--stage-apresentacao';
            if (s.includes('intera')) return 'badge--stage-interacao';
            if (s.includes('pagamento')) return 'badge--stage-pagamento';
            if (s.includes('proposta')) return 'badge--stage-proposta';
            return 'badge--stage-outro';
        },

        substageClass(substage) {
            const s = this.removeDiacritics(String(substage || '').toLowerCase());
            if (!s) return 'badge--substage-outro';
            if (s.includes('convers')) return 'badge--substage-conversa';
            if (s.includes('meet')) return 'badge--substage-meet';
            if (s.includes('test')) return 'badge--substage-teste';
            return 'badge--substage-outro';
        },
    };

    function normalizeVendor(value) {
        return utils.removeDiacritics(String(value ?? '').trim().toLowerCase());
    }

    function isFixedVendor(value) {
        return FIXED_VENDOR_ALIASES.has(normalizeVendor(value));
    }

    function normalizeMoney(value) {
        const v = String(value ?? '').trim().toLowerCase();
        if (!v) return 'unknown';
        if (['yes', 'sim', 'true', '1', 'y'].includes(v)) return 'yes';
        if (['no', 'não', 'nao', 'false', '0', 'n'].includes(v)) return 'no';
        return 'unknown';
    }
    // Converte strings monetárias (pt-BR / en-US) em número
    function parseMoneyValue(value) {
        if (value === null || value === undefined || value === '') return null;

        if (typeof value === 'number') return Number.isFinite(value) ? value : null;

        let s = String(value).trim();
        if (!s) return null;

        // remove "R$", espaços e outros símbolos comuns
        s = s.replace(/R\$|\s/g, '');

        // mantém somente dígitos, ponto, vírgula e sinal
        s = s.replace(/[^0-9,\.\-+]/g, '');

        if (!s) return null;

        // Caso tenha '.' e ',', decide qual é o decimal pelo último separador
        const hasDot = s.includes('.');
        const hasComma = s.includes(',');

        if (hasDot && hasComma) {
            if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
                // 1.234,56 -> 1234.56
                s = s.replace(/\./g, '').replace(',', '.');
            } else {
                // 1,234.56 -> 1234.56
                s = s.replace(/,/g, '');
            }
        } else if (hasComma && !hasDot) {
            // 1234,56 -> 1234.56
            s = s.replace(',', '.');
        } else {
            // 1,234 -> 1234
            s = s.replace(/,/g, '');
        }

        const n = Number(s);
        return Number.isFinite(n) ? n : null;
    }



    function normalizeStage(value) {
        const raw = String(value ?? '').trim();
        if (!raw) return 'presentation'; // default para dados antigos/sem stage

        const s = raw
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');

        // Apresentação
        if (s === 'presentation' || s.includes('present') || s.includes('apres') || s.startsWith('pres')) return 'presentation';

        // Proposta
        if (s === 'proposal_sent' || s.includes('proposal') || s.includes('propost')) return 'proposal_sent';

        // Pagamento
        if (s === 'payment_pending' || s.includes('payment') || s.includes('pagam') || s.includes('pagto')) return 'payment_pending';

        // Negociação
        if (s === 'negotiation' || s.includes('nego') || s.includes('negoci')) return 'negotiation';

        // Assinatura
        if (s === 'signature' || s.includes('signat') || s.includes('assin')) return 'signature';

        return 'presentation';
    }

    function normalizeSubstage(value) {
        const raw = String(value ?? '').trim();
        if (!raw) return '';

        const s = raw
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');

        if (s.includes('convers')) return 'Conversa';
        if (s.includes('meet')) return 'Meet';
        if (s.includes('test')) return 'Teste';

        // fallback: mantém o valor original (sem mexer)
        return raw;
    }

    function normalizeTimeBucket(value) {
        if (value === null || value === undefined || value === '') return '1-2';

        const s = String(value).trim().toLowerCase();
        if (!s) return '1-2';

        if (s === '1' || s === '2') return '1-2';
        if (s.includes('mais') && s.includes('10')) return '>10';

        const nums = (s.match(/\d+/g) || []).map((n) => Number(n)).filter((n) => !Number.isNaN(n));

        if (nums.length === 1) {
            const n = nums[0];
            if (n <= 2) return '1-2';
            if (n <= 5) return '3-5';
            if (n <= 10) return '6-10';
            return '>10';
        }

        if (nums.length >= 2) {
            const min = Math.min(...nums);
            const max = Math.max(...nums);

            if (max <= 2) return '1-2';
            if (min >= 3 && max <= 5) return '3-5';
            if (min >= 6 && max <= 10) return '6-10';
            return '>10';
        }

        return '>10';
    }

    function isLeadPequeno(timeValue) {
        return normalizeTimeBucket(timeValue) === '1-2';
    }

    function getSelectedValues(selectEl) {
        if (!selectEl) return [];
        return Array.from(selectEl.selectedOptions || []).map((o) => o.value).filter((v) => String(v).trim() !== '');
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

    function uniqueSorted(rows, key) {
        const set = new Set();
        rows.forEach((r) => {
            const v = String(r?.[key] ?? '').trim();
            if (v) set.add(v);
        });
        return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
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

    function matchesSelectValue(rowValue, selectedValues) {
        if (!selectedValues || !selectedValues.length) return true;

        const v = String(rowValue ?? '').trim();
        const wantsNaoInformado = selectedValues.includes(NAO_INFORMADO_VALUE);

        if (!v) return wantsNaoInformado;
        return selectedValues.includes(v);
    }

    const dom = { byId: (id) => document.getElementById(id) };

    const elements = {
        entryStartInput: dom.byId('entryStartDate'),
        entryEndInput: dom.byId('entryEndDate'),

        applyFilters: dom.byId('applyFilters'),
        clearAllFilters: dom.byId('clearAllFilters'),

        stageSelect: dom.byId('stageSelect'),
        substageSelect: dom.byId('substageSelect'),
        moneySelect: dom.byId('moneySelect'),
        areaSelect: dom.byId('areaSelect'),
        timeSelect: dom.byId('timeSelect'),
        desafioSelect: dom.byId('desafioSelect'),
        globalSearch: dom.byId('globalSearch'),

        presetPrevDay: dom.byId('presetPrevDay'),
        presetNextDay: dom.byId('presetNextDay'),
        preset7: dom.byId('preset7'),
        preset14: dom.byId('preset14'),
        preset30: dom.byId('preset30'),

        kpiShown: dom.byId('kpiShown'),
        kpiPequenos: dom.byId('kpiPequenos'),
        kpiGrandes: dom.byId('kpiGrandes'),
        kpiMoneyYes: dom.byId('kpiMoneyYes'),
        kpiTicketMedio: dom.byId('kpiTicketMedio'),
        kpiTaxaConversao: dom.byId('kpiTaxaConversao'),
        kpiTotalPagamentoPendente: dom.byId('kpiTotalPagamentoPendente'),
        kpiTotalNegociacao: dom.byId('kpiTotalNegociacao'),

        recordsBody: dom.byId('recordsBody'),
        recordsPrev: dom.byId('recordsPrev'),
        recordsNext: dom.byId('recordsNext'),
        recordsPageInfo: dom.byId('recordsPageInfo'),
        recordsPageSize: dom.byId('recordsPageSize'),

        loadingOverlay: dom.byId('loadingOverlay'),
        errorToast: dom.byId('errorToast'),
        errorMessage: dom.byId('errorMessage'),
        closeToast: dom.byId('closeToast'),
    };

    const state = {
        rows: [],
        filtered: [],
        sort: { key: 'ENTREGUE', direction: 'desc' },
        pagination: { page: 1, pageSize: 20, totalPages: 1 },
    };

    function clamp(n, min, max) {
        return Math.min(max, Math.max(min, n));
    }

    function updatePagination(totalRows) {
        const size = Number(state.pagination.pageSize) || 20;
        const totalPages = Math.max(1, Math.ceil((totalRows || 0) / size));

        state.pagination.totalPages = totalPages;
        state.pagination.page = clamp(state.pagination.page || 1, 1, totalPages);

        if (elements.recordsPageInfo) elements.recordsPageInfo.textContent = `${state.pagination.page} / ${totalPages}`;
        if (elements.recordsPrev) elements.recordsPrev.disabled = state.pagination.page <= 1;
        if (elements.recordsNext) elements.recordsNext.disabled = state.pagination.page >= totalPages;
    }

    function paginateRows(rows) {
        updatePagination(rows?.length || 0);
        const size = Number(state.pagination.pageSize) || 20;
        const start = (state.pagination.page - 1) * size;
        return rows.slice(start, start + size);
    }

    const ui = {
        showLoading() {
            if (elements.loadingOverlay) elements.loadingOverlay.classList.add('active');
        },
        hideLoading() {
            if (elements.loadingOverlay) elements.loadingOverlay.classList.remove('active');
        },
        showError(message) {
            if (!elements.errorToast || !elements.errorMessage) return;
            elements.errorMessage.textContent = message;
            elements.errorToast.classList.add('active');
            setTimeout(() => this.hideError(), 4500);
        },
        hideError() {
            if (elements.errorToast) elements.errorToast.classList.remove('active');
        },
        renderSkeletonRows(count = 10, cols = 15) {
            return Array(count)
                .fill(0)
                .map(
                    () =>
                        `<tr>${Array(cols)
                            .fill(0)
                            .map(() => `<td><div class="skeleton" style="width:100%;height:18px;"></div></td>`)
                            .join('')}</tr>`
                )
                .join('');
        },
        renderEmptyState(message = 'Sem dados', colspan = 15) {
            return `
        <tr>
          <td colspan="${colspan}">
            <div class="empty-state">
              <div class="empty-state__icon">📄</div>
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
                if (v !== null && v !== undefined && String(v).trim() !== '') params.set(k, v);
            });
            params.set('_ts', Date.now());
            return `${base}?${params.toString()}`;
        },

        async fetchRows(paramsObj) {
            const url = this.buildUrl(CONFIG.ENDPOINT, paramsObj);

            const response = await fetch(url, { cache: 'no-store' });
            const rawText = await response.text();

            if (!response.ok) {
                const snippet = rawText ? rawText.slice(0, 220) : '';
                throw new Error(`HTTP ${response.status}${snippet ? ` — ${snippet}` : ''}`);
            }

            const text = (rawText || '').trim();
            if (!text) return [];

            try {
                return JSON.parse(text);
            } catch (err) {
                const snippet = text.slice(0, 220);
                throw new Error(`Resposta não é JSON válido — ${snippet}`);
            }
        },
    };

    function extractPayload(payload) {
        const out = { rows: [], vendasPorVendedor: [], managers: [] };

        // Novo formato: array com 3 itens (registros + vendas_por_vendedor + managers)
        if (Array.isArray(payload)) {
            const registrosItem = payload.find((x) => Array.isArray(x?.registros));
            if (registrosItem) out.rows = registrosItem.registros;

            const vendasItem = payload.find((x) => Array.isArray(x?.vendas_por_vendedor));
            if (vendasItem) out.vendasPorVendedor = vendasItem.vendas_por_vendedor;

            const managersItem = payload.find((x) => Array.isArray(x?.managers));
            if (managersItem) out.managers = managersItem.managers;

            // Backward compatibility: alguns endpoints antigos retornam a lista de registros direto
            if (!out.rows.length && !out.vendasPorVendedor.length && !out.managers.length) {
                out.rows = payload;
            }

            return out;
        }

        // Outros formatos comuns
        if (Array.isArray(payload?.registros)) out.rows = payload.registros;
        else if (payload?.data && Array.isArray(payload.data)) out.rows = payload.data;
        else if (payload?.items && Array.isArray(payload.items)) out.rows = payload.items;
        else if (payload?.result && Array.isArray(payload.result)) out.rows = payload.result;

        if (Array.isArray(payload?.vendas_por_vendedor)) out.vendasPorVendedor = payload.vendas_por_vendedor;
        if (Array.isArray(payload?.managers)) out.managers = payload.managers;

        return out;
    }

    function getField(obj, keys) {
        for (const k of keys) {
            if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
        }
        return '';
    }

    function normalizeRow(raw) {
        const rowNumber = getField(raw, ['row_number', 'rowNumber', 'Row', '#', 'Linha']);
        const id = getField(raw, ['ID', 'id']);

        const entrada = getField(raw, [
            'ENTRADA',
            'Entrada',
            'entrada',
            'entry',
            'ENTRY',
            'entry_date',
            'entryDate',
            'DATA_ENTRADA',
            'data_entrada',
            'created_at',
            'createdAt',
        ]);

        const entregue = getField(raw, [
            'ENTREGUE',
            'Entregue',
            'entregue',
            'DATA',
            'Data',
            'date',
            'delivered_at',
            'deliveredAt',
            'DATA_ENTREGUE',
            'data_entregue',
        ]);

        const vendedor = getField(raw, ['VENDEDOR', 'Vendedor', 'seller', 'vendedor']);
        const phone = getField(raw, ['PHONE', 'Phone', 'phone', 'Contato', 'contato']);
        const link = getField(raw, ['LINK', 'Link', 'link']);

        const money = getField(raw, ['MONEY', 'Money', 'money', 'tem_money', 'temMoney']);
        const area = getField(raw, ['AREA', 'Área', 'area']);
        const time = getField(raw, ['TIME', 'Time', 'time']);
        const sistema = getField(raw, ['SISTEMA', 'Sistema', 'sistema', 'SYSTEM', 'system']);
        const desafio = getField(raw, ['DESAFIO', 'Desafio', 'desafio', 'CHALLENGE', 'challenge']);
        const origem = getField(raw, ['ORIGEM', 'origem']);

        const stageFunnel = getField(raw, ['stage_funnel', 'STAGE_FUNNEL', 'stageFunnel', 'Stage_funnel']);

        // Alguns payloads não trazem o STAGE (código). Nesses casos, derivamos pelo rótulo do funil.
        const stageRaw = getField(raw, ['STAGE', 'stage', 'stage_code', 'STAGE_CODE', 'stageCode']);
        const stage = normalizeStage(stageRaw || stageFunnel);

        const substageRaw = getField(raw, ['substage', 'SUBSTAGE', 'Substage', 'sub_stage', 'SUB_STAGE', 'subStage']);
        const substage = normalizeSubstage(substageRaw);


        // Valores por etapa (vêm do payload do n8n)
        const paymentPendingValueRaw = getField(raw, [
            'payment_pending_value',
            'paymentPendingValue',
            'value_payment_pending',
            'value_paymentPending',
            'payment_pendingValue',
            'payment_pending',
        ]);
        const negotiationValueRaw = getField(raw, [
            'negotiation_value',
            'negotiationValue',
            'value_negotiation',
            'value_negotiation_value',
            'negotiation',
        ]);

        const paymentPendingValue = parseMoneyValue(paymentPendingValueRaw);
        const negotiationValue = parseMoneyValue(negotiationValueRaw);

        return {
            row_number: rowNumber,
            ID: id,

            ENTRADA: entrada,
            ENTREGUE: entregue,
            DATA: entregue,

            VENDEDOR: vendedor,
            PHONE: phone,
            LINK: link,

            MONEY: money,
            AREA: area,
            TIME: time,
            SISTEMA: sistema,
            DESAFIO: desafio,
            ORIGEM: origem,

            PAYMENT_PENDING_VALUE_RAW: paymentPendingValueRaw,
            NEGOTIATION_VALUE_RAW: negotiationValueRaw,
            PAYMENT_PENDING_VALUE: paymentPendingValue,
            NEGOTIATION_VALUE: negotiationValue,

            STAGE_FUNNEL: stageFunnel,
            SUBSTAGE: substage,
            STAGE: stage,
        };


    }



    function getValueForSelectedStage(row, selectedStage) {
        const stage = String(selectedStage || '').trim();
        if (stage === 'payment_pending') return row?.PAYMENT_PENDING_VALUE;
        if (stage === 'negotiation') return row?.NEGOTIATION_VALUE;
        return null;
    }

    function computeTotalsKpisFromAllRows(allRows) {
        const rows = Array.isArray(allRows) ? allRows : [];

        let totalPagamento = 0;
        let totalNegociacao = 0;

        rows.forEach((r) => {
            const st = normalizeStage(r?.STAGE);

            if (st === 'payment_pending') {
                const n = parseMoneyValue(r?.PAYMENT_PENDING_VALUE);
                if (Number.isFinite(n)) totalPagamento += n;
                else if (Number.isFinite(r?.PAYMENT_PENDING_VALUE)) totalPagamento += r.PAYMENT_PENDING_VALUE;
            }

            if (st === 'negotiation') {
                const n = parseMoneyValue(r?.NEGOTIATION_VALUE);
                if (Number.isFinite(n)) totalNegociacao += n;
                else if (Number.isFinite(r?.NEGOTIATION_VALUE)) totalNegociacao += r.NEGOTIATION_VALUE;
            }
        });

        return { totalPagamento, totalNegociacao };
    }

    const render = {
        recordsTable(rows, { selectedStage } = {}) {
            if (!elements.recordsBody) return;

            if (!rows || rows.length === 0) {
                elements.recordsBody.innerHTML = ui.renderEmptyState('Sem registros no filtro selecionado', 15);
                return;
            }

            const html = rows
                .map((r, idx) => {
                    const entryDate = utils.escapeHtml(utils.formatDatePt(r.ENTRADA));
                    const deliveredDate = utils.escapeHtml(utils.formatDatePt(r.ENTREGUE ?? r.DATA));
                    const vendor = utils.escapeHtml(r.VENDEDOR ?? '');
                    const phone = utils.escapeHtml(String(r.PHONE ?? ''));
                    const link = String(r.LINK ?? '').trim();

                    const linkCell = link
                        ? `<a class="table-link" href="${utils.escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Abrir</a>`
                        : '<span class="mono">—</span>';

                    const money = utils.escapeHtml(r.MONEY ?? '');
                    const area = utils.escapeHtml(r.AREA ?? '');
                    const time = utils.escapeHtml(r.TIME ?? '');
                    const sistema = utils.escapeHtml(r.SISTEMA ?? '');

                    const rawValue = getValueForSelectedStage(r, selectedStage);
                    const valueCell = (rawValue === null || rawValue === undefined || String(rawValue).trim() === '')
                        ? '—'
                        : (Number.isFinite(Number(rawValue)) ? utils.formatCurrencyBRL(rawValue) : '—');

                    const desafio = utils.escapeHtml(r.DESAFIO ?? '');
                    const origem = utils.escapeHtml(r.ORIGEM ?? '');

                    const stageFunnelRaw = String(r.STAGE_FUNNEL ?? '').trim();
                    const stageFunnelCell = stageFunnelRaw
                        ? `<span class="badge ${utils.stageClass(stageFunnelRaw)}">${utils.escapeHtml(stageFunnelRaw)}</span>`
                        : '<span class="mono">—</span>';

                    const substageRaw = String(r.SUBSTAGE ?? '').trim();
                    const substageCell = substageRaw
                        ? `<span class="badge badge--substage ${utils.substageClass(substageRaw)}">${utils.escapeHtml(substageRaw)}</span>`
                        : '<span class="mono">—</span>';

                    const stage = utils.escapeHtml(r.STAGE ?? '');

                    return `
            <tr>
              <td>${entryDate}</td>
              <td>${deliveredDate}</td>
              <td>${vendor}</td>
              <td class="mono">${phone}</td>
              <td>${linkCell}</td>
              <td>${stageFunnelCell}</td>
              <td>${substageCell}</td>
              <td>${money || '—'}</td>
              <td class="col-valor-cell mono">${valueCell}</td>
              <td>${area || '—'}</td>
              <td>${time || '—'}</td>
              <td>${sistema || '—'}</td>
              <td>${desafio || '—'}</td>
              <td>${origem || '—'}</td>
              <td>${stage || '—'}</td>
            </tr>
          `;
                })
                .join('');

            elements.recordsBody.innerHTML = html;
        },
    };

    function sortRows(items, selectedStage) {
        const { key, direction } = state.sort;
        const dir = direction === 'asc' ? 1 : -1;
        const asText = (v) => String(v ?? '').toLowerCase();

        if (key === 'ENTRADA' || key === 'ENTREGUE' || key === 'DATA') {
            return [...items].sort((a, b) => {
                const aTime = utils.parseAnyDate(a?.[key])?.getTime?.() || 0;
                const bTime = utils.parseAnyDate(b?.[key])?.getTime?.() || 0;
                return (aTime - bTime) * dir;
            });
        }

        if (key === 'VALOR') {
            return [...items].sort((a, b) => {
                const aVal = getValueForSelectedStage(a, selectedStage);
                const bVal = getValueForSelectedStage(b, selectedStage);
                const an = parseMoneyValue(aVal);
                const bn = parseMoneyValue(bVal);
                const av = Number.isFinite(an) ? an : (Number.isFinite(Number(aVal)) ? Number(aVal) : 0);
                const bv = Number.isFinite(bn) ? bn : (Number.isFinite(Number(bVal)) ? Number(bVal) : 0);
                return (av - bv) * dir;
            });
        }


        return [...items].sort((a, b) => asText(a?.[key]).localeCompare(asText(b?.[key]), 'pt-BR') * dir);
    }

    function applyAllFiltersAndRender({ resetPage = false } = {}) {
        if (resetPage) state.pagination.page = 1;

        const selectedStage = (elements.stageSelect?.value || 'presentation').trim() || 'presentation';
        const moneyMode = (elements.moneySelect?.value || '').trim(); // '', yes, no, unknown

        const substages = getSelectedValues(elements.substageSelect);
        const areas = getSelectedValues(elements.areaSelect);
        const times = getSelectedValues(elements.timeSelect);
        const desafios = getSelectedValues(elements.desafioSelect);

        const q = String(elements.globalSearch?.value || '').trim().toLowerCase();

        let out = [...state.rows];

        if (selectedStage) out = out.filter((r) => normalizeStage(r.STAGE) === selectedStage);

        if (substages.length) out = out.filter((r) => matchesSelectValue(r.SUBSTAGE, substages));

        if (moneyMode) out = out.filter((r) => normalizeMoney(r.MONEY) === moneyMode);

        if (areas.length) out = out.filter((r) => matchesSelectValue(r.AREA, areas));
        if (times.length) out = out.filter((r) => matchesSelectValue(r.TIME, times));
        if (desafios.length) out = out.filter((r) => matchesSelectValue(r.DESAFIO, desafios));

        if (q) {
            out = out.filter((r) => {
                const hay = [
                    r.PHONE,
                    r.LINK,
                    r.DESAFIO,
                    r.SISTEMA,
                    r.AREA,
                    r.TIME,
                    r.VENDEDOR,
                    r.ENTRADA,
                    r.ENTREGUE,
                    r.MONEY,
                    r.ORIGEM,
                    r.PAYMENT_PENDING_VALUE_RAW,
                    r.NEGOTIATION_VALUE_RAW,
                    r.PAYMENT_PENDING_VALUE,
                    r.NEGOTIATION_VALUE,
                    r.STAGE_FUNNEL,
                    r.SUBSTAGE,
                    r.STAGE,
                ]
                    .map((x) => String(x ?? '').toLowerCase())
                    .join(' | ');
                return hay.includes(q);
            });
        }

        state.filtered = out;

        const sorted = sortRows(state.filtered, selectedStage);
        const pageRows = paginateRows(sorted);
        render.recordsTable(pageRows, { selectedStage });

        const totalShown = state.filtered.length || 0;

        let pequenosTotal = 0;
        let grandesTotal = 0;
        state.filtered.forEach((r) => {
            if (isLeadPequeno(r.TIME)) pequenosTotal += 1;
            else grandesTotal += 1;
        });

        const moneyCounts = countBy(state.filtered, 'MONEY', { normalizeFn: normalizeMoney });
        const yes = moneyCounts.yes || 0;
        const pct = totalShown ? Math.round((yes / totalShown) * 100) : 0;

        if (elements.kpiShown) elements.kpiShown.textContent = String(totalShown);
        if (elements.kpiPequenos) elements.kpiPequenos.textContent = String(pequenosTotal);
        if (elements.kpiGrandes) elements.kpiGrandes.textContent = String(grandesTotal);
        if (elements.kpiMoneyYes) elements.kpiMoneyYes.textContent = totalShown ? `${pct}%` : '—';
    }


    function updateVendorKpis(vendasPorVendedor, managers) {
        const aliases = Array.from(FIXED_VENDOR_ALIASES).map(normalizeVendor);

        const matchAlias = (name) => {
            const n = normalizeVendor(name);
            return aliases.includes(n);
        };

        // Ticket médio mensal (managers[])
        const managerRow = (Array.isArray(managers) ? managers : []).find((m) =>
            matchAlias(m?.manager ?? m?.Manager ?? m?.vendedor ?? m?.Vendedor)
        );

        const ticket = managerRow?.ticket_medio_mensal;
        if (elements.kpiTicketMedio) {
            elements.kpiTicketMedio.textContent = Number.isFinite(Number(ticket)) ? utils.formatCurrencyBRL(ticket) : '—';
        }

        // Taxa de conversão (vendas_por_vendedor[])
        const vendasRow = (Array.isArray(vendasPorVendedor) ? vendasPorVendedor : []).find((v) =>
            matchAlias(v?.vendedor ?? v?.Vendedor ?? v?.seller ?? v?.manager)
        );

        const convPct = vendasRow?.taxa_conversao_pct;
        if (elements.kpiTaxaConversao) {
            const n = Number(convPct);
            elements.kpiTaxaConversao.textContent = Number.isFinite(n)
                ? `${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
                : '—';
        }
    }

    async function loadData() {
        const entryStart = elements.entryStartInput?.value || '';
        const entryEnd = elements.entryEndInput?.value || '';

        if (!entryStart || !entryEnd) {
            ui.showError('Selecione o período de entrega');
            return;
        }

        ui.showLoading();
        if (elements.recordsBody) elements.recordsBody.innerHTML = ui.renderSkeletonRows(10, 15);

        try {
            const res = await api.fetchRows({ entry_start: entryStart, entry_end: entryEnd });
            const { rows: rawRows, vendasPorVendedor, managers } = extractPayload(res);
            const allRows = (rawRows || []).map(normalizeRow);

            // Filtra SOMENTE o vendedor fixo
            const rows = allRows.filter((r) => isFixedVendor(r.VENDEDOR));

            state.rows = rows;

            // KPIs: Totais (sempre visíveis, independentes do filtro atual)
            const totals = computeTotalsKpisFromAllRows(state.rows);
            if (elements.kpiTotalPagamentoPendente) {
                elements.kpiTotalPagamentoPendente.textContent = utils.formatCurrencyBRL(totals.totalPagamento || 0);
            }
            if (elements.kpiTotalNegociacao) {
                elements.kpiTotalNegociacao.textContent = utils.formatCurrencyBRL(totals.totalNegociacao || 0);
            }

            updateVendorKpis(vendasPorVendedor, managers);

            setOptions(elements.substageSelect, uniqueSorted(rows, 'SUBSTAGE'), { keepSelected: true, includeNotInformed: true });
            setOptions(elements.areaSelect, uniqueSorted(rows, 'AREA'), { keepSelected: true, includeNotInformed: true });
            setOptions(elements.timeSelect, uniqueSorted(rows, 'TIME'), { keepSelected: true, includeNotInformed: true });
            setOptions(elements.desafioSelect, uniqueSorted(rows, 'DESAFIO'), { keepSelected: true, includeNotInformed: true });

            applyAllFiltersAndRender({ resetPage: true });
        } catch (e) {
            ui.showError(`Failed to load leads: ${e.message}`);
            if (elements.kpiTicketMedio) elements.kpiTicketMedio.textContent = '—';
            if (elements.kpiTaxaConversao) elements.kpiTaxaConversao.textContent = '—';
            if (elements.kpiTotalPagamentoPendente) elements.kpiTotalPagamentoPendente.textContent = '—';
            if (elements.kpiTotalNegociacao) elements.kpiTotalNegociacao.textContent = '—';
            if (elements.recordsBody) elements.recordsBody.innerHTML = ui.renderEmptyState('Erro ao carregar', 15);
        } finally {
            ui.hideLoading();
        }
    }

    function initializeDates() {
        const today = utils.today();
        if (elements.entryStartInput) elements.entryStartInput.value = today;
        if (elements.entryEndInput) elements.entryEndInput.value = today;

        // sincroniza pageSize inicial com o select (se existir)
        const ps = Number(elements.recordsPageSize?.value);
        if (!Number.isNaN(ps) && ps > 0) state.pagination.pageSize = ps;
    }

    function setupEventListeners() {
        if (elements.closeToast) elements.closeToast.addEventListener('click', () => ui.hideError());
        if (elements.applyFilters) elements.applyFilters.addEventListener('click', loadData);

        const onAnyFilterChange = () => applyAllFiltersAndRender({ resetPage: true });
        [elements.moneySelect, elements.areaSelect, elements.timeSelect, elements.stageSelect, elements.substageSelect, elements.desafioSelect]
            .filter(Boolean)
            .forEach((el) => el.addEventListener('change', onAnyFilterChange));

        let searchTimer = null;
        if (elements.globalSearch) {
            elements.globalSearch.addEventListener('input', () => {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(() => applyAllFiltersAndRender({ resetPage: true }), 200);
            });
        }

        const applyPresetDays = (days) => {
            const end = new Date();
            const start = new Date();
            start.setDate(end.getDate() - (days - 1));
            if (elements.entryStartInput) elements.entryStartInput.value = utils.getDateString(start);
            if (elements.entryEndInput) elements.entryEndInput.value = utils.getDateString(end);
            loadData();
        };

        const applyNextDay = () => {
            const startStr = elements.entryStartInput?.value || '';
            const endStr = elements.entryEndInput?.value || '';

            let baseStr = startStr || endStr || utils.today();
            if (startStr && endStr && startStr === endStr) baseStr = startStr;

            const baseDate = utils.parseAnyDate(baseStr) || new Date();
            baseDate.setDate(baseDate.getDate() + 1);

            const next = utils.getDateString(baseDate);
            if (elements.entryStartInput) elements.entryStartInput.value = next;
            if (elements.entryEndInput) elements.entryEndInput.value = next;

            loadData();
        };

        const applyPreviousDay = () => {
            const startStr = elements.entryStartInput?.value || '';
            const endStr = elements.entryEndInput?.value || '';

            let baseStr = startStr || endStr || utils.today();
            if (startStr && endStr && startStr === endStr) baseStr = startStr;

            const baseDate = utils.parseAnyDate(baseStr) || new Date();
            baseDate.setDate(baseDate.getDate() - 1);

            const prev = utils.getDateString(baseDate);
            if (elements.entryStartInput) elements.entryStartInput.value = prev;
            if (elements.entryEndInput) elements.entryEndInput.value = prev;

            loadData();
        };

        if (elements.presetNextDay) elements.presetNextDay.addEventListener('click', applyNextDay);
        if (elements.presetPrevDay) elements.presetPrevDay.addEventListener('click', applyPreviousDay);

        if (elements.preset7) elements.preset7.addEventListener('click', () => applyPresetDays(7));
        if (elements.preset14) elements.preset14.addEventListener('click', () => applyPresetDays(14));
        if (elements.preset30) elements.preset30.addEventListener('click', () => applyPresetDays(30));

        if (elements.clearAllFilters) {
            elements.clearAllFilters.addEventListener('click', () => {
                if (elements.moneySelect) elements.moneySelect.value = '';
                if (elements.stageSelect) elements.stageSelect.value = 'presentation';
                if (elements.substageSelect) elements.substageSelect.value = '';
                if (elements.globalSearch) elements.globalSearch.value = '';

                [elements.areaSelect, elements.timeSelect, elements.desafioSelect]
                    .filter(Boolean)
                    .forEach((sel) => {
                        if (sel.hasAttribute('multiple')) {
                            Array.from(sel.options).forEach((o) => (o.selected = false));
                        } else {
                            sel.value = '';
                        }
                    });

                applyAllFiltersAndRender({ resetPage: true });
            });
        }

        const onEnter = (e) => {
            if (e.key !== 'Enter') return;
            loadData();
        };

        if (elements.entryStartInput) elements.entryStartInput.addEventListener('keypress', onEnter);
        if (elements.entryEndInput) elements.entryEndInput.addEventListener('keypress', onEnter);

        if (elements.recordsPrev) {
            elements.recordsPrev.addEventListener('click', () => {
                state.pagination.page = Math.max(1, (state.pagination.page || 1) - 1);
                applyAllFiltersAndRender();
            });
        }
        if (elements.recordsNext) {
            elements.recordsNext.addEventListener('click', () => {
                state.pagination.page = Math.min(state.pagination.totalPages || 1, (state.pagination.page || 1) + 1);
                applyAllFiltersAndRender();
            });
        }
        if (elements.recordsPageSize) {
            elements.recordsPageSize.addEventListener('change', () => {
                state.pagination.pageSize = Number(elements.recordsPageSize.value) || 20;
                state.pagination.page = 1;
                applyAllFiltersAndRender();
            });
        }

        document.querySelectorAll('.data-table--records th[data-sort]').forEach((th) => {
            th.addEventListener('click', () => {
                const key = th.dataset.sort;

                state.sort.direction = (state.sort.key === key && state.sort.direction === 'desc') ? 'asc' : 'desc';
                state.sort.key = key;

                document.querySelectorAll('.data-table--records th[data-sort]').forEach((x) => x.classList.remove('active'));
                th.classList.add('active');

                applyAllFiltersAndRender();
            });
        });

        const defaultTh = document.querySelector('.data-table--records th[data-sort="ENTREGUE"]');
        defaultTh?.classList.add('active');
    }

    function init() {
        initializeDates();
        setupEventListeners();
        loadData();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
