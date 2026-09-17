/**
 * UI: sidebar, filtri, classifica, legenda, drawer mobile.
 * Dipende da: config.js, geo.js, data.js, ranking.js, map.js.
 */
'use strict';

const UI = (() => {
  /* ---------- Cache selettori ---------- */

  const $ = (id) => document.getElementById(id);
  function els() {
    return {
      status: $('status'),
      ranking: $('ranking'),
      rankingTitle: $('ranking-title'),
      rankingCount: $('ranking-count'),
      legend: $('legend'),
      fuel: $('filter-fuel'),
      radius: $('filter-radius'),
      radiusLabel: $('radius-label'),
      unlimited: $('filter-unlimited'),
      self: $('filter-self'),
      favoritesOnly: $('filter-favorites'),
      search: $('filter-search'),
      brands: $('filter-brands'),
      sidebar: $('sidebar'),
      drawerToggle: $('drawer-toggle'),
      drawerBackdrop: $('drawer-backdrop'),
      locationInput: $('location-input'),
      locationBtn: $('location-btn'),
      locationStatus: $('location-status'),
      sortAsc: $('sort-asc'),
      sortDesc: $('sort-desc'),
    };
  }

  /* ---------- Stato filtri → oggetto state ---------- */

  function readFilters() {
    const e = els();
    const brands = Array.from(e.brands.querySelectorAll('.chip.active'))
      .map((c) => c.dataset.brand);
    return {
      fuel: e.fuel.value,
      radiusKm: parseInt(e.radius.value, 10),
      radiusUnlimited: e.unlimited.checked,
      selfOnly: e.self.checked,
      favoritesOnly: e.favoritesOnly ? e.favoritesOnly.checked : false,
      search: e.search.value.trim(),
      brands,
    };
  }

  /* ---------- Popolamento filtri ---------- */

  function renderFuelOptions() {
    const e = els();
    const fuels = Data.getAllFuels();
    let html = '';
    for (const f of fuels) {
      const selected = f === CONFIG.DEFAULTS.fuel ? ' selected' : '';
      html += `<option value="${escAttr(f)}"${selected}>${esc(f)}</option>`;
    }
    e.fuel.innerHTML = html;
  }

  function renderBrandChips() {
    const e = els();
    const brands = Data.getAllBrands();
    e.brands.innerHTML = brands
      .map(
        (b) => `<button type="button" class="chip${CONFIG.DEFAULTS.brands.includes(b) ? ' active' : ''}" data-brand="${escAttr(b)}">${esc(b)}</button>`
      )
      .join('');
  }

  function renderRadiusLabel() {
    const e = els();
    e.radiusLabel.textContent = e.unlimited.checked
      ? 'illimitato'
      : `${e.radius.value} km`;
  }

  /* ---------- Status ---------- */

  function renderStatus(meta) {
    const e = els();
    const extraction = meta.extractionDate
      ? meta.extractionDate.split('-').reverse().join('/')
      : '—';
    const priceTs = meta.pricesUpdatedAt ? new Date(meta.pricesUpdatedAt).getTime() : null;
    const updated =
      priceTs != null
        ? `Prezzi aggiornati al ${fmtDateTime(priceTs)}`
        : `Dati estratti il ${extraction}`;
    const stazioni = `${meta.stationCount || '—'} distributori (BG)`;

    let html = `<div>${esc(updated)}</div><div>${stazioni}`;
    if (meta.stale) html += ` · <span class="stale">${CONFIG.STRINGS.stale}</span>`;
    html += `</div>`;

    // bottone aggiorna
    html += `<div style="margin-top:6px"><button id="btn-refresh" type="button">↻ Aggiorna dati</button></div>`;
    e.status.innerHTML = html;
    document.getElementById('btn-refresh').addEventListener('click', async () => {
      const btn = document.getElementById('btn-refresh');
      btn.disabled = true;
      btn.textContent = '⏳ Aggiornamento...';
      const ok = await Data.forceRefresh();
      btn.disabled = false;
      btn.textContent = '↻ Aggiorna dati';
      if (ok) {
        MapView.toast(CONFIG.STRINGS.refreshOk);
        document.dispatchEvent(new CustomEvent('benzina:refresh'));
      } else {
        MapView.toast(CONFIG.STRINGS.refreshErr, true);
      }
    });
  }

  /* ---------- Legenda ---------- */

  function renderLegend(minP, maxP) {
    const e = els();
    if (!e.legend) return;
    if (minP == null || maxP == null || !isFinite(minP) || !isFinite(maxP)) {
      e.legend.innerHTML = '<div class="caption">Nessun prezzo disponibile per il carburante selezionato.</div>';
      return;
    }
    const mid = (minP + maxP) / 2;
    e.legend.innerHTML = `
      <div class="gradient"></div>
      <div class="ticks">
        <span>${formatPrice(minP)}</span>
        <span>${formatPrice(mid)}</span>
        <span>${formatPrice(maxP)}</span>
      </div>
      <div class="caption">Verde = più conveniente · Rosso = più caro</div>`;
  }

  /* ---------- Classifica ---------- */

  function renderList(ranking, state) {
    const e = els();
    const { list, minP, maxP } = ranking;

    e.rankingCount.textContent =
      list.length === 1 ? '1 distributore' : `${list.length} distributori`;

    if (!list.length) {
      e.ranking.innerHTML = `<div id="ranking-empty">${esc(CONFIG.STRINGS.noData)}</div>`;
      return;
    }

    let html = '';
    const shown = Math.min(list.length, 50);
    for (let i = 0; i < shown; i++) {
      const item = list[i];
      const st = item.station;
      const color = MapView.colorForPrice(item.price, minP, maxP);
      const selfLabel = item.isSelf === 1 || (state.selfOnly && item.isSelf === 1) ? 'self' : '';
      const isFav = Favorites.has(st.id);
      html += `
        <div class="station-row" data-id="${st.id}" role="button" tabindex="0" aria-label="Seleziona ${escAttr(st.nomeImpianto)}">
          <button class="row-fav${isFav ? ' active' : ''}" data-fav="${st.id}" title="${isFav ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}" aria-label="${isFav ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}">${isFav ? '♥' : '♡'}</button>
          <span class="row-rank">${i + 1}</span>
          <span class="row-price" style="background:${color}">${formatPrice(item.price)}</span>
          <div class="row-info">
            <div class="row-name">${esc(st.nomeImpianto || st.gestore)}</div>
            <div class="row-meta">
              <span>${esc(st.comune)}</span>
              <span>${esc(st.bandiera)}</span>
              ${item.dist != null ? `<span>· ${formatKm(item.dist)}</span>` : ''}
              ${selfLabel ? '<span class="self-badge">self</span>' : ''}
            </div>
          </div>
        </div>`;
    }
    if (list.length > 50) {
      html += `<button id="btn-more" type="button" style="margin:8px 4px 0">Mostra altri ${list.length - 50}...</button>`;
    }

    e.ranking.innerHTML = html;
    e.ranking.removeEventListener('click', onRowClick);
    e.ranking.addEventListener('click', onRowClick);
    e.ranking.removeEventListener('keydown', onRowKey);
    e.ranking.addEventListener('keydown', onRowKey);
  }

  function onRowClick(ev) {
    // Toggle preferito
    const favBtn = ev.target.closest('.row-fav');
    if (favBtn) {
      ev.stopPropagation();
      const id = favBtn.dataset.fav;
      const added = Favorites.toggle(id);
      favBtn.classList.toggle('active', added);
      favBtn.textContent = added ? '♥' : '♡';
      favBtn.title = added ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti';
      return;
    }

    const row = ev.target.closest('.station-row');
    if (!row) {
      if (ev.target.id === 'btn-more') {
        // espandi a tutti: rimuovi il pulsante e ricarica senza limite
        const btn = document.getElementById('btn-more');
        if (btn) btn.remove();
        reRenderAll();
      }
      return;
    }
    selectRow(row.dataset.id);
  }

  function onRowKey(ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const row = ev.target.closest('.station-row');
    if (row) selectRow(row.dataset.id);
  }

  function selectRow(id) {
    const e = els();
    const st = Data.getStationsById().get(id);
    if (!st) return;

    e.ranking.querySelectorAll('.station-row').forEach((r) => r.classList.remove('selected'));
    const row = e.ranking.querySelector(`.station-row[data-id="${id}"]`);
    if (row) row.classList.add('selected');

    MapView.flyToStation(st);
    // apre (o aggiorna) il popup: riusa il marker? Creiamo un popup standalone
    MapView.toast(`${st.nomeImpianto || st.gestore} — ${st.comune}`);
    closeDrawer();
  }

  /* ---------- Pannello Preferiti ---------- */

  /** Rende l'elenco dei preferiti nella sezione dedicata (#fav-box). */
  function renderFavPanel() {
    const e = els();
    const count = e.favCount || document.getElementById('fav-count');
    const list = document.getElementById('fav-list');
    if (!list) return;

    const favIds = Favorites.getAll();
    if (count) count.textContent = String(favIds.length);

    if (!favIds.length) {
      list.innerHTML = `<div id="fav-empty">${esc(CONFIG.STRINGS.favEmpty)}</div>`;
      return;
    }

    const state = readFilters();
    const byId = Data.getStationsById();
    const rows = [];
    for (const id of favIds) {
      const st = byId.get(id);
      if (!st) continue; // preferito sfuggito ai dati (es. stazione rimossa)
      const info = Data.bestPriceInfo(id, state.fuel, state.selfOnly);
      const price = info ? info.prezzo : null;
      const selfLabel = info && info.isSelf === 1 ? 'self' : '';
      rows.push({ id: st.id, name: st.nomeImpianto || st.gestore, comune: st.comune, bandiera: st.bandiera, price, selfLabel, isSelf: info ? info.isSelf : 0 });
    }
    rows.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));

    list.innerHTML = rows
      .map(
        (r) => `
        <div class="station-row fav-row" data-id="${r.id}" role="button" tabindex="0" aria-label="Seleziona ${escAttr(r.name)}">
          <button class="row-remove" data-remove-fav="${r.id}" title="Rimuovi dai preferiti" aria-label="Rimuovi dai preferiti">✕</button>
          <span class="row-price" style="${r.price == null ? '' : `background:${MapView.colorForPrice(r.price, rowsMin(rows) , rowsMax(rows))}`}">${r.price == null ? '—' : formatPrice(r.price)}</span>
          <div class="row-info">
            <div class="row-name">${esc(r.name)}</div>
            <div class="row-meta">
              <span>${esc(r.comune)}</span>
              <span>${esc(r.bandiera)}</span>
              ${r.selfLabel ? '<span class="self-badge">self</span>' : ''}
            </div>
          </div>
        </div>`
      )
      .join('');

    // click riga → seleziona sulla mappa; pulsante ✕ → rimuove
    list.removeEventListener('click', onFavListClick);
    list.addEventListener('click', onFavListClick);
    list.removeEventListener('keydown', onFavKey);
    list.addEventListener('keydown', onFavKey);
  }

  // helper per minimo/massimo del pannello preferiti
  function rowsMin(rows) {
    let m = Infinity;
    for (const r of rows) if (r.price != null && r.price < m) m = r.price;
    return Number.isFinite(m) ? m : null;
  }
  function rowsMax(rows) {
    let m = -Infinity;
    for (const r of rows) if (r.price != null && r.price > m) m = r.price;
    return Number.isFinite(m) ? m : null;
  }

  function onFavListClick(ev) {
    const rmBtn = ev.target.closest('[data-remove-fav]');
    if (rmBtn) {
      ev.stopPropagation();
      const id = rmBtn.dataset.removeFav;
      Favorites.toggle(id); // rimuove (toggle ottimistico)
      renderFavPanel();
      return;
    }
    const row = ev.target.closest('.fav-row');
    if (row) selectRow(row.dataset.id);
  }

  function onFavKey(ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const row = ev.target.closest('.fav-row');
    if (row) selectRow(row.dataset.id);
  }

  /* ---------- Drawer mobile ---------- */

  function openDrawer() {
    const e = els();
    e.sidebar.classList.add('open');
    e.drawerBackdrop.hidden = false;
  }
  function closeDrawer() {
    const e = els();
    e.sidebar.classList.remove('open');
    e.drawerBackdrop.hidden = true;
  }

  /* ---------- Legame con app ---------- */

  let reRenderAll = () => {};
  let lastRankingRef = null;
  let lastStateRef = null;
  let onLocationSearch = null;
  let onSortChange = null;

  function bindHandlers({ onFiltersChange, onRenderAll, onLocationSearch: locSearch, onSortChange: sortHandler }) {
    const e = els();
    reRenderAll = onRenderAll;
    onLocationSearch = locSearch;
    onSortChange = sortHandler;

    e.fuel.addEventListener('change', onFiltersChange);
    e.radius.addEventListener('input', onFiltersChange);
    e.unlimited.addEventListener('change', () => {
      renderRadiusLabel();
      onFiltersChange();
    });
    e.self.addEventListener('change', onFiltersChange);
    if (e.favoritesOnly) e.favoritesOnly.addEventListener('change', onFiltersChange);
    e.search.addEventListener('input', onFiltersChange);
    e.brands.addEventListener('click', (ev) => {
      const chip = ev.target.closest('.chip');
      if (!chip) return;
      chip.classList.toggle('active');
      onFiltersChange();
    });

    e.drawerToggle.addEventListener('click', () => {
      e.sidebar.classList.contains('open') ? closeDrawer() : openDrawer();
    });
    e.drawerBackdrop.addEventListener('click', closeDrawer);

    // click su filtri per riposizionare la mappa sui risultati
    document.getElementById('locate-btn').addEventListener('click', onLocate);

    // Posizione utente (geocoding indirizzo)
    e.locationBtn.addEventListener('click', () => doLocationSearch());
    e.locationInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') doLocationSearch();
    });

    // Ordinamento classifica
    const sortBtns = [e.sortAsc, e.sortDesc];
    for (const b of sortBtns) {
      b.addEventListener('click', () => {
        sortBtns.forEach((x) => {
          const on = x === b;
          x.classList.toggle('active', on);
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        if (onSortChange) onSortChange(b.dataset.sort);
      });
    }

    // Esporta CSV
    const exportBtn = document.getElementById('btn-export');
    if (exportBtn) exportBtn.addEventListener('click', () => exportCsv());
  }

  async function doLocationSearch() {
    const e = els();
    const query = e.locationInput.value.trim();
    if (!query) return;

    e.locationBtn.disabled = true;
    e.locationStatus.hidden = false;
    e.locationStatus.className = 'location-status';
    e.locationStatus.textContent = 'Ricerca...';

    try {
      const result = await geocodeAddress(query);
      // Mostra solo via e comune (primi 2 pezzi dell'indirizzo Nominatim)
      const parts = result.displayName.split(',').map(s => s.trim());
      const short = parts.length > 2 ? `${parts[0]}, ${parts[parts.length - 3] || parts[1]}` : result.displayName;
      e.locationStatus.className = 'location-status';
      e.locationStatus.textContent = short;
      if (onLocationSearch) onLocationSearch(result);
    } catch (err) {
      e.locationStatus.className = 'location-status error';
      e.locationStatus.textContent = err.message;
    } finally {
      e.locationBtn.disabled = false;
    }
  }

  /* ---------- Esporta CSV ---------- */

  function exportCsv() {
    if (!lastRankingRef || !lastRankingRef.list.length) {
      MapView.toast('Nessun dato da esportare.', true);
      return;
    }
    const fuel = lastStateRef ? lastStateRef.fuel : 'Benzina';
    const rows = lastRankingRef.list;
    const lines = ['Posizione;Nome;Indirizzo;Comune;Bandiera;Prezzo (€/L);Carburante;Tipo;Distanza (km)'];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const st = r.station;
      const tipo = r.isSelf === 1 ? 'Self' : 'Servito';
      const dist = r.dist != null ? r.dist.toFixed(1).replace('.', ',') : '';
      const price = r.price != null ? r.price.toFixed(3).replace('.', ',') : '';
      lines.push(`${i + 1};${csvEsc(st.nomeImpianto || st.gestore)};${csvEsc(st.indirizzo)};${csvEsc(st.comune)};${csvEsc(st.bandiera)};${price};${csvEsc(fuel)};${tipo};${dist}`);
    }
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `BenzinaBergamo_${fuel.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    MapView.toast(`CSV esportato (${rows.length} distributori)`);
  }

  function csvEsc(s) {
    if (!s) return '';
    s = String(s);
    if (s.includes(';') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  let onLocate = () => {};
  function setLocateHandler(fn) {
    onLocate = fn;
  }

  return {
    renderFuelOptions,
    renderBrandChips,
    renderRadiusLabel,
    readFilters,
    renderStatus,
    renderLegend,
    renderList,
    renderFavPanel,
    setRankingRef(ranking, state) { lastRankingRef = ranking; lastStateRef = state; },
    bindHandlers,
    setLocateHandler,
    openDrawer,
    closeDrawer,
    showLocationStatus(text, isError) {
      const e = els();
      e.locationStatus.hidden = false;
      e.locationStatus.className = isError ? 'location-status error' : 'location-status';
      e.locationStatus.textContent = text;
    },
    clearLocationStatus() {
      const e = els();
      e.locationStatus.hidden = true;
      e.locationStatus.textContent = '';
    },
  };
})();