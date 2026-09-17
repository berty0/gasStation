/**
 * Gestione preferiti con sincronizzazione account (server-side).
 * - Stato in-memory (Set) come fonte di verità → has/getAll/count restano sincroni.
 * - Ospite: salva in localStorage ('benzina:favorites').
 * - Loggato: i preferiti sono dell'account su /api/user/favorites; il dispositivo
 *   conserva comunque una copia locale per l'uso offline.
 * - toggle(): ottimistico (istantaneo) + push al server in background.
 * Dipende da: config.js, Auth (account/js/auth.js).
 */
'use strict';

const Favorites = (() => {
  const LS_KEY = 'benzina:favorites';
  const MAX = 100;

  /** Stato in-memory: unico Set di riferimento (per letture sincrone). */
  let ids = new Set();
  /** True se la cache locale non è ancora allineata al server (push pendente). */
  let dirty = false;

  /* ---------- Persistenza locale (cache dispositivo) ---------- */

  function loadLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function saveLocal(arr) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(arr));
    } catch { /* quota exceeded */ }
  }

  /* ---------- Server ---------- */

  async function pushToServer() {
    if (!Auth || !Auth.isLoggedIn || !Auth.isLoggedIn()) return;
    try {
      const res = await fetch(CONFIG.API.favorites, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(ids) }),
      });
      if (res.ok) dirty = false;
    } catch { /* offline: resta dirty, si riporta al prossimo online */ }
  }

  /** Allinea lo stato a un elenco (server o locale) senza persistere. */
  function setFrom(arr) {
    ids = new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []);
  }

  /* ---------- API pubblica ---------- */

  /** Carica i preferiti dalla fonte giusta (chiamata a init e a ogni cambio utente). */
  async function refresh() {
    if (Auth && Auth.isLoggedIn && Auth.isLoggedIn()) {
      try {
        const res = await fetch(CONFIG.API.favorites, { credentials: 'same-origin' });
        if (res.ok) {
          const data = await res.json();
          setFrom(data.ids);
          saveLocal(Array.from(ids));
          dirty = false;
          document.dispatchEvent(new CustomEvent('benzina:favorites:change'));
          return Array.from(ids);
        }
      } catch { /* offline: uso la copia locale */ }
    }
    setFrom(loadLocal());
    dirty = false;
    document.dispatchEvent(new CustomEvent('benzina:favorites:change'));
    return Array.from(ids);
  }

  /**
   * Al login: unisce i preferiti locali (ospite) con quelli dell'account
   * e li salva sul server. L'utente non perde nulla.
   */
  async function syncLocalToServer() {
    const local = loadLocal();
    let server = [];
    try {
      const res = await fetch(CONFIG.API.favorites, { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        server = Array.isArray(data.ids) ? data.ids : [];
      }
    } catch { /* backend non raggiungibile: segna dirty, push al prossimo online */ }

    const merged = [...new Set([...local, ...server])].slice(0, MAX);
    setFrom(merged);
    saveLocal(Array.from(ids));
    dirty = true;

    // Push al server (se loggati)
    if (Auth && Auth.isLoggedIn && Auth.isLoggedIn()) await pushToServer();
    document.dispatchEvent(new CustomEvent('benzina:favorites:change'));
    return Array.from(ids);
  }

  /** Toggle (sincrono per la UI): flip istantaneo + persistenza + sync in background. */
  function toggle(id) {
    const had = ids.has(id);
    if (had) {
      ids.delete(id);
    } else {
      if (ids.size >= MAX) {
        if (window.MapView && MapView.toast) {
          MapView.toast(`Massimo ${MAX} preferiti.`, true);
        }
        return false;
      }
      ids.add(id);
    }
    saveLocal(Array.from(ids));
    dirty = true;
    document.dispatchEvent(new CustomEvent('benzina:favorites:change'));
    pushToServer(); // fire-and-forget
    return !had;
  }

  const getAll = () => Array.from(ids);
  const has = (id) => ids.has(id);
  const count = () => ids.size;

  // Riprova il push quando torna la connessione
  if (typeof window !== 'undefined' && 'addEventListener' in window) {
    window.addEventListener('online', () => {
      if (dirty) pushToServer();
    });
  }

  // Al login: unisci local → server
  document.addEventListener('benzina:auth-change', (ev) => {
    if (ev.detail) {
      Favorites.syncLocalToServer(); // async, non attendere la UI
    } else {
      Favorites.refresh();
    }
  });

  return { getAll, has, count, toggle, refresh, syncLocalToServer, pushToServer };
})();