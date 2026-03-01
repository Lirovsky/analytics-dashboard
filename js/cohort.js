(() => {
  const page = document.documentElement.getAttribute('data-page');
  if (page !== 'cohort') return;

  const CONFIG = {
    // Cole aqui o webhook que você vai enviar
    COHORT_ENDPOINT: 'https://n8n.clinicaexperts.com.br/webhook/cohort',
  };

  const MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

  // Limite visual: até M+12 (remove M+13 e M+14)
  const MAX_M_OFFSET = 12;

  const utils = {
    pad2(n) {
      return String(n).padStart(2, '0');
    },
    getDateString(date) {
      const y = date.getFullYear();
      const m = this.pad2(date.getMonth() + 1);
      const d = this.pad2(date.getDate());
      return `${y}-${m}-${d}`;
    },
    today() {
      return this.getDateString(new Date());
    },
    parseDateTime(value) {
      if (!value) return null;
      const s = String(value).trim();
      if (!s) return null;

      // ISO com T
      if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
        const d = new Date(s);
        return isNaN(d) ? null : d;
      }

      // "YYYY-MM-DD HH:MM:SS"
      if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/.test(s)) {
        const d = new Date(s.replace(' ', 'T'));
        return isNaN(d) ? null : d;
      }

      // "YYYY-MM-DD"
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const d = new Date(`${s}T00:00:00`);
        return isNaN(d) ? null : d;
      }

      // "YYYY/MM/DD"
      if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) {
        const [y, m, d] = s.split('/');
        const dt = new Date(`${y}-${m}-${d}T00:00:00`);
        return isNaN(dt) ? null : dt;
      }

      const d = new Date(s);
      return isNaN(d) ? null : d;
    },
    monthKeyFromDate(d) {
      if (!d) return null;
      return `${d.getFullYear()}-${this.pad2(d.getMonth() + 1)}`;
    },
    monthIndexFromKey(key) {
      const [y, m] = String(key || '').split('-');
      const yy = Number(y);
      const mm = Number(m);
      if (!yy || !mm) return null;
      return yy * 12 + (mm - 1);
    },
    monthsDiff(entryKey, purchaseKey) {
      const a = this.monthIndexFromKey(entryKey);
      const b = this.monthIndexFromKey(purchaseKey);
      if (a == null || b == null) return null;
      return b - a;
    },
    firstDayOfMonth(d) {
      return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
    },
    lastDayOfMonth(d) {
      return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
    },
    monthLabelFromKey(key) {
      const [y, m] = String(key || '').split('-');
      const yy = Number(y);
      const mm = Number(m);
      if (!yy || !mm) return String(key || '–');
      return `${MONTHS_PT[mm - 1]}/${yy}`;
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
    pct(part, total, digits = 0) {
      if (!total) return null;
      const v = (part / total) * 100;
      return digits > 0 ? v.toFixed(digits) : String(Math.round(v));
    },
  };

  const dom = { byId: (id) => document.getElementById(id) };

  const elements = {
    entryStartInput: dom.byId('entryStartDate'),
    entryEndInput: dom.byId('entryEndDate'),

    presetAll: dom.byId('presetAll'),
    preset12m: dom.byId('preset12m'),
    presetYtd: dom.byId('presetYtd'),

    applyFilters: dom.byId('applyFilters'),
    clearAllFilters: dom.byId('clearAllFilters'),

    thead: dom.byId('cohortHead'),
    tbody: dom.byId('cohortBody'),
    tfoot: dom.byId('cohortFoot'),

    metaPeriod: dom.byId('metaPeriod'),
    metaEntries: dom.byId('metaEntries'),
    metaPurchases: dom.byId('metaPurchases'),
    metaUpdated: dom.byId('metaUpdated'),

    loadingOverlay: dom.byId('loadingOverlay'),
    errorToast: dom.byId('errorToast'),
    errorMessage: dom.byId('errorMessage'),
    closeToast: dom.byId('closeToast'),

    cohortTable: dom.byId('cohortTable'),
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
    renderEmptyRow(message = 'Sem dados') {
      return `<tr><td colspan="99" style="padding:24px;color:#94a3b8;text-align:center;">${utils.escapeHtml(message)}</td></tr>`;
    },
  };

  const state = {
    raw: [],
    normalized: [],
    filtered: [],
    cohort: null,
  };

  function getField(obj, keys) {
    for (const k of keys) {
      if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
    }
    return null;
  }

  function normalizeRow(v) {
    const entryIso = getField(v, ['created_at', 'createdAt', 'entry_date', 'entryDate']);
    const purchasedIso = getField(v, ['purchased_at', 'purchasedAt', 'purchase_date', 'purchaseDate']);

    const managerNameRaw = getField(v, ['manager', 'manager_name', 'managerName']);
    const managerName = String(managerNameRaw ?? '').trim();
    const rawManagerId = getField(v, ['manager_id', 'managerId']);

    let manager = '—';
    if (managerName) manager = managerName;
    else {
      const maybeNum = Number(rawManagerId);
      if (!Number.isNaN(maybeNum) && maybeNum > 0) manager = String(maybeNum);
      else {
        const maybeName = String(rawManagerId ?? '').trim();
        manager = maybeName || '—';
      }
    }

    return {
      entry_date: entryIso ? String(entryIso) : null,
      purchased_at: purchasedIso ? String(purchasedIso) : null,
      manager,
    };
  }

  function uniqueSorted(rows, key) {
    const set = new Set();
    rows.forEach((r) => {
      const v = String(r?.[key] ?? '').trim();
      if (v && v !== '—' && v !== '–') set.add(v);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }

  function setOptions(selectEl, values, { keepSelected = true } = {}) {
    if (!selectEl) return;

    const current = keepSelected ? new Set(Array.from(selectEl.selectedOptions || []).map((o) => o.value)) : new Set();

    const optionsHtml = ['<option value="">Todos</option>'];
    (values || []).forEach((v) => {
      optionsHtml.push(`<option value="${utils.escapeHtml(v)}">${utils.escapeHtml(v)}</option>`);
    });

    selectEl.innerHTML = optionsHtml.join('');

    if (keepSelected && current.size) {
      Array.from(selectEl.options).forEach((o) => {
        if (current.has(o.value)) o.selected = true;
      });
    }
  }

  function applyClientFilters() {
    const startStr = elements.entryStartInput?.value || '';
    const endStr = elements.entryEndInput?.value || '';

    const startD = utils.parseDateTime(startStr) || new Date('2025-01-01T00:00:00');
    const endD = utils.parseDateTime(endStr) || new Date();

    // garante ordem
    const start = startD <= endD ? startD : endD;
    const end = startD <= endD ? endD : startD;

    const endClamp = new Date(end.getTime());
    endClamp.setHours(23, 59, 59, 999);

    let out = [...state.normalized];

    // filtro por intervalo de entrada
    out = out.filter((r) => {
      const d = utils.parseDateTime(r.entry_date);
      if (!d) return false;
      return d >= start && d <= endClamp;
    });

    state.filtered = out;

    // build cohort usando os meses do range selecionado, mas com limite inferior em Jan/2025
    const hardStart = utils.parseDateTime('2025-01-01') || new Date('2025-01-01T00:00:00');
    const rangeStart = start < hardStart ? hardStart : start;

    state.cohort = buildCohort(state.filtered, rangeStart, endClamp);

    render(state.cohort, rangeStart, endClamp);
  }

  function buildMonthList(startDate, endDate) {
    const start = utils.firstDayOfMonth(startDate);
    const end = utils.firstDayOfMonth(endDate);

    const months = [];
    const cur = new Date(start.getTime());
    while (cur <= end) {
      months.push(utils.monthKeyFromDate(cur));
      cur.setMonth(cur.getMonth() + 1);
    }
    return months;
  }

  function buildCohort(rows, startDate, endDate) {
    const months = buildMonthList(startDate, endDate);
    const monthToRow = new Map(months.map((k, i) => [k, i]));

    const startKey = months[0] || utils.monthKeyFromDate(startDate);
    const endKey = months[months.length - 1] || utils.monthKeyFromDate(endDate);
    const computedMaxOffset = Math.max(0, utils.monthsDiff(startKey, endKey) ?? 0);
    const maxOffset = Math.min(computedMaxOffset, MAX_M_OFFSET);

    const entries = Array(months.length).fill(0);
    const matrix = Array.from({ length: months.length }, () => Array(maxOffset + 1).fill(0));

    const endMonthLast = utils.lastDayOfMonth(endDate);

    rows.forEach((r) => {
      const entryD = utils.parseDateTime(r.entry_date);
      if (!entryD) return;

      if (entryD < startDate || entryD > endMonthLast) return;

      const entryKey = utils.monthKeyFromDate(entryD);
      const rowIdx = monthToRow.get(entryKey);
      if (rowIdx == null) return;

      entries[rowIdx] += 1;

      const purchaseD = utils.parseDateTime(r.purchased_at);
      if (!purchaseD) return;

      // corta compras fora do range (acima do mês final)
      if (purchaseD > endMonthLast) return;

      const purchaseKey = utils.monthKeyFromDate(purchaseD);
      const offset = utils.monthsDiff(entryKey, purchaseKey);
      if (offset == null || offset < 0 || offset > maxOffset) return;

      matrix[rowIdx][offset] += 1;
    });

    return { months, entries, matrix, maxOffset };
  }

  function sum(arr) {
    return (arr || []).reduce((acc, v) => acc + (Number(v) || 0), 0);
  }

  function render(cohort, startDate, endDate) {
    if (!cohort || !elements.thead || !elements.tbody || !elements.cohortTable) return;

    const { months, entries, matrix, maxOffset } = cohort;

    elements.cohortTable.style.setProperty('--cohort-cols', String(maxOffset + 1));

    // header
    const headCells = [];
    headCells.push('<th class="sticky-col-1" title="Mês de entrada (created_at)">Cohort</th>');
    headCells.push('<th class="sticky-col-2" title="Quantidade de registros que entraram no mês">Entradas</th>');
    for (let i = 0; i <= maxOffset; i += 1) {
      headCells.push(`<th title="Compras no M+${i} (purchased_at)"><span style="opacity:.65">M+</span>${i}</th>`);
    }
    headCells.push('<th class="sticky-col-total" title="Total de compras na linha">Total</th>');
    headCells.push('<th class="sticky-col-conv" title="Total / Entradas">Conv.</th>');

    elements.thead.innerHTML = `<tr>${headCells.join('')}</tr>`;

    // global max p/ heatmap
    let globalMax = 0;
    matrix.forEach((row) => row.forEach((v) => { if ((Number(v) || 0) > globalMax) globalMax = Number(v) || 0; }));

    // body
    if (!months.length) {
      elements.tbody.innerHTML = ui.renderEmptyRow('Sem dados no período.');
      if (elements.tfoot) elements.tfoot.innerHTML = '';
      updateMeta(0, 0, startDate, endDate);
      return;
    }

    const bodyHtml = [];
    const colTotals = Array(maxOffset + 1).fill(0);
    let totalEntries = 0;
    let totalPurchases = 0;

    months.forEach((monthKey, rowIdx) => {
      const rowEntries = Number(entries[rowIdx] || 0);
      const rowCells = matrix[rowIdx] || [];
      const rowPurchases = sum(rowCells);
      const conv = utils.pct(rowPurchases, rowEntries, 1);

      totalEntries += rowEntries;
      totalPurchases += rowPurchases;

      rowCells.forEach((v, i) => { colTotals[i] += Number(v) || 0; });

      const cellsHtml = rowCells.map((v) => {
        const n = Number(v) || 0;
        const heat = globalMax ? (n / globalMax) : 0;
        const cls = n > 0 ? 'cohort-cell has-value' : 'cohort-cell is-zero';
        return `<td class="${cls}" style="--heat:${heat.toFixed(4)}">${n}</td>`;
      });

      bodyHtml.push(`
        <tr>
          <td class="sticky-col-1"><strong>${utils.escapeHtml(utils.monthLabelFromKey(monthKey))}</strong></td>
          <td class="sticky-col-2">${rowEntries}</td>
          ${cellsHtml.join('')}
          <td class="sticky-col-total">${rowPurchases}</td>
          <td class="sticky-col-conv">${conv == null ? '—' : `${conv}%`}</td>
        </tr>
      `);
    });

    elements.tbody.innerHTML = bodyHtml.join('');

    // footer (totais)
    if (elements.tfoot) {
      const footerCells = [];
      footerCells.push('<th class="sticky-col-1">Total</th>');
      footerCells.push(`<th class="sticky-col-2">${totalEntries}</th>`);
      for (let i = 0; i <= maxOffset; i += 1) {
        footerCells.push(`<td>${Number(colTotals[i] || 0)}</td>`);
      }
      const convTotal = utils.pct(totalPurchases, totalEntries, 1);
      footerCells.push(`<td class="sticky-col-total">${totalPurchases}</td>`);
      footerCells.push(`<td class="sticky-col-conv">${convTotal == null ? '—' : `${convTotal}%`}</td>`);
      elements.tfoot.innerHTML = `<tr>${footerCells.join('')}</tr>`;
    }

    updateMeta(totalEntries, totalPurchases, startDate, endDate);
  }

  function updateMeta(totalEntries, totalPurchases, startDate, endDate) {
    if (elements.metaPeriod) {
      const s = utils.getDateString(startDate);
      const e = utils.getDateString(endDate);
      elements.metaPeriod.textContent = `${s} → ${e}`;
    }
    if (elements.metaEntries) elements.metaEntries.textContent = String(totalEntries ?? 0);
    if (elements.metaPurchases) elements.metaPurchases.textContent = String(totalPurchases ?? 0);
    if (elements.metaUpdated) {
      const now = new Date();
      const hh = utils.pad2(now.getHours());
      const mm = utils.pad2(now.getMinutes());
      elements.metaUpdated.textContent = `${hh}:${mm}`;
    }
  }

  async function loadData() {
    if (!CONFIG.COHORT_ENDPOINT || CONFIG.COHORT_ENDPOINT.includes('COLE_SEU_WEBHOOK_AQUI')) {
      ui.showError('Cole o webhook em CONFIG.COHORT_ENDPOINT (cohort.js) antes de carregar.');
      return;
    }

    const params = {
      entry_start: elements.entryStartInput?.value || '',
      entry_end: elements.entryEndInput?.value || '',
      _ts: Date.now(),
    };

    ui.showLoading();

    try {
      const url = `${CONFIG.COHORT_ENDPOINT}?${new URLSearchParams(params)}`;
      const response = await fetch(url, { cache: 'no-store' });
      const rawText = await response.text();

      if (!response.ok) {
        const snippet = rawText ? rawText.slice(0, 220) : '';
        throw new Error(`HTTP ${response.status}${snippet ? ` — ${snippet}` : ''}`);
      }

      const text = (rawText || '').trim();
      const data = text ? JSON.parse(text) : [];

      const root = Array.isArray(data) ? (data[0] ?? {}) : (data ?? {});
      const vendas = Array.isArray(root?.vendas) ? root.vendas : (Array.isArray(root?.sales) ? root.sales : []);

      state.raw = vendas;
      state.normalized = vendas.map(normalizeRow);

      applyClientFilters();
    } catch (e) {
      ui.showError(`Erro: ${e.message}`);
      state.raw = [];
      state.normalized = [];
      state.filtered = [];
      state.cohort = null;
      if (elements.tbody) elements.tbody.innerHTML = ui.renderEmptyRow('Erro ao carregar dados.');
      if (elements.tfoot) elements.tfoot.innerHTML = '';
      updateMeta(0, 0, new Date('2025-01-01T00:00:00'), new Date());
    } finally {
      ui.hideLoading();
    }
  }

  function init() {
    // defaults: Jan/2025 → Hoje (como você descreveu)
    const today = new Date();
    const hardStart = new Date('2025-01-01T00:00:00');

    if (elements.entryStartInput) elements.entryStartInput.value = utils.getDateString(hardStart);
    if (elements.entryEndInput) elements.entryEndInput.value = utils.getDateString(today);

    if (elements.applyFilters) elements.applyFilters.addEventListener('click', loadData);

    if (elements.clearAllFilters) {
      elements.clearAllFilters.addEventListener('click', () => {
        if (elements.entryStartInput) elements.entryStartInput.value = utils.getDateString(hardStart);
        if (elements.entryEndInput) elements.entryEndInput.value = utils.getDateString(today);
        loadData();
      });
    }

    // Presets
    if (elements.presetAll) {
      elements.presetAll.addEventListener('click', () => {
        if (elements.entryStartInput) elements.entryStartInput.value = utils.getDateString(hardStart);
        if (elements.entryEndInput) elements.entryEndInput.value = utils.getDateString(new Date());
        loadData();
      });
    }

    if (elements.preset12m) {
      elements.preset12m.addEventListener('click', () => {
        const end = new Date();
        const start = new Date(end.getFullYear(), end.getMonth() - 11, 1);
        if (elements.entryStartInput) elements.entryStartInput.value = utils.getDateString(start);
        if (elements.entryEndInput) elements.entryEndInput.value = utils.getDateString(end);
        loadData();
      });
    }

    if (elements.presetYtd) {
      elements.presetYtd.addEventListener('click', () => {
        const end = new Date();
        const start = new Date(end.getFullYear(), 0, 1);
        if (elements.entryStartInput) elements.entryStartInput.value = utils.getDateString(start);
        if (elements.entryEndInput) elements.entryEndInput.value = utils.getDateString(end);
        loadData();
      });
    }

    if (elements.closeToast) elements.closeToast.addEventListener('click', () => ui.hideError());

    loadData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();