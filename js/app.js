/**
 * Entry point: stato globale, pipeline di inizializzazione, eventi.
 * Dipende da: tutti gli altri moduli.
 */
'use strict';

const App = (() => {
  const state = {
    fuel: CONFIG.DEFAULTS.fuel,
    radiusKm: CONFIG.DEFAULTS.radiusKm,
    radiusUnlimited: CONFIG.DEFAULTS.radiusUnlimited,
    selfOnly: CONFIG.DEFAULTS.selfOnly,
    search: '',
    brands: [],
    userPos: null, // {lat,lng} posizione utente (se consentita)
    favoritesOnly: false,
    sort: 'asc',
    ready: false,
  };

  let map = null;
  let lastRanking = null;

  /* ---------- Render pieno (debounce) ---------- */

  let renderTimer = null;
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 250);
  }

  function render() {
    if (!state.ready || !map) return;
    const filters = UI.readFilters();
    Object.assign(state, filters);
    // fallback centro mappa per distanza
    const center = map.getCenter();

    const ranking = Ranking.compute({
      ...state,
      center: { lat: center.lat, lng: center.lng },
    }, state.sort);

    // Filtra per preferiti se attivo
    if (state.favoritesOnly) {
      const favIds = new Set(Favorites.getAll());
      ranking.list = ranking.list.filter((r) => favIds.has(r.station.id));
    }

    MapView.renderMarkers(ranking.list, ranking.minP, ranking.maxP, state.fuel);
    UI.renderList(ranking, state);
    UI.renderLegend(ranking.minP, ranking.maxP);
    UI.setRankingRef(ranking, state);
    UI.renderFavPanel(); // render pannello preferiti
    lastRanking = ranking;

    // fit iniziale (solo la prima volta, se non c'è posizione utente)
    if (!state._fitted) {
      state._fitted = true;
      if (state.userPos) {
        MapView.fitWithUser(ranking.list.map((r) => r.station), state.userPos);
      } else {
        MapView.fitAll(ranking.list.map((r) => r.station));
      }
    }
  }

  /* ---------- Geolocalizzazione ---------- */

  async function initGeolocation() {
    MapView.setLocateBtnLoading(true);
    try {
      const pos = await Geo.getPosition();
      state.userPos = pos;
      MapView.setMarkerUtente(pos);
      scheduleRender();
    } catch {
      MapView.toast(CONFIG.STRINGS.gpsError2);
    } finally {
      MapView.setLocateBtnLoading(false);
    }
  }

  async function locateUserButton() {
    MapView.setLocateBtnLoading(true);
    const pos = await MapView.locateUser();
    MapView.setLocateBtnLoading(false);
    if (pos) {
      state.userPos = pos;
      scheduleRender();
      MapView.toast(CONFIG.STRINGS.gpsApprox);
    } else {
      MapView.toast(CONFIG.STRINGS.gpsError, true);
    }
  }

  /* ---------- Init + eventi ---------- */

  async function init() {
    MapView.toast(CONFIG.STRINGS.loading);
    try {
      const meta = await Data.ensureLoaded();
      UI.renderStatus(meta);
      MapView.toast('', false, 0); // clear dopo il primo successo
    } catch (err) {
      showFatal(err.message);
      return;
    }

    UI.renderFuelOptions();
    UI.renderBrandChips();
    UI.renderRadiusLabel();

    map = MapView.initMap(document.getElementById('map'));

    // Inizializza Auth (cookie-based) e preferiti
    await Auth.init();
    await Favorites.refresh();
    Auth.trackVisit();

    UI.bindHandlers({
      onFiltersChange: scheduleRender,
      onRenderAll: () => render(),
      onSortChange: (dir) => { state.sort = dir; scheduleRender(); },
      onLocationSearch: (result) => {
        state.userPos = { lat: result.lat, lng: result.lng };
        MapView.setMarkerUtente(state.userPos);
        MapView.setMapCenter(state.userPos);
        scheduleRender();
      },
    });
    UI.setLocateHandler(locateUserButton);

    document.addEventListener('benzina:refresh', () => {
      UI.renderStatus(Data.getMeta());
      scheduleRender();
    });

    // Re-render preferiti al cambio auth (login/logout)
    document.addEventListener('benzina:auth-change', () => {
      scheduleRender();
    });

    // Re-render preferiti quando cambia la lista (add/remove/sync)
    document.addEventListener('benzina:favorites:change', () => {
      if (UI.renderFavPanel) UI.renderFavPanel();
    });

    // rifit quando cambia la vista (fallback distanze dal centro mappa)
    map.on('moveend', () => {
      if (map._suppressMoveendRender) return; // skip programmatic flyTo
      if (!state.userPos) scheduleRender();
    });

    state.ready = true;
    render();

    // Registra service worker (PWA offline)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch((err) =>
        console.warn('[SW] registrazione fallita:', err)
      );
    }

    // Geolocalizzazione iniziale (non bloccante)
    setTimeout(initGeolocation, 400);
  }

  function showFatal(msg) {
    const mapEl = document.getElementById('map');
    // Escape HTML inline: showFatal may run before geo.js defines esc()
    const safe = String(msg || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    mapEl.innerHTML = `
      <div style="height:100%;display:flex;align-items:center;justify-content:center;background:#f4f6f8">
        <div style="max-width:380px;text-align:center;padding:24px">
          <h3>Impossibile caricare i dati</h3>
          <p style="color:#6b7683">${safe}</p>
          <button id="btn-retry" type="button" style="padding:10px 22px;border:none;border-radius:8px;background:#1a73e8;color:#fff;font-size:14px;cursor:pointer">Riprova</button>
        </div>
      </div>`;
    document.getElementById('btn-retry').addEventListener('click', () => {
      location.reload();
    });
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => App.init());