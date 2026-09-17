/**
 * Autenticazione client (pattern IIFE).
 * - Sessione via cookie HttpOnly: il client non tocca mai il token.
 * - Rende login/registrazione in overlay, avatar rotondo con iniziali al login,
 *   menu utente (Report se admin, Esci).
 * - Emette CustomEvent 'benzina:auth-change' (detail: user | null).
 * Dipende da: config.js.
 */
'use strict';

const Auth = (() => {
  let user = null; // null | { id, name, surname, email, isAdmin, initials }

  const $ = (id) => document.getElementById(id);

  /* ---------- Chiamate API ---------- */

  function api(path, opts = {}) {
    return fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts,
    });
  }

  /* ---------- Getters ---------- */

  const getUser = () => user;
  const isLoggedIn = () => !!user;
  const isAdmin = () => !!(user && user.isAdmin);

  /* ---------- Stato / eventi ---------- */

  function setUser(u) {
    user = u || null;
    document.dispatchEvent(new CustomEvent('benzina:auth-change', { detail: user }));
  }

  /* ---------- Overlay ---------- */

  function ensureOverlay() {
    let overlay = $('auth-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'auth-overlay';
      overlay.hidden = true;
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
      <div class="auth-backdrop" data-close></div>
      <div class="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button class="auth-close" type="button" data-close aria-label="Chiudi">&times;</button>
        <h2 class="auth-title" id="auth-title">Accesso</h2>
        <p class="auth-subtitle">Entra per sincronizzare i tuoi preferiti su tutti i dispositivi.</p>
        <div class="auth-tabs" role="tablist">
          <button class="auth-tab active" type="button" data-tab="login" role="tab">Accedi</button>
          <button class="auth-tab" type="button" data-tab="register" role="tab">Registrati</button>
        </div>

        <form class="auth-form" id="auth-login-form" novalidate>
          <div class="auth-field">
            <label for="login-email">Email</label>
            <input id="login-email" type="email" name="email" autocomplete="email" required>
          </div>
          <div class="auth-field">
            <label for="login-password">Password</label>
            <input id="login-password" type="password" name="password" autocomplete="current-password" required>
          </div>
          <p class="auth-error" hidden></p>
          <button class="auth-submit" type="submit">Accedi</button>
        </form>

        <form class="auth-form" id="auth-register-form" hidden novalidate>
          <div class="auth-field">
            <label for="reg-name">Nome</label>
            <input id="reg-name" type="text" name="name" autocomplete="given-name" required>
          </div>
          <div class="auth-field">
            <label for="reg-surname">Cognome</label>
            <input id="reg-surname" type="text" name="surname" autocomplete="family-name" required>
          </div>
          <div class="auth-field">
            <label for="reg-email">Email</label>
            <input id="reg-email" type="email" name="email" autocomplete="email" required>
          </div>
          <div class="auth-field">
            <label for="reg-password">Password</label>
            <input id="reg-password" type="password" name="password" autocomplete="new-password" minlength="6" required>
          </div>
          <p class="auth-error" hidden></p>
          <button class="auth-submit" type="submit">Crea account</button>
        </form>
      </div>`;

    overlay.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-close]')) closeAuth();
    });
    overlay.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') closeAuth();
    });
    overlay.addEventListener('submit', (ev) => onSubmit(ev));

    // Tab login/register
    overlay.querySelectorAll('.auth-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const which = tab.dataset.tab;
        overlay.querySelectorAll('.auth-tab').forEach((t) =>
          t.classList.toggle('active', t === tab)
        );
        $('auth-login-form').hidden = which !== 'login';
        $('auth-register-form').hidden = which !== 'register';
        hideError();
      });
    });
    return overlay;
  }

  function openAuth() {
    const overlay = ensureOverlay();
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    const first = $('#login-email');
    if (first) setTimeout(() => first.focus(), 50);
  }

  function closeAuth() {
    const overlay = $('auth-overlay');
    if (overlay) overlay.hidden = true;
    document.body.style.overflow = '';
    hideError();
  }

  function showError(form, msg, isError) {
    const p = form.querySelector('.auth-error');
    if (!p) return;
    p.textContent = msg;
    p.hidden = !msg;
    if (isError) p.style.color = 'var(--price-red)';
    else p.style.color = 'var(--price-green)';
  }
  function hideError() {
    document.querySelectorAll('.auth-form .auth-error').forEach((p) => {
      p.hidden = true;
    });
  }

  /* ---------- Submit ---------- */

  async function onSubmit(ev) {
    ev.preventDefault();
    const form = ev.target;
    const isRegister = form.id === 'auth-register-form';
    const submitBtn = form.querySelector('.auth-submit');
    submitBtn.disabled = true;
    hideError();
    try {
      const body = isRegister
        ? {
            name: $('#reg-name').value.trim(),
            surname: $('#reg-surname').value.trim(),
            email: $('#reg-email').value.trim(),
            password: $('#reg-password').value,
          }
        : {
            email: $('#login-email').value.trim(),
            password: $('#login-password').value,
          };

      const res = await api(isRegister ? CONFIG.API.auth.register : CONFIG.API.auth.login, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        showError(form, data.message || CONFIG.STRINGS.authFailed, true);
        return;
      }
      setUser(data.user);
      form.reset();
      closeAuth();
      toast('Benvenuto, ' + data.user.name + '!');
    } catch {
      showError(form, CONFIG.STRINGS.authFailed, true);
    } finally {
      submitBtn.disabled = false;
    }
  }

  /* ---------- Menu utente ---------- */

  function ensureMenu() {
    let menu = $('user-menu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'user-menu';
      menu.className = 'user-menu';
      menu.hidden = true;
    }
    const reportItem = user && user.isAdmin
      ? `<button class="menu-btn" type="button" id="menu-report" data-nav="account/report.html">📊 Report visualizzazioni</button>`
      : '';
    menu.innerHTML = `
      <div class="user-menu-header">${esc(user.name)} ${esc(user.surname)}</div>
      <div class="user-menu-email">${esc(user.email)}</div>
      ${reportItem}
      <button class="menu-btn danger" type="button" id="menu-logout">Esci</button>`;
    const logoutBtn = menu.querySelector('#menu-logout');
    if (logoutBtn) logoutBtn.addEventListener('click', () => logout());
    const reportBtn = menu.querySelector('#menu-report');
    if (reportBtn) reportBtn.addEventListener('click', () => { location.href = 'account/report.html'; });
    return menu;
  }

  /** Rende il chip utente nel #user-area (login-btn oppure avatar+menu). */
  function render() {
    const area = $('user-area');
    if (!area) return;
    area.innerHTML = '';

    if (!user) {
      const btn = document.createElement('button');
      btn.className = 'login-btn';
      btn.type = 'button';
      btn.textContent = 'Accedi';
      btn.addEventListener('click', openAuth);
      area.appendChild(btn);
      return;
    }

    const avatar = document.createElement('button');
    avatar.className = 'avatar-btn';
    avatar.type = 'button';
    avatar.title = `${user.name} ${user.surname}`;
    avatar.textContent = user.initials || ((user.name || '')[0] || '') + ((user.surname || '')[0] || '');
    avatar.setAttribute('aria-label', 'Menu utente');
    const menu = ensureMenu();
    area.appendChild(avatar);
    area.appendChild(menu);

    let open = false;
    function toggle(show) {
      open = typeof show === 'boolean' ? show : !open;
      menu.hidden = !open;
    }
    avatar.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggle();
    });
    document.addEventListener('click', (ev) => {
      if (open && !menu.contains(ev.target) && ev.target !== avatar) toggle(false);
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') toggle(false);
    });
  }

  /* ---------- Logout ---------- */

  async function logout() {
    try {
      await api(CONFIG.API.auth.logout, { method: 'POST', body: '{}' });
    } catch { /* ignora errori di rete */ }
    setUser(null);
    render();
    toast('Sei uscito.');
  }

  /* ---------- Report visita ---------- */

  function trackVisit() {
    // Fire-and-forget: registra una vista in /api/report/visit (cookie incluso).
    try {
      fetch(CONFIG.API.auth.visit, { method: 'POST', body: '{}', credentials: 'same-origin' }).catch(() => {});
    } catch { /* offline */ }
  }

  /* ---------- Init ---------- */

  async function init() {
    try {
      const res = await api(CONFIG.API.auth.me);
      const data = await res.json().catch(() => ({ user: null }));
      setUser(data.user || null);
    } catch {
      setUser(null); // offline o backend non raggiungibile
    }
    render();
  }

  /* ---------- Toast (leggero, senza dipendere da MapView) ---------- */

  function toast(msg) {
    const el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    el.className = '';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 3000);
  }

  /** Escape HTML per i nomi utente (sempre testi non fidati). */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  return {
    init,
    render,
    trackVisit,
    getUser,
    isLoggedIn,
    isAdmin,
    openAuth,
    closeAuth,
    toast,
  };
})();