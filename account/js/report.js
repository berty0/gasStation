/**
 * Report visualizzazioni (solo admin).
 * Carica /api/report, rende stat card + tabelle.
 * Auto-refresh ogni 60s.
 */
'use strict';

const Report = (() => {
  const $ = (id) => document.getElementById(id);

  // Stato auto-refresh
  let refreshTimer = null;
  const REFRESH_INTERVAL_MS = 60000;

  /* ---------- API ---------- */
  async function fetchReport() {
    const res = await fetch('/api/report', { credentials: 'same-origin' });
    if (res.status === 401 || res.status === 403) {
      const err = new Error('unauthorized');
      err.status = res.status;
      throw err;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /* ---------- Render ---------- */
  function fmtDateTime(ts) {
    const d = new Date(ts);
    return d.toLocaleString('it-IT', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderStats(data) {
    $('stat-total').textContent = data.total ?? '—';
    $('stat-guests').textContent = data.guests ?? '—';
    $('stat-users').textContent = (data.users?.length ?? 0).toString();
  }

  function renderUsers(data) {
    const tbody = $('table-users').querySelector('tbody');
    const empty = $('users-empty');
    const users = data.users || [];

    if (!users.length) {
      tbody.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    tbody.innerHTML = users
      .map(
        (u) => `
        <tr>
          <td>${esc(u.name)}</td>
          <td>${esc(u.email)}</td>
          <td class="num">${u.count}</td>
          <td>${u.lastSeen ? fmtDateTime(u.lastSeen) : '—'}</td>
        </tr>`
      )
      .join('');
  }

  function renderRecent(data) {
    const tbody = $('table-recent').querySelector('tbody');
    const empty = $('recent-empty');
    const recent = data.recent || [];

    if (!recent.length) {
      tbody.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    tbody.innerHTML = recent
      .map(
        (v) => `
        <tr>
          <td>${v.ts ? fmtDateTime(v.ts) : '—'}</td>
          <td>${esc(v.name || 'Ospite')}</td>
          <td>${v.userId ? 'Registrato' : 'Ospite'}</td>
          <td>${esc(v.page || '/')}</td>
        </tr>`
      )
      .join('');
  }

  function showError(msg) {
    const el = $('report-error');
    el.textContent = msg;
    el.hidden = false;
    $('report-content').hidden = true;
    $('report-loading').hidden = true;
  }

  function showLoading() {
    $('report-loading').hidden = false;
    $('report-content').hidden = true;
    $('report-error').hidden = true;
  }

  function showContent() {
    $('report-loading').hidden = true;
    $('report-content').hidden = false;
    $('report-error').hidden = true;
  }

  /* ---------- Load ---------- */
  async function load() {
    showLoading();
    try {
      const data = await fetchReport();
      renderStats(data);
      renderUsers(data);
      renderRecent(data);
      showContent();
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        showError('Solo l\'amministratore può vedere il report. <a href="../index.html">Accedi come admin</a>.');
      } else {
        showError('Errore nel caricamento del report: ' + err.message);
      }
    }
  }

  /* ---------- Auto-refresh ---------- */
  function startAutoRefresh() {
    stopAutoRefresh();
    refreshTimer = setInterval(load, REFRESH_INTERVAL_MS);
  }

  function stopAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
  }

  /* ---------- Init ---------- */
  function init() {
    load();
    startAutoRefresh();
    // Cleanup al leave
    window.addEventListener('beforeunload', stopAutoRefresh);
  }

  // Avvia quando il DOM è pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
