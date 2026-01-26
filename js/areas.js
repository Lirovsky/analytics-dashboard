(() => {
  const page = document.documentElement.getAttribute('data-page');
  if (page !== 'areas') return;

  // ========================================
  // Configuration
  // ========================================
  const CONFIG = {
    AREAS_ENDPOINT: 'https://n8n.clinicaexperts.com.br/webhook/areas',
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
    formatNumber(value) {
      if (value === null || value === undefined || isNaN(value)) return '–';
      return new Intl.NumberFormat('pt-BR').format(Number(value));
    },
    formatPercentage(value) {
      if (value === null || value === undefined || isNaN(value)) return '–';
      return `${Number(value).toFixed(2)}%`;
    },
  };

  const dom = {
    byId(id) {
      return document.getElementById(id);
    },
  };

  // ========================================
  // DOM Elements (somente Areas)
  // ========================================
  const elements = {
    // Entrada
    entryStartInput: dom.byId('entryStartDate'),
    entryEndInput: dom.byId('entryEndDate'),

    // Buttons
    applyEntryOnly: dom.byId('applyEntryOnly'),
    clearEntryDates: dom.byId('clearEntryDates'),

    // Tabelas
    areasBody: dom.byId('areasBody'),
    teamsBody: dom.byId('teamsBody'),
    systemsBody: dom.byId('systemsBody'),
    challengesBody: dom.byId('challengesBody'),
    moneyBody: dom.byId('moneyBody'),

    // Paginação (somente Área e Sistema)
    areasPagination: dom.byId('areasPagination'),
    systemsPagination: dom.byId('systemsPagination'),

    // UI
    loadingOverlay: dom.byId('loadingOverlay'),
    errorToast: dom.byId('errorToast'),
    errorMessage: dom.byId('errorMessage'),
    closeToast: dom.byId('closeToast'),
  };

  // ========================================
  // State
  // ========================================
  const state = {
    areasData: null,
    areasSort: {
      areas: { key: 'leads', direction: 'desc' },
      teams: { key: 'leads', direction: 'desc' },
      systems: { key: 'leads', direction: 'desc' },
      challenges: { key: 'leads', direction: 'desc' },
      money: { key: 'leads', direction: 'desc' },
    },
    pagination: {
      areas: { page: 1, perPage: 10 },
      systems: { page: 1, perPage: 10 },
    },
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
    renderSkeleton(count = 6, colspan = 3) {
      return Array(count)
        .fill(0)
        .map(
          () =>
            `<tr><td colspan="${colspan}"><div class="skeleton" style="width:100%;height:20px;"></div></td></tr>`
        )
        .join('');
    },
    renderEmptyState(message = 'Sem dados', colspan = 3) {
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
  // ========================================
  // Pagination (somente Área e Sistema)
  // ========================================
  const paginationUI = {
    getContainer(key) {
      if (key === 'areas') return elements.areasPagination;
      if (key === 'systems') return elements.systemsPagination;
      return null;
    },

    clear(key) {
      const el = this.getContainer(key);
      if (!el) return;
      el.innerHTML = '';
      el.dataset.totalItems = '0';
      // Mantém o listener (dataset.bound) para evitar múltiplos binds
    },

    clamp(key, totalItems) {
      const st = state.pagination?.[key] || { page: 1, perPage: 10 };

      const perPage = Math.min(10, Math.max(1, Number(st.perPage) || 10));
      const total = Math.max(0, Number(totalItems) || 0);
      const totalPages = Math.max(1, Math.ceil(total / perPage));

      let page = Number(st.page) || 1;
      if (page < 1) page = 1;
      if (page > totalPages) page = totalPages;

      st.page = page;
      st.perPage = perPage;
      state.pagination[key] = st;

      return { page, perPage, totalPages };
    },

    pageList(page, totalPages) {
      if (totalPages <= 7) {
        return Array.from({ length: totalPages }, (_, i) => i + 1);
      }

      const list = [1];
      const start = Math.max(2, page - 1);
      const end = Math.min(totalPages - 1, page + 1);

      if (start > 2) list.push('…');
      for (let p = start; p <= end; p++) list.push(p);
      if (end < totalPages - 1) list.push('…');

      list.push(totalPages);
      return list;
    },

    rerender(key) {
      if (!state.areasData) return;
      if (key === 'areas') areasRender.table(state.areasData);
      if (key === 'systems') systemsRender.table(state.areasData);
    },

    render(key, totalItems) {
      const el = this.getContainer(key);
      if (!el) return;

      // Guarda o total atual no dataset (usado no click handler)
      el.dataset.totalItems = String(Number(totalItems) || 0);

      const total = Number(totalItems) || 0;
      const { page, perPage, totalPages } = this.clamp(key, total);

      if (total <= 0) {
        el.innerHTML = '';
        return;
      }

      // Aplica o mesmo estilo de paginação usado em outras páginas (metrics)
      el.classList.add('pagination');

      const prevDisabled = page <= 1;
      const nextDisabled = page >= totalPages;

      el.innerHTML = `
        <button class="pg-btn" data-page="prev" ${prevDisabled ? 'disabled' : ''} aria-label="Página anterior">‹</button>
        <span class="pg-info">${page} / ${totalPages}</span>
        <button class="pg-btn" data-page="next" ${nextDisabled ? 'disabled' : ''} aria-label="Próxima página">›</button>
        <span class="pg-sep" aria-hidden="true"></span>
        <span class="pg-label">Linhas</span>
        <select class="pg-size" data-role="perPage" aria-label="Linhas por página">
          <option value="10" ${perPage === 10 ? 'selected' : ''}>10</option>
        </select>
      `;

      if (el.dataset.bound === '1') return;
      el.dataset.bound = '1';

      el.addEventListener('click', (e) => {
        const btn = e.target?.closest?.('button[data-page]');
        if (!btn || btn.disabled) return;

        const value = btn.getAttribute('data-page');
        const st = state.pagination?.[key];
        if (!st) return;

        const totalNow = Number(el.dataset.totalItems) || 0;
        const per = Math.min(10, Math.max(1, Number(st.perPage) || 10));
        const totalPagesNow = Math.max(1, Math.ceil(totalNow / per));

        if (value === 'prev') st.page = Math.max(1, (Number(st.page) || 1) - 1);
        else if (value === 'next') st.page = Math.min(totalPagesNow, (Number(st.page) || 1) + 1);

        state.pagination[key] = st;
        this.rerender(key);
      });

      el.addEventListener('change', (e) => {
        const sel = e.target?.closest?.('select[data-role="perPage"]');
        if (!sel) return;

        const st = state.pagination?.[key];
        if (!st) return;

        const v = Math.min(10, Math.max(1, Number(sel.value) || 10));
        st.perPage = v;
        st.page = 1;
        state.pagination[key] = st;

        this.rerender(key);
      });
    },


    reset(keys = []) {
      keys.forEach((k) => {
        if (!state.pagination?.[k]) state.pagination[k] = { page: 1, perPage: 10 };
        state.pagination[k].page = 1;
      });
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

    async fetchAreas(paramsObj) {
      const url = this.buildUrl(CONFIG.AREAS_ENDPOINT, paramsObj);

      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
      });

      if (!response.ok) {
        let details = '';
        try {
          const text = await response.text();
          if (text) details = ` — ${text.slice(0, 300)}`;
        } catch { }
        throw new Error(`HTTP ${response.status}${details}`);
      }

      try {
        return await response.json();
      } catch {
        const text = await response.text().catch(() => '');
        throw new Error(`Resposta não-JSON do webhook${text ? `: ${text.slice(0, 300)}` : ''}`);
      }
    }
  };

  // ========================================
  // Render: AREAS (Areas)
  // ========================================
  const areasRender = {
    normalize(payload) {
      const raw = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.areas)
          ? payload.areas
          : Array.isArray(payload?.byArea)
            ? payload.byArea
            : Array.isArray(payload?.data)
              ? payload.data
              : [];

      return raw
        .map((row) => {
          const area =
            row?.area ??
            row?.name ??
            row?.label ??
            row?.category ??
            row?.field ??
            '–';

          const leads = Number(row?.leads ?? row?.count ?? row?.qty ?? row?.total ?? 0) || 0;

          return { area: String(area), leads };
        })
        .filter((r) => r.area && r.area !== '–');
    },

    table(payload) {
      if (!elements.areasBody) return;

      const rows = this.normalize(payload);
      if (!rows.length) {
        elements.areasBody.innerHTML = ui.renderEmptyState('Sem dados de áreas', 3);
        paginationUI.clear('areas');
        return;
      }

      const cfg = state.areasSort.areas;
      const dir = cfg.direction === 'asc' ? 1 : -1;

      rows.sort((a, b) => {
        if (cfg.key === 'leads') return ((a.leads || 0) - (b.leads || 0)) * dir;
        return a.area.localeCompare(b.area, 'pt-BR', { sensitivity: 'base' }) * dir;
      });

      const total = rows.reduce((acc, r) => acc + (Number(r.leads) || 0), 0);

      const { page, perPage } = paginationUI.clamp('areas', rows.length);

      const startIdx = (page - 1) * perPage;
      const pageRows = rows.slice(startIdx, startIdx + perPage);

      const htmlRows = pageRows
        .map((r) => {
          const pct = total > 0 ? (r.leads / total) * 100 : 0;
          return `
            <tr>
              <td style="text-align:left">${r.area}</td>
              <td>${utils.formatNumber(r.leads)}</td>
              <td>${utils.formatPercentage(pct)}</td>
            </tr>
          `;
        })
        .join('');

      const totalRow = `
        <tr class="total-row">
          <td style="text-align:left"><strong>Total</strong></td>
          <td><strong>${utils.formatNumber(total)}</strong></td>
          <td><strong>${utils.formatPercentage(100)}</strong></td>
        </tr>
      `;

      elements.areasBody.innerHTML = htmlRows + totalRow;

      paginationUI.render('areas', rows.length);
    },
  };

  const teamsRender = {
    normalize(payload) {
      const raw = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.teams)
          ? payload.teams
          : Array.isArray(payload?.byTeam)
            ? payload.byTeam
            : Array.isArray(payload?.data?.teams)
              ? payload.data.teams
              : [];

      return raw
        .map((row) => {
          const team =
            row?.team ??
            row?.name ??
            row?.label ??
            row?.field ??
            '–';

          const leads = Number(row?.leads ?? row?.count ?? row?.qty ?? row?.total ?? 0) || 0;

          return { team: String(team), leads };
        })
        .filter((r) => r.team && r.team !== '–');
    },

    table(payload) {
      if (!elements.teamsBody) return;

      const rows = this.normalize(payload);
      if (!rows.length) {
        elements.teamsBody.innerHTML = ui.renderEmptyState('Sem dados de times', 3);
        return;
      }

      const cfg = state.areasSort.teams;
      const dir = cfg.direction === 'asc' ? 1 : -1;

      rows.sort((a, b) => {
        if (cfg.key === 'leads') return ((a.leads || 0) - (b.leads || 0)) * dir;
        return a.team.localeCompare(b.team, 'pt-BR', { sensitivity: 'base' }) * dir;
      });

      const total = rows.reduce((acc, r) => acc + (Number(r.leads) || 0), 0);

      const htmlRows = rows
        .map((r) => {
          const pct = total > 0 ? (r.leads / total) * 100 : 0;
          return `
            <tr>
              <td style="text-align:left">${r.team}</td>
              <td>${utils.formatNumber(r.leads)}</td>
              <td>${utils.formatPercentage(pct)}</td>
            </tr>
          `;
        })
        .join('');

      const totalRow = `
        <tr class="total-row">
          <td style="text-align:left"><strong>Total</strong></td>
          <td><strong>${utils.formatNumber(total)}</strong></td>
          <td><strong>${utils.formatPercentage(100)}</strong></td>
        </tr>
      `;

      elements.teamsBody.innerHTML = htmlRows + totalRow;
    },
  };

  const systemsRender = {
    normalize(payload) {
      const raw = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.systems)
          ? payload.systems
          : Array.isArray(payload?.bySystem)
            ? payload.bySystem
            : Array.isArray(payload?.data?.systems)
              ? payload.data.systems
              : [];

      return raw
        .map((row) => {
          const system =
            row?.system ??
            row?.name ??
            row?.label ??
            row?.field ??
            '–';

          const leads = Number(row?.leads ?? row?.count ?? row?.qty ?? row?.total ?? 0) || 0;

          return { system: String(system), leads };
        })
        .filter((r) => r.system && r.system !== '–');
    },

    table(payload) {
      if (!elements.systemsBody) return;

      const rows = this.normalize(payload);
      if (!rows.length) {
        elements.systemsBody.innerHTML = ui.renderEmptyState('Sem dados de sistemas', 3);
        paginationUI.clear('systems');
        return;
      }

      const cfg = state.areasSort.systems;
      const dir = cfg.direction === 'asc' ? 1 : -1;

      rows.sort((a, b) => {
        if (cfg.key === 'leads') return ((a.leads || 0) - (b.leads || 0)) * dir;
        return a.system.localeCompare(b.system, 'pt-BR', { sensitivity: 'base' }) * dir;
      });

      const total = rows.reduce((acc, r) => acc + (Number(r.leads) || 0), 0);

      const { page, perPage } = paginationUI.clamp('systems', rows.length);

      const startIdx = (page - 1) * perPage;
      const pageRows = rows.slice(startIdx, startIdx + perPage);

      const htmlRows = pageRows
        .map((r) => {
          const pct = total > 0 ? (r.leads / total) * 100 : 0;
          return `
            <tr>
              <td style="text-align:left">${r.system}</td>
              <td>${utils.formatNumber(r.leads)}</td>
              <td>${utils.formatPercentage(pct)}</td>
            </tr>
          `;
        })
        .join('');

      const totalRow = `
        <tr class="total-row">
          <td style="text-align:left"><strong>Total</strong></td>
          <td><strong>${utils.formatNumber(total)}</strong></td>
          <td><strong>${utils.formatPercentage(100)}</strong></td>
        </tr>
      `;

      elements.systemsBody.innerHTML = htmlRows + totalRow;

      paginationUI.render('systems', rows.length);
    },
  };

  const challengesRender = {
    normalize(payload) {
      const raw = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.challenges)
          ? payload.challenges
          : Array.isArray(payload?.byChallenge)
            ? payload.byChallenge
            : Array.isArray(payload?.data?.challenges)
              ? payload.data.challenges
              : [];

      return raw
        .map((row) => {
          const challenge =
            row?.challenge ??
            row?.name ??
            row?.label ??
            row?.field ??
            '–';

          const leads = Number(row?.leads ?? row?.count ?? row?.qty ?? row?.total ?? 0) || 0;

          return { challenge: String(challenge), leads };
        })
        .filter((r) => r.challenge && r.challenge !== '–');
    },

    table(payload) {
      if (!elements.challengesBody) return;

      const rows = this.normalize(payload);
      if (!rows.length) {
        elements.challengesBody.innerHTML = ui.renderEmptyState('Sem dados de desafios', 3);
        return;
      }

      const cfg = state.areasSort.challenges;
      const dir = cfg.direction === 'asc' ? 1 : -1;

      rows.sort((a, b) => {
        if (cfg.key === 'leads') return ((a.leads || 0) - (b.leads || 0)) * dir;
        return a.challenge.localeCompare(b.challenge, 'pt-BR', { sensitivity: 'base' }) * dir;
      });

      const total = rows.reduce((acc, r) => acc + (Number(r.leads) || 0), 0);

      const htmlRows = rows
        .map((r) => {
          const pct = total > 0 ? (r.leads / total) * 100 : 0;
          return `
            <tr>
              <td style="text-align:left">${r.challenge}</td>
              <td>${utils.formatNumber(r.leads)}</td>
              <td>${utils.formatPercentage(pct)}</td>
            </tr>
          `;
        })
        .join('');

      const totalRow = `
        <tr class="total-row">
          <td style="text-align:left"><strong>Total</strong></td>
          <td><strong>${utils.formatNumber(total)}</strong></td>
          <td><strong>${utils.formatPercentage(100)}</strong></td>
        </tr>
      `;

      elements.challengesBody.innerHTML = htmlRows + totalRow;
    },
  };

  const moneyRender = {
    normalize(payload) {
      const raw = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.money)
          ? payload.money
          : Array.isArray(payload?.byMoney)
            ? payload.byMoney
            : Array.isArray(payload?.data?.money)
              ? payload.data.money
              : [];

      return raw
        .map((row) => {
          const money =
            row?.money ??
            row?.name ??
            row?.label ??
            row?.field ??
            '–';

          const leads = Number(row?.leads ?? row?.count ?? row?.qty ?? row?.total ?? 0) || 0;

          return { money: String(money), leads };
        })
        .filter((r) => r.money && r.money !== '–');
    },

    table(payload) {
      if (!elements.moneyBody) return;

      const rows = this.normalize(payload);
      if (!rows.length) {
        elements.moneyBody.innerHTML = ui.renderEmptyState('Sem dados financeiros', 3);
        return;
      }

      const cfg = state.areasSort.money;
      const dir = cfg.direction === 'asc' ? 1 : -1;

      rows.sort((a, b) => {
        if (cfg.key === 'leads') return ((a.leads || 0) - (b.leads || 0)) * dir;
        return a.money.localeCompare(b.money, 'pt-BR', { sensitivity: 'base' }) * dir;
      });

      const total = rows.reduce((acc, r) => acc + (Number(r.leads) || 0), 0);

      const htmlRows = rows
        .map((r) => {
          const pct = total > 0 ? (r.leads / total) * 100 : 0;
          return `
            <tr>
              <td style="text-align:left">${r.money}</td>
              <td>${utils.formatNumber(r.leads)}</td>
              <td>${utils.formatPercentage(pct)}</td>
            </tr>
          `;
        })
        .join('');

      const totalRow = `
        <tr class="total-row">
          <td style="text-align:left"><strong>Total</strong></td>
          <td><strong>${utils.formatNumber(total)}</strong></td>
          <td><strong>${utils.formatPercentage(100)}</strong></td>
        </tr>
      `;

      elements.moneyBody.innerHTML = htmlRows + totalRow;
    },
  };

  // ========================================
  // Data loader (Areas)
  // ========================================
  async function loadAreas() {
    const entryStart = elements.entryStartInput?.value || '';
    const entryEnd = elements.entryEndInput?.value || '';

    if (!entryStart || !entryEnd) {
      ui.showError('Selecione as datas de entrada');
      return;
    }

    ui.showLoading();
    if (elements.areasBody) elements.areasBody.innerHTML = ui.renderSkeleton(6, 3);
    if (elements.teamsBody) elements.teamsBody.innerHTML = ui.renderSkeleton(6, 3);
    if (elements.systemsBody) elements.systemsBody.innerHTML = ui.renderSkeleton(6, 3);
    if (elements.challengesBody) elements.challengesBody.innerHTML = ui.renderSkeleton(6, 3);
    if (elements.moneyBody) elements.moneyBody.innerHTML = ui.renderSkeleton(6, 3);


    paginationUI.clear('areas');
    paginationUI.clear('systems');

    try {
      const params = { entry_start: entryStart, entry_end: entryEnd };
      const res = await api.fetchAreas(params);
      const payload = Array.isArray(res) ? res[0] : res;

      state.areasData = payload;

      paginationUI.reset(['areas', 'systems']);

      areasRender.table(payload || null);
      teamsRender.table(payload || null);
      systemsRender.table(payload || null);
      challengesRender.table(payload || null);
      moneyRender.table(payload || null);
    } catch (e) {
      ui.showError(`Failed to load areas: ${e.message}`);
      paginationUI.clear('areas');
      paginationUI.clear('systems');
      if (elements.areasBody) elements.areasBody.innerHTML = ui.renderEmptyState('Erro ao carregar', 3);
      if (elements.teamsBody) elements.teamsBody.innerHTML = ui.renderEmptyState('Erro ao carregar', 3);
      if (elements.systemsBody) elements.systemsBody.innerHTML = ui.renderEmptyState('Erro ao carregar', 3);
      if (elements.challengesBody) elements.challengesBody.innerHTML = ui.renderEmptyState('Erro ao carregar', 3);
      if (elements.moneyBody) elements.moneyBody.innerHTML = ui.renderEmptyState('Erro ao carregar', 3);
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

  function clearDatesAreas() {
    const today = utils.today();
    if (elements.entryStartInput) elements.entryStartInput.value = today;
    if (elements.entryEndInput) elements.entryEndInput.value = today;
    loadAreas();
  }

  // ========================================
  // Sorting listeners (Areas)
  // ========================================
  function setupAreasSortListeners() {
    // Áreas
    document.querySelectorAll('#areasBody').forEach(() => {
      const table = document.querySelector('#areasBody')?.closest('table');
      table?.querySelectorAll('th[data-sort]')?.forEach((th) => {
        th.addEventListener('click', () => {
          const key = th.dataset.sort; // 'area' | 'leads'
          const cfg = state.areasSort.areas;

          if (cfg.key === key) cfg.direction = cfg.direction === 'asc' ? 'desc' : 'asc';
          else { cfg.key = key; cfg.direction = 'desc'; }

          state.pagination.areas.page = 1;

          if (state.areasData) areasRender.table(state.areasData);
        });
      });
    });

    // Times
    document.querySelectorAll('#teamsBody').forEach(() => {
      const table = document.querySelector('#teamsBody')?.closest('table');
      table?.querySelectorAll('th[data-sort]')?.forEach((th) => {
        th.addEventListener('click', () => {
          const key = th.dataset.sort; // 'team' | 'leads'
          const cfg = state.areasSort.teams;

          if (cfg.key === key) cfg.direction = cfg.direction === 'asc' ? 'desc' : 'asc';
          else { cfg.key = key; cfg.direction = 'desc'; }

          if (state.areasData) teamsRender.table(state.areasData);
        });
      });
    });

    // Sistemas
    document.querySelectorAll('#systemsBody').forEach(() => {
      const table = document.querySelector('#systemsBody')?.closest('table');
      table?.querySelectorAll('th[data-sort]')?.forEach((th) => {
        th.addEventListener('click', () => {
          const key = th.dataset.sort; // 'system' | 'leads'
          const cfg = state.areasSort.systems;

          if (cfg.key === key) cfg.direction = cfg.direction === 'asc' ? 'desc' : 'asc';
          else { cfg.key = key; cfg.direction = 'desc'; }

          state.pagination.systems.page = 1;

          if (state.areasData) systemsRender.table(state.areasData);
        });
      });
    });

    // Desafios
    document.querySelectorAll('#challengesBody').forEach(() => {
      const table = document.querySelector('#challengesBody')?.closest('table');
      table?.querySelectorAll('th[data-sort]')?.forEach((th) => {
        th.addEventListener('click', () => {
          const key = th.dataset.sort; // 'challenge' | 'leads'
          const cfg = state.areasSort.challenges;

          if (cfg.key === key) cfg.direction = cfg.direction === 'asc' ? 'desc' : 'asc';
          else { cfg.key = key; cfg.direction = 'desc'; }

          if (state.areasData) challengesRender.table(state.areasData);
        });
      });
    });

    // Money
    document.querySelectorAll('#moneyBody').forEach(() => {
      const table = document.querySelector('#moneyBody')?.closest('table');
      table?.querySelectorAll('th[data-sort]')?.forEach((th) => {
        th.addEventListener('click', () => {
          const key = th.dataset.sort; // 'money' | 'leads'
          const cfg = state.areasSort.money;

          if (cfg.key === key) cfg.direction = cfg.direction === 'asc' ? 'desc' : 'asc';
          else { cfg.key = key; cfg.direction = 'desc'; }

          if (state.areasData) moneyRender.table(state.areasData);
        });
      });
    });
  }

  // ========================================
  // Events
  // ========================================
  function setupEventListeners() {
    if (elements.closeToast) elements.closeToast.addEventListener('click', () => ui.hideError());

    // Limpar
    if (elements.clearEntryDates) {
      elements.clearEntryDates.addEventListener('click', clearDatesAreas);
    }

    // Aplicar
    if (elements.applyEntryOnly) {
      elements.applyEntryOnly.addEventListener('click', loadAreas);
    }

    setupAreasSortListeners();

    // Enter
    const onEnter = (e) => {
      if (e.key !== 'Enter') return;
      loadAreas();
    };

    if (elements.entryStartInput) elements.entryStartInput.addEventListener('keypress', onEnter);
    if (elements.entryEndInput) elements.entryEndInput.addEventListener('keypress', onEnter);
  }

  // ========================================
  // Init
  // ========================================
  function init() {
    initializeDates();
    setupEventListeners();
    loadAreas();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
