(() => {
  const STORAGE_KEY = 'ce_theme';
  const THEMES = { light: 'light', dark: 'dark' };
  const root = document.documentElement;

  const mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function getStoredTheme() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v === THEMES.dark || v === THEMES.light ? v : null;
    } catch (_) {
      return null;
    }
  }

  function getSystemTheme() {
    if (!mql) return null;
    return mql.matches ? THEMES.dark : THEMES.light;
  }

  function setStoredTheme(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (_) { }
  }

  function clearStoredTheme() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) { }
  }

  function applyTheme(theme, { persist = false } = {}) {
    const t = theme === THEMES.dark ? THEMES.dark : THEMES.light;
    root.setAttribute('data-theme', t);
    if (persist) setStoredTheme(t);
    updateToggleUI();
    // Notify anyone interested (charts, etc.)
    try {
      window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: t } }));
    } catch (_) { }
  }

  function currentTheme() {
    return root.getAttribute('data-theme') === THEMES.dark ? THEMES.dark : THEMES.light;
  }

  function nextTheme() {
    return currentTheme() === THEMES.dark ? THEMES.light : THEMES.dark;
  }

  function updateToggleUI() {
    const btn = document.querySelector('[data-theme-toggle], #themeToggle, .top-nav__theme-btn');
    if (!btn) return;

    const isDark = currentTheme() === THEMES.dark;

    // Mostra o destino do clique (ação)
    btn.innerHTML = isDark
      ? '<i class="fa-solid fa-sun" aria-hidden="true"></i>'
      : '<i class="fa-solid fa-moon" aria-hidden="true"></i>';


    btn.setAttribute('aria-label', isDark ? 'Mudar para tema claro' : 'Mudar para tema escuro');
    btn.setAttribute('title', isDark ? 'Mudar para tema claro' : 'Mudar para tema escuro');
    btn.setAttribute('aria-pressed', String(isDark));
  }

  function toggleTheme() {
    applyTheme(nextTheme(), { persist: true });
  }

  function bindExistingButton() {
    const btn = document.querySelector('[data-theme-toggle], #themeToggle');
    if (!btn) return false;

    btn.addEventListener('click', toggleTheme);
    // garante classes mínimas se quiser usar o style do theme.css
    if (!btn.classList.contains('top-nav__theme-btn')) btn.classList.add('top-nav__theme-btn');
    // Se o botão estiver ao lado do brand, aplica o layout flex
    const brand = btn.closest('.top-nav__brand');
    if (brand) brand.classList.add('top-nav__brand--with-theme');
    updateToggleUI();
    return true;
  }

  function injectButton() {
    // Evita duplicar
    if (document.querySelector('.top-nav__theme-btn')) return;

    // Preferência: ao lado do "Analytics" (brand)
    const brand = document.querySelector('.top-nav__brand');
    if (brand) {
      // marca para aplicar layout flex via CSS
      brand.classList.add('top-nav__brand--with-theme');

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'top-nav__theme-btn';
      btn.addEventListener('click', toggleTheme);

      brand.appendChild(btn);
      updateToggleUI();
      return;
    }

    // Fallback: no menu à direita
    const nav = document.querySelector('.top-nav__links');
    if (!nav) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'top-nav__theme-btn';
    btn.addEventListener('click', toggleTheme);

    nav.appendChild(btn);
    updateToggleUI();
  }

  // Apply theme ASAP (before CSS finishes loading)
  const stored = getStoredTheme();
  if (stored) {
    applyTheme(stored, { persist: false });
  } else {
    applyTheme(getSystemTheme() || THEMES.light, { persist: false });
  }

  // If user hasn't chosen, follow system changes
  if (mql) {
    const onSystemChange = () => {
      const hasPreference = !!getStoredTheme();
      if (hasPreference) return;
      applyTheme(getSystemTheme() || THEMES.light, { persist: false });
    };
    try {
      mql.addEventListener('change', onSystemChange);
    } catch (_) {
      // Safari old
      try { mql.addListener(onSystemChange); } catch (_) { }
    }
  }

  // DOM: add the button (or bind if you already placed one)
  const onReady = () => {
    if (!bindExistingButton()) injectButton();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();