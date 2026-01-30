(() => {
  const page = document.documentElement.getAttribute('data-page');
  if (page !== 'leads-vendedor') return;

  const CONFIG = {
    ENDPOINT: 'https://n8n.clinicaexperts.com.br/webhook/leads-vendedor',
  };
  const NAO_INFORMADO_VALUE = '__nao_informado__';

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

    removeDiacritics(value) {
      return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    },
    stageClass(stage) {
      const s = this.removeDiacritics(String(stage || '').toLowerCase());
      if (s.includes('lead')) return 'badge--stage-lead';
      if (s.includes('apresent')) return 'badge--stage-apresentacao';
      if (s.includes('intera')) return 'badge--stage-interacao';
      return 'badge--stage-outro';
    },
  };

  function normalizeMoney(value) {
    const v = String(value ?? '').trim().toLowerCase();
    if (!v) return 'unknown';
    if (['yes', 'sim', 'true', '1', 'y'].includes(v)) return 'yes';
    if (['no', 'não', 'nao', 'false', '0', 'n'].includes(v)) return 'no';
    return 'unknown';
  }

  function normalizeStage(value) {

    const raw = String(value ?? '').trim();
    if (!raw) return 'presentation'; // default para dados antigos/sem stage

    const s = raw
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, ''); // remove acentos

    if (s.includes('present') || s.includes('apres') || s.startsWith('pres')) return 'presentation';

    if (s.includes('nego') || s.includes('negoci')) return 'negotiation';

    return 'presentation';
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

  function timeBucketLabel(timeValue) {
    const b = normalizeTimeBucket(timeValue);
    if (b === '1-2') return '1-2 / Não informado';
    if (b === '3-5') return '3 a 5';
    if (b === '6-10') return '6 a 10';
    return 'Mais de 10';
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
    if (!isMultiple) {
      optionsHtml.push('<option value="">Todos</option>');
    }

    values.forEach((v) => {
      optionsHtml.push(`<option value="${utils.escapeHtml(v)}">${utils.escapeHtml(v)}</option>`);
    });

    if (includeNotInformed) {
      const hasLabel = values.some(
        (v) => String(v ?? '').trim().toLowerCase() === 'não informado'
      );
      if (!hasLabel) {
        optionsHtml.push(`<option value="${NAO_INFORMADO_VALUE}">Não informado</option>`);
      }
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

  function topNFromCounts(counts, n = 10) {
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n);
  }

  function pickTopKey(rows, key) {
    const counts = countBy(rows, key);
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : '—';
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

  const dom = {
    byId(id) {
      return document.getElementById(id);
    },
  };

  const elements = {
    entryStartInput: dom.byId('entryStartDate'),
    entryEndInput: dom.byId('entryEndDate'),
    vendorSelect: dom.byId('vendorSelect'),
    applyFilters: dom.byId('applyFilters'),
    clearVendor: dom.byId('clearVendor'),

    moneySelect: dom.byId('moneySelect'),
    areaSelect: dom.byId('areaSelect'),
    timeSelect: dom.byId('timeSelect'),
    sistemaSelect: dom.byId('sistemaSelect'),
    stageSelect: dom.byId('stageSelect'),
    desafioSelect: dom.byId('desafioSelect'),
    globalSearch: dom.byId('globalSearch'),
    presetPrevDay: dom.byId('presetPrevDay'),
    presetNextDay: dom.byId('presetNextDay'),

    preset7: dom.byId('preset7'),
    preset14: dom.byId('preset14'),
    preset30: dom.byId('preset30'),
    clearAllFilters: dom.byId('clearAllFilters'),

    kpiTotal: dom.byId('kpiTotal'),
    kpiShown: dom.byId('kpiShown'),
    kpiMoneyPct: dom.byId('kpiMoneyPct'),

    rangePill: dom.byId('rangePill'),

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
    vendorCounts: {},
    sort: { key: 'ENTREGUE', direction: 'desc' }, // default: Entregue desc
    charts: {},

    pagination: {
      page: 1,
      pageSize: 25,
      totalPages: 1,
    },
  };

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function updatePagination(totalRows) {
    const size = Number(state.pagination.pageSize) || 25;
    const totalPages = Math.max(1, Math.ceil((totalRows || 0) / size));

    state.pagination.totalPages = totalPages;
    state.pagination.page = clamp(state.pagination.page || 1, 1, totalPages);

    if (elements.recordsPageInfo) {
      elements.recordsPageInfo.textContent = `${state.pagination.page} / ${totalPages}`;
    }
    if (elements.recordsPrev) elements.recordsPrev.disabled = state.pagination.page <= 1;
    if (elements.recordsNext) elements.recordsNext.disabled = state.pagination.page >= totalPages;
  }

  function paginateRows(rows) {
    updatePagination(rows?.length || 0);
    const size = Number(state.pagination.pageSize) || 25;
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
      if (!elements.errorToast) return;
      elements.errorToast.classList.remove('active');
    },
    renderSkeletonRows(count = 10, cols = 10) {
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
    renderEmptyState(message = 'Sem dados', colspan = 10) {
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

  function extractRows(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload?.data && Array.isArray(payload.data)) return payload.data;
    if (payload?.items && Array.isArray(payload.items)) return payload.items;
    if (payload?.result && Array.isArray(payload.result)) return payload.result;
    return [];
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
    const stageRaw = getField(raw, ['STAGE', 'stage']);
    const stage = normalizeStage(stageRaw);

    const stageFunnel = getField(raw, [
      'stage_funnel',
      'STAGE_FUNNEL',
      'stageFunnel',
      'Stage_funnel',
    ]);

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
      STAGE_FUNNEL: stageFunnel,
      STAGE: stage,
    };
  }

  const render = {
    vendorSelectOptions(vendors, keepSelected = true) {
      if (!elements.vendorSelect) return;
      const current = keepSelected ? (elements.vendorSelect.value || '') : '';

      const opts = ['<option value="">Todos</option>']
        .concat(
          vendors.map((v) => `<option value="${utils.escapeHtml(v)}">${utils.escapeHtml(v)}</option>`)
        )
        .join('');

      elements.vendorSelect.innerHTML = opts;
      if (keepSelected && vendors.includes(current)) elements.vendorSelect.value = current;
    },

    recordsTable(rows) {
      if (!elements.recordsBody) return;

      if (!rows || rows.length === 0) {
        elements.recordsBody.innerHTML = ui.renderEmptyState('Sem registros no filtro selecionado', 13);
        return;
      }

      const html = rows
        .map((r, idx) => {
          const num = r.row_number || (idx + 1);
          const id = utils.escapeHtml(r.ID ?? '');
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
          const desafio = utils.escapeHtml(r.DESAFIO ?? '');
          const origem = utils.escapeHtml(r.ORIGEM ?? '');
          const stageFunnelRaw = String(r.STAGE_FUNNEL ?? '').trim();
          const stageFunnelCell = stageFunnelRaw
            ? `<span class="badge ${utils.stageClass(stageFunnelRaw)}">${utils.escapeHtml(stageFunnelRaw)}</span>`
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
              <td>${money || '—'}</td>
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

  function computeVendorCounts(rows) {
    return rows.reduce((acc, r) => {
      const v = String(r.VENDEDOR || '').trim() || 'Sem vendedor';
      acc[v] = (acc[v] || 0) + 1;
      return acc;
    }, {});
  }

  function getVendorsFromCounts(counts) {
    return Object.keys(counts || {}).filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }

  function matchesSelectValue(rowValue, selectedValues) {
    if (!selectedValues || !selectedValues.length) return true;

    const v = String(rowValue ?? '').trim();
    const wantsNaoInformado = selectedValues.includes(NAO_INFORMADO_VALUE);

    if (!v) return wantsNaoInformado;
    return selectedValues.includes(v);
  }

  function applyAllFiltersAndRender({ resetPage = false } = {}) {
    if (resetPage) state.pagination.page = 1;
    const selectedVendor = (elements.vendorSelect?.value || '').trim();
    const selectedStage = (elements.stageSelect?.value || 'presentation').trim() || 'presentation';

    const entryStart = elements.entryStartInput?.value || '';
    const entryEnd = elements.entryEndInput?.value || '';

    const moneyMode = (elements.moneySelect?.value || '').trim(); // '', yes, no, unknown
    const areas = getSelectedValues(elements.areaSelect);
    const times = getSelectedValues(elements.timeSelect);
    const sistemas = getSelectedValues(elements.sistemaSelect);
    const desafios = getSelectedValues(elements.desafioSelect);

    const q = String(elements.globalSearch?.value || '').trim().toLowerCase();

    let out = [...state.rows];

    if (selectedStage) {
      out = out.filter((r) => normalizeStage(r.STAGE) === selectedStage);
    }

    if (selectedVendor) {
      out = out.filter((r) => String(r.VENDEDOR || '').trim() === selectedVendor);
    }

    if (moneyMode) {
      out = out.filter((r) => normalizeMoney(r.MONEY) === moneyMode);
    }

    if (areas.length) out = out.filter((r) => matchesSelectValue(r.AREA, areas));
    if (times.length) out = out.filter((r) => matchesSelectValue(r.TIME, times));
    if (sistemas.length) out = out.filter((r) => matchesSelectValue(r.SISTEMA, sistemas));
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
          r.STAGE_FUNNEL,
          r.STAGE,
        ]
          .map((x) => String(x ?? '').toLowerCase())
          .join(' | ');
        return hay.includes(q);
      });
    }

    state.filtered = out;

    const sorted = sortRows(state.filtered);
    const pageRows = paginateRows(sorted);
    render.recordsTable(pageRows);

    const moneyCounts = countBy(state.filtered, 'MONEY', { normalizeFn: normalizeMoney });
    const yes = moneyCounts.yes || 0;
    const totalShown = state.filtered.length || 0;
    const pct = totalShown ? Math.round((yes / totalShown) * 100) : 0;

    const rowsByStage = state.rows.filter(
      (r) => normalizeStage(r.STAGE) === selectedStage
    );
    if (elements.kpiTotal) elements.kpiTotal.textContent = String(rowsByStage.length);

    if (elements.kpiShown) elements.kpiShown.textContent = String(totalShown);
    if (elements.kpiMoneyPct) elements.kpiMoneyPct.textContent = totalShown ? `${pct}%` : '—';

    updateCharts();
  }

  function sortRows(items) {
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

    return [...items].sort((a, b) => {
      return asText(a?.[key]).localeCompare(asText(b?.[key]), 'pt-BR') * dir;
    });
  }

  function buildDailySeries(rows, dateKey) {
    const map = new Map();
    rows.forEach((r) => {
      const d = utils.parseAnyDate(r?.[dateKey]);
      if (!d) return;
      const k = utils.getDateString(d);
      if (!map.has(k)) map.set(k, { total: 0, yes: 0, no: 0, unknown: 0 });
      const bucket = map.get(k);
      bucket.total += 1;
      bucket[normalizeMoney(r.MONEY)] += 1;
    });

    const labels = Array.from(map.keys()).sort();
    return {
      labels,
      totals: labels.map((k) => map.get(k).total),
      yes: labels.map((k) => map.get(k).yes),
      no: labels.map((k) => map.get(k).no),
      unk: labels.map((k) => map.get(k).unknown),
    };
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

      const isNaoInformado =
        k.toLowerCase() === 'não informado' ||
        k.toLowerCase() === 'nao informado' ||
        k === NAO_INFORMADO_VALUE;

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
        labels: {
          boxWidth: 9,
          font: { size: 12 },
        },
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

  const BAR_VENDOR_OPTIONS = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      datalabels: {
        display: true,
        anchor: 'center',
        align: 'center',
        clamp: true,
        clip: true,
        font: { size: 12, weight: '700' },
        color: 'rgba(15, 23, 42, 0.9)',
        formatter: (v) => (Number(v) || 0).toString(),
      },
    },
    scales: {
      y: { beginAtZero: true, ticks: { precision: 0 } },
    },
  };

  const BAR_VENDOR_STACKED_OPTIONS = {
    responsive: true,
    maintainAspectRatio: false,

    // melhora o hover (não precisa acertar o segmento pequeno)
    interaction: { mode: 'index', intersect: false },

    plugins: {
      legend: { display: true, position: 'bottom' },

      // garante tooltip fácil no stacked
      tooltip: { mode: 'index', intersect: false },

      datalabels: {
        labels: {
          // 1) Valor do segmento (dentro da barra)
          segment: {
            display: (ctx) => (Number(ctx.dataset?.data?.[ctx.dataIndex]) || 0) > 0,
            anchor: "center",
            align: "center",
            clamp: true,
            clip: true,
            font: { size: 11, weight: "700" },
            color: "#ffffff",
            formatter: (v) => {
              const n = Number(v) || 0;
              return n > 0 ? String(n) : "";
            },
          },

          // 2) Total no topo (só no ÚLTIMO dataset, para não repetir)
          total: {
            display: (ctx) => ctx.datasetIndex === ctx.chart.data.datasets.length - 1,
            anchor: "end",
            align: "end",
            offset: 4,
            clamp: true,
            clip: false,
            font: { size: 12, weight: "800" },
            color: "rgba(15, 23, 42, 0.9)",
            formatter: (_v, ctx) => {
              const i = ctx.dataIndex;
              const ds = ctx.chart.data.datasets || [];
              const total = ds.reduce((sum, d) => sum + (Number(d.data?.[i]) || 0), 0);
              return total ? String(total) : "";
            },
          },
        },
      },

    },

    scales: {
      x: { stacked: true },
      y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
    },
  };


  const PIE_OPTIONS_NO_LEGEND = {
    ...PIE_OPTIONS,
    plugins: {
      ...(PIE_OPTIONS.plugins || {}),
      legend: { display: false },
    },
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

  function applySpecialSeriesColors(datasets) {
    (datasets || []).forEach((ds) => {
      const label = ds?.label ?? '';
      if (isNaoInformadoLabel(label)) {
        ds.backgroundColor = COLOR_NAO_INFORMADO;
        ds.borderColor = COLOR_NAO_INFORMADO;
        ds.borderWidth = 0;
      } else if (isOutrosLabel(label)) {
        ds.backgroundColor = COLOR_OUTROS;
        ds.borderColor = COLOR_OUTROS_BORDER;
        ds.borderWidth = 1;
      }
    });
  }

  function updateCharts() {
    const rows = state.filtered;

    const vendorMap = {};
    rows.forEach((r) => {
      const v = String(r.VENDEDOR || '').trim() || 'Sem vendedor';
      if (!vendorMap[v]) vendorMap[v] = { pequeno: 0, grande: 0 };

      if (isLeadPequeno(r.TIME)) vendorMap[v].pequeno += 1;
      else vendorMap[v].grande += 1;
    });

    // ordena por total desc e pega top 20 (mantém o comportamento parecido com o atual)
    const vendorTop = Object.entries(vendorMap)
      .map(([v, obj]) => ({ v, pequeno: obj.pequeno || 0, grande: obj.grande || 0, total: (obj.pequeno || 0) + (obj.grande || 0) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 20);

    const vendorLabels = vendorTop.map((x) => x.v);
    const pequenos = vendorTop.map((x) => x.pequeno);
    const grandes = vendorTop.map((x) => x.grande);

    ensureChart('chartVendor', {
      type: 'bar',
      data: {
        labels: vendorLabels,
        datasets: [
          {
            label: 'Leads Pequenos',
            data: pequenos,
            stack: 'time',
            backgroundColor: 'rgb(54, 162, 235)', // azul
          },
          {
            label: 'Leads Grandes',
            data: grandes,
            stack: 'time',
            backgroundColor: 'rgb(255, 159, 64)', // laranja
          },
        ],
      },
      options: BAR_VENDOR_STACKED_OPTIONS,
    });


    const areaPie = buildPieFromCounts(countBy(rows, 'AREA'), 7);
    ensureChart('chartArea', {
      type: 'pie',
      data: { labels: areaPie.labels, datasets: [pieDataset(areaPie.data, areaPie.labels)] },
      options: PIE_OPTIONS,
    });

    const timePie = buildPieFromCounts(countBy(rows, 'TIME'), 8);
    ensureChart('chartTime', {
      type: 'pie',
      data: { labels: timePie.labels, datasets: [pieDataset(timePie.data, timePie.labels)] },
      options: PIE_OPTIONS,
    });

    const sysPie = buildPieFromCounts(countBy(rows, 'SISTEMA'), 8);
    ensureChart('chartSistema', {
      type: 'pie',
      data: { labels: sysPie.labels, datasets: [pieDataset(sysPie.data, sysPie.labels)] },
      options: PIE_OPTIONS,
    });

    const moneyCounts = countBy(rows, 'MONEY', { normalizeFn: normalizeMoney });
    ensureChart('chartMoney', {
      type: 'pie',
      data: {
        labels: ['Sim', 'Não', 'Não informado'],
        datasets: [pieDataset([moneyCounts.yes || 0, moneyCounts.no || 0, moneyCounts.unknown || 0], ['Sim', 'Não', 'Não informado'])],
      },
      options: PIE_OPTIONS,
    });

    const origemPie = buildPieFromCounts(countBy(rows, 'ORIGEM'), 8);
    ensureChart('chartOrigem', {
      type: 'pie',
      data: { labels: origemPie.labels, datasets: [pieDataset(origemPie.data, origemPie.labels)] },
      options: PIE_OPTIONS,
    });

    const desPie = buildPieFromCounts(countBy(rows, 'DESAFIO'), 8);
    ensureChart('chartDesafio', {
      type: 'pie',
      data: { labels: desPie.labels, datasets: [pieDataset(desPie.data, desPie.labels)] },
      options: PIE_OPTIONS_NO_LEGEND,
    });

    const vendors = Object.keys(countBy(rows, 'VENDEDOR')).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const moneyByVendor = { yes: {}, no: {}, unknown: {} };

    rows.forEach((r) => {
      const v = String(r.VENDEDOR || '').trim() || 'Sem vendedor';
      const m = normalizeMoney(r.MONEY);
      moneyByVendor[m][v] = (moneyByVendor[m][v] || 0) + 1;
    });

    ensureChart('chartMoneyByVendor', {
      type: 'bar',
      data: {
        labels: vendors,
        datasets: [
          { label: 'Sim', data: vendors.map((v) => moneyByVendor.yes[v] || 0), stack: 'money' },
          { label: 'Não', data: vendors.map((v) => moneyByVendor.no[v] || 0), stack: 'money' },
          { label: 'Não informado', data: vendors.map((v) => moneyByVendor.unknown[v] || 0), stack: 'money' },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } },
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
      },
    });

    const topAreas = topNFromCounts(countBy(rows, 'AREA'), 6).map(([k]) => k);
    const areaByVendor = {};

    rows.forEach((r) => {
      const v = String(r.VENDEDOR || '').trim() || 'Sem vendedor';
      const a = String(r.AREA || '').trim() || 'Não informado';
      const key = topAreas.includes(a) ? a : 'Outros';
      areaByVendor[key] = areaByVendor[key] || {};
      areaByVendor[key][v] = (areaByVendor[key][v] || 0) + 1;
    });

    const areaStacks = [...topAreas, 'Outros'];

    ensureChart('chartAreaByVendor', {
      type: 'bar',
      data: {
        labels: vendors,
        datasets: areaStacks.map((a) => ({
          label: a,
          data: vendors.map((v) => areaByVendor[a]?.[v] || 0),
          stack: 'area',
        })),
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } },
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
      },
    });

    const topAreas2 = topNFromCounts(countBy(rows, 'AREA'), 10).map(([k]) => k);
    const topSistemas = topNFromCounts(countBy(rows, 'SISTEMA'), 6).map(([k]) => k);
    const sysByArea = {};

    rows.forEach((r) => {
      const a = String(r.AREA || '').trim() || 'Não informado';
      if (!topAreas2.includes(a)) return;

      const s = String(r.SISTEMA || '').trim() || 'Não informado';
      const key = topSistemas.includes(s) ? s : 'Outros';

      sysByArea[key] = sysByArea[key] || {};
      sysByArea[key][a] = (sysByArea[key][a] || 0) + 1;
    });

    const sysStacks = [...topSistemas, 'Outros'];

    ensureChart('chartSistemaByArea', {
      type: 'bar',
      data: {
        labels: topAreas2,
        datasets: sysStacks.map((s) => ({
          label: s,
          data: topAreas2.map((a) => sysByArea[s]?.[a] || 0),
          stack: 'sys',
        })),
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } },
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
      },
    });

    const topDesafios = topNFromCounts(countBy(rows, 'DESAFIO'), 6).map(([k]) => k);
    const desByArea = {};

    rows.forEach((r) => {
      const a = String(r.AREA || '').trim() || 'Não informado';
      if (!topAreas2.includes(a)) return;

      const d = String(r.DESAFIO || '').trim() || 'Não informado';
      const key = topDesafios.includes(d) ? d : 'Outros';

      desByArea[key] = desByArea[key] || {};
      desByArea[key][a] = (desByArea[key][a] || 0) + 1;
    });

    const desStacks = [...topDesafios, 'Outros'];

    ensureChart('chartDesafioByArea', {
      type: 'bar',
      data: {
        labels: topAreas2,
        datasets: desStacks.map((d) => ({
          label: d,
          data: topAreas2.map((a) => desByArea[d]?.[a] || 0),
          stack: 'des',
        })),
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } },
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
      },
    });
  }

  function cssVar(name, fallback = "") {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function getLegendColor() {
    const theme = document.documentElement.getAttribute("data-theme");
    return theme === "dark" ? "#fff" : "#000";
  }

  function applyThemeToChart(chart) {

    const opts = chart?.options || chart?.config?.options;
    if (!opts) return;

    const legendColor = getLegendColor();
    const tickColor = cssVar("--color-text-secondary", legendColor);
    const gridColor = cssVar("--color-border", "rgba(0,0,0,.1)");

    opts.plugins = opts.plugins || {};
    opts.plugins.legend = opts.plugins.legend || {};
    opts.plugins.legend.labels = opts.plugins.legend.labels || {};
    opts.plugins.legend.labels.color = legendColor;

    if (opts.scales) {
      Object.values(opts.scales).forEach((axis) => {
        axis.ticks = axis.ticks || {};
        axis.grid = axis.grid || {};
        axis.ticks.color = tickColor;
        axis.grid.color = gridColor;
      });
    }

    chart.update("none");
  }

  function registerChartThemeSync(getCharts) {
    const applyAll = () => {
      const charts = typeof getCharts === "function" ? getCharts() : [];
      (charts || []).forEach(applyThemeToChart);
    };

    applyAll();

    const obs = new MutationObserver(applyAll);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  }

  registerChartThemeSync(() => Object.values(state.charts));

  async function loadData() {
    const entryStart = elements.entryStartInput?.value || '';
    const entryEnd = elements.entryEndInput?.value || '';

    if (!entryStart || !entryEnd) {
      ui.showError('Selecione o período de entrega');
      return;
    }

    ui.showLoading();
    if (elements.recordsBody) elements.recordsBody.innerHTML = ui.renderSkeletonRows(10, 13);

    try {
      const res = await api.fetchRows({ entry_start: entryStart, entry_end: entryEnd });
      const rows = extractRows(res).map(normalizeRow);

      state.rows = rows;
      state.vendorCounts = computeVendorCounts(rows);

      const vendors = getVendorsFromCounts(state.vendorCounts);
      render.vendorSelectOptions(vendors, true);

      setOptions(elements.areaSelect, uniqueSorted(rows, 'AREA'), { keepSelected: true, includeNotInformed: true });
      setOptions(elements.timeSelect, uniqueSorted(rows, 'TIME'), { keepSelected: true, includeNotInformed: true });
      setOptions(elements.sistemaSelect, uniqueSorted(rows, 'SISTEMA'), { keepSelected: true, includeNotInformed: true });
      setOptions(elements.desafioSelect, uniqueSorted(rows, 'DESAFIO'), { keepSelected: true, includeNotInformed: true });

      applyAllFiltersAndRender({ resetPage: true });
    } catch (e) {
      ui.showError(`Failed to load leads: ${e.message}`);
      if (elements.recordsBody) elements.recordsBody.innerHTML = ui.renderEmptyState('Erro ao carregar', 13);

    } finally {
      ui.hideLoading();
    }
  }

  function initializeDates() {
    const today = utils.today();
    if (elements.entryStartInput) elements.entryStartInput.value = today;
    if (elements.entryEndInput) elements.entryEndInput.value = today;
  }

  function setupEventListeners() {
    if (elements.closeToast) elements.closeToast.addEventListener('click', () => ui.hideError());

    if (elements.applyFilters) elements.applyFilters.addEventListener('click', loadData);

    if (elements.vendorSelect) {
      elements.vendorSelect.addEventListener('change', () => applyAllFiltersAndRender({ resetPage: true }));
    }

    if (elements.clearVendor) {
      elements.clearVendor.addEventListener('click', () => {
        if (elements.vendorSelect) elements.vendorSelect.value = '';
        applyAllFiltersAndRender({ resetPage: true });
      });
    }

    const onAnyFilterChange = () => applyAllFiltersAndRender({ resetPage: true });

    [elements.moneySelect, elements.areaSelect, elements.timeSelect, elements.sistemaSelect, elements.stageSelect, elements.desafioSelect]
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

    if (elements.presetNextDay) {
      elements.presetNextDay.addEventListener('click', applyNextDay);
    }

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

    if (elements.presetPrevDay) {
      elements.presetPrevDay.addEventListener('click', applyPreviousDay);
    }

    if (elements.preset7) elements.preset7.addEventListener('click', () => applyPresetDays(7));
    if (elements.preset14) elements.preset14.addEventListener('click', () => applyPresetDays(14));
    if (elements.preset30) elements.preset30.addEventListener('click', () => applyPresetDays(30));

    if (elements.clearAllFilters) {
      elements.clearAllFilters.addEventListener('click', () => {
        if (elements.vendorSelect) elements.vendorSelect.value = '';
        if (elements.moneySelect) elements.moneySelect.value = '';
        if (elements.stageSelect) elements.stageSelect.value = 'presentation';
        if (elements.globalSearch) elements.globalSearch.value = '';

        [elements.areaSelect, elements.timeSelect, elements.sistemaSelect, elements.desafioSelect]
          .filter(Boolean)
          .forEach((sel) => Array.from(sel.options).forEach((o) => (o.selected = false)));

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
        state.pagination.pageSize = Number(elements.recordsPageSize.value) || 25;
        state.pagination.page = 1;
        applyAllFiltersAndRender();
      });
    }

    document.querySelectorAll('.data-table--records th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;

        state.sort.direction =
          (state.sort.key === key && state.sort.direction === 'desc') ? 'asc' : 'desc';
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
