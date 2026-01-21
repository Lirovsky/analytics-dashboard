(() => {
  const page = document.documentElement.getAttribute('data-page');
  if (page !== 'leads-vendedor') return;

  // ========================================
  // Configuration
  // ========================================
  const CONFIG = {
    ENDPOINT: 'https://n8n.clinicaexperts.com.br/webhook/leads-vendedor',
  };

  // ========================================
  // Utilities
  // ========================================
  const utils = {
    getDateString(date) {
      return date.toISOString().split('T')[0];
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

      // YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(str + 'T00:00:00');

      // YYYY/MM/DD
      if (/^\d{4}\/\d{2}\/\d{2}$/.test(str)) {
        const [yyyy, mm, dd] = str.split('/');
        return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
      }

      // DD/MM/YYYY
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
  };

  const dom = {
    byId(id) {
      return document.getElementById(id);
    },
  };

  // ========================================
  // DOM Elements
  // ========================================
  const elements = {
    entryStartInput: dom.byId('entryStartDate'),
    entryEndInput: dom.byId('entryEndDate'),
    vendorSelect: dom.byId('vendorSelect'),
    applyFilters: dom.byId('applyFilters'),
    clearVendor: dom.byId('clearVendor'),

    vendorSummary: dom.byId('vendorSummary'),
    rangePill: dom.byId('rangePill'),
    totalPill: dom.byId('totalPill'),
    shownPill: dom.byId('shownPill'),

    recordsBody: dom.byId('recordsBody'),

    loadingOverlay: dom.byId('loadingOverlay'),
    errorToast: dom.byId('errorToast'),
    errorMessage: dom.byId('errorMessage'),
    closeToast: dom.byId('closeToast'),
  };

  // ========================================
  // State
  // ========================================
  const state = {
    rows: [],
    filtered: [],
    vendorCounts: {},
    sort: { key: 'ENTREGUE', direction: 'desc' }, // default: Entregue desc
  };


  // ========================================
  // UI Helpers
  // ========================================
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
    renderSkeletonRows(count = 10, cols = 5) {
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
    renderEmptyState(message = 'Sem dados', colspan = 5) {
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

  // ========================================
  // API
  // ========================================
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
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    },
  };

  // ========================================
  // Normalização do payload (n8n pode devolver array direto)
  // ========================================
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

    return {
      row_number: rowNumber,
      ID: id,
      ENTRADA: entrada,
      ENTREGUE: entregue,
      // compat: antes a UI usava "DATA" como coluna de data
      DATA: entregue,
      VENDEDOR: vendedor,
      PHONE: phone,
      LINK: link,
    };
  }

  // ========================================
  // Render
  // ========================================
  const render = {
    setMetaPills({ entryStart, entryEnd, total, shown }) {
      if (elements.totalPill) {
        elements.totalPill.textContent = `Total: ${total ?? '—'}`;
      }
      if (elements.shownPill) {
        elements.shownPill.textContent = `Mostrando: ${shown ?? '—'}`;
      }
    },

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

    vendorSummary(counts, activeVendor) {
      if (!elements.vendorSummary) return;

      const entries = Object.entries(counts || {})
        .sort((a, b) => b[1] - a[1])
        .map(([vendor, count]) => {
          const isActive = activeVendor && vendor === activeVendor;
          return `
            <div class="vendor-card ${isActive ? 'is-active' : ''}" data-vendor="${utils.escapeHtml(vendor)}" role="button" tabindex="0">
              <div class="vendor-card__name">${utils.escapeHtml(vendor)}</div>
              <div class="vendor-card__count">${utils.escapeHtml(count)}</div>
            </div>
          `;
        })
        .join('');

      elements.vendorSummary.innerHTML = entries || '<div class="empty-state" style="width:100%"><p>Sem vendedores no período</p></div>';
    },

    recordsTable(rows) {
      if (!elements.recordsBody) return;

      if (!rows || rows.length === 0) {
        elements.recordsBody.innerHTML = ui.renderEmptyState('Sem registros no filtro selecionado', 5);
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
            ? `<a class="link mono truncate" href="${utils.escapeHtml(link)}" target="_blank" rel="noopener">${utils.escapeHtml(link)}</a>`
            : '<span class="mono">—</span>';

          return `
            <tr>
              <td>${entryDate}</td>
              <td>${deliveredDate}</td>
              <td>${vendor}</td>
              <td class="mono">${phone}</td>
              <td>${linkCell}</td>
            </tr>
          `;
        })
        .join('');

      elements.recordsBody.innerHTML = html;
    },
  };

  // ========================================
  // Filtering + Counters
  // ========================================
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

  function applyVendorFilterAndRender() {
    const selectedVendor = (elements.vendorSelect?.value || '').trim();

    state.filtered = selectedVendor
      ? state.rows.filter((r) => String(r.VENDEDOR || '').trim() === selectedVendor)
      : [...state.rows];

    const entryStart = elements.entryStartInput?.value || '';
    const entryEnd = elements.entryEndInput?.value || '';

    render.setMetaPills({
      entryStart,
      entryEnd,
      total: state.rows.length,
      shown: state.filtered.length,
    });

    render.vendorSummary(state.vendorCounts, selectedVendor || null);

    const sorted = sortRows(state.filtered);
    render.recordsTable(sorted);

  }

  function sortRows(items) {
    const { key, direction } = state.sort;
    const dir = direction === 'asc' ? 1 : -1;

    const asText = (v) => String(v ?? '').toLowerCase();

    // Datas: ordenar por data real (aceita DD/MM/YYYY, YYYY-MM-DD, etc.)
    if (key === 'ENTRADA' || key === 'ENTREGUE' || key === 'DATA') {
      return [...items].sort((a, b) => {
        const aTime = utils.parseAnyDate(a?.[key])?.getTime?.() || 0;
        const bTime = utils.parseAnyDate(b?.[key])?.getTime?.() || 0;
        return (aTime - bTime) * dir;
      });
    }

    // Outros campos: texto
    return [...items].sort((a, b) => {
      return asText(a?.[key]).localeCompare(asText(b?.[key]), 'pt-BR') * dir;
    });
  }


  // ========================================
  // Data loader
  // ========================================
  async function loadData() {
    const entryStart = elements.entryStartInput?.value || '';
    const entryEnd = elements.entryEndInput?.value || '';

    if (!entryStart || !entryEnd) {
      ui.showError('Selecione as datas de entrada');
      return;
    }

    ui.showLoading();
    if (elements.recordsBody) elements.recordsBody.innerHTML = ui.renderSkeletonRows(10, 5);

    try {
      const res = await api.fetchRows({ entry_start: entryStart, entry_end: entryEnd });
      const rows = extractRows(res).map(normalizeRow);

      state.rows = rows;
      state.vendorCounts = computeVendorCounts(rows);

      const vendors = getVendorsFromCounts(state.vendorCounts);
      render.vendorSelectOptions(vendors, true);

      applyVendorFilterAndRender();
    } catch (e) {
      ui.showError(`Failed to load leads: ${e.message}`);
      if (elements.recordsBody) elements.recordsBody.innerHTML = ui.renderEmptyState('Erro ao carregar', 5);
      if (elements.vendorSummary) elements.vendorSummary.innerHTML = '<div class="empty-state"><p>Erro ao carregar</p></div>';

      render.setMetaPills({ entryStart, entryEnd, total: '—', shown: '—' });
    } finally {
      ui.hideLoading();
    }
  }

  // ========================================
  // Dates
  // ========================================
  function initializeDates() {
    const today = utils.today();
    if (elements.entryStartInput) elements.entryStartInput.value = today;
    if (elements.entryEndInput) elements.entryEndInput.value = today;
  }

  // ========================================
  // Events
  // ========================================
  function setupEventListeners() {
    if (elements.closeToast) elements.closeToast.addEventListener('click', () => ui.hideError());

    if (elements.applyFilters) elements.applyFilters.addEventListener('click', loadData);

    if (elements.vendorSelect) {
      elements.vendorSelect.addEventListener('change', applyVendorFilterAndRender);
    }

    if (elements.clearVendor) {
      elements.clearVendor.addEventListener('click', () => {
        if (elements.vendorSelect) elements.vendorSelect.value = '';
        applyVendorFilterAndRender();
      });
    }

    // Clique nos cards (contador por vendedor)
    if (elements.vendorSummary) {
      const onPick = (target) => {
        const el = target?.closest?.('[data-vendor]');
        if (!el) return;
        const vendor = el.getAttribute('data-vendor') || '';
        if (elements.vendorSelect) elements.vendorSelect.value = vendor;
        applyVendorFilterAndRender();
      };

      elements.vendorSummary.addEventListener('click', (e) => onPick(e.target));

      elements.vendorSummary.addEventListener('keypress', (e) => {
        if (e.key !== 'Enter') return;
        onPick(e.target);
      });
    }

    const onEnter = (e) => {
      if (e.key !== 'Enter') return;
      loadData();
    };

    if (elements.entryStartInput) elements.entryStartInput.addEventListener('keypress', onEnter);
    if (elements.entryEndInput) elements.entryEndInput.addEventListener('keypress', onEnter);

    // Ordenação (clique no header)
    document.querySelectorAll('.data-table--records th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;

        state.sort.direction =
          (state.sort.key === key && state.sort.direction === 'desc') ? 'asc' : 'desc';
        state.sort.key = key;

        document.querySelectorAll('.data-table--records th[data-sort]').forEach((x) => x.classList.remove('active'));
        th.classList.add('active');

        applyVendorFilterAndRender();
      });
    });

    // Header ativo default
    const defaultTh = document.querySelector('.data-table--records th[data-sort="ENTREGUE"]');
    defaultTh?.classList.add('active');

  }

  // ========================================
  // Init
  // ========================================
  function init() {
    initializeDates();
    setupEventListeners();

    // Render inicial dos pills
    render.setMetaPills({
      entryStart: elements.entryStartInput?.value || '',
      entryEnd: elements.entryEndInput?.value || '',
      total: 0,
      shown: 0,
    });

    loadData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
