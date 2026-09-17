/**
 * Gestione mappa Leaflet: marker, cluster, popup, colore prezzo, posizione utente.
 * Dipende da: config.js, geo.js, data.js.
 */
'use strict';

const MapView = (() => {
  let map = null;
  let clusterGroup = null;
  let userMarker = null;

  /** Ruota per generare il colore di un pin: verde (basso) → rosso (alto). */
  function colorForPrice(price, minP, maxP) {
    if (price == null || !isFinite(price)) return CONFIG.COLORS.nodata;
    const t = maxP > minP ? (price - minP) / (maxP - minP) : 0.5;
    const hue = 120 - t * 120; // 120 (verde) → 0 (rosso)
    return `hsl(${hue}, 70%, 45%)`;
  }

  /* ── Inizializzazione mappa ─────────────────────────────────── */

  function initMap(el) {
    map = L.map(el, {
      center: CONFIG.BERGAMO_CENTER,
      zoom: CONFIG.BERGAMO_ZOOM,
      minZoom: CONFIG.MIN_ZOOM,
      maxZoom: CONFIG.MAX_ZOOM,
      zoomControl: false,
      attributionControl: true,
    });

    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    L.control.attribution({ position: 'bottomright', prefix: 'OSM' }).addTo(map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: CONFIG.MAX_ZOOM,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    clusterGroup = L.markerClusterGroup({
      maxClusterRadius: 55,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      chunkedLoading: true,
      zoomToBoundsOnClick: true,
      disableClusteringAtZoom: 16,
    });
    map.addLayer(clusterGroup);

    return map;
  }

  function getMap() {
    return map;
  }

  /* ── Soppressione re-render durante movimenti programmatici ── */

  /**
   * Imposta il flag che evita re-render (moveend) durante una animazione
   * programmatica (flyTo/fitBounds). Il flag viene rimosso al primo moveend
   * oppure a timeout: se la destinazione coincide con la vista corrente
   * Leaflet può non emettere moveend e senza timeout il flag resterebbe
   * attivo, bloccando ogni aggiornamento della classifica.
   */
  function suppressMoveendRender(durationMs = 1500) {
    map._suppressMoveendRender = true;
    map.once('moveend', () => { map._suppressMoveendRender = false; });
    clearTimeout(suppressMoveendRender._t);
    suppressMoveendRender._t = setTimeout(() => { map._suppressMoveendRender = false; }, durationMs);
  }

  /* ── Rendering marker ───────────────────────────────────────── */

  function renderMarkers(rankingList, minP, maxP, currentFuel) {
    clusterGroup.clearLayers();
    for (const item of rankingList) {
      const st = item.station;
      const color = colorForPrice(item.price, minP, maxP);
      const icon = L.divIcon({
        className: '',
        html: `<div class="price-pin" style="background:${color}"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
      const marker = L.marker([st.lat, st.lng], { icon });
      marker.on('click', () => {
        marker.bindPopup(() => buildPopup(st, item.price, item.dist, currentFuel), {
          maxWidth: 300,
          className: 'popup',
        }).openPopup();
      });
      clusterGroup.addLayer(marker);
    }
  }

  /* ── Popup dinamico ─────────────────────────────────────────── */

  function buildPopup(st, currentPrice, distKm, selectedFuel) {
    const rows = Data.pricesForPopup(st.id);
    const fuel = selectedFuel || CONFIG.DEFAULTS.fuel;

    // Tabella carburanti (solo quelli con almeno un prezzo)
    let table = '';
    for (const r of rows) {
      const selfP = r.self ? `<td>${formatPrice(r.self.prezzo)}</td>` : '<td>—</td>';
      const srvP = r.servito ? `<td>${formatPrice(r.servito.prezzo)}</td>` : '<td>—</td>';
      const latest = r.self?.dtComu || r.servito?.dtComu || '';
      table += `<tr><td>${r.carburante}</td>${selfP}${srvP}</tr>`;
    }

    const distHtml =
      distKm != null
        ? `<div class="dist">Distanza: ${formatKm(distKm)}</div>`
        : '';

    const updated = rows.reduce((acc, r) => {
      const ts = r.self?.ts || r.servito?.ts;
      return ts != null && (acc == null || ts > acc) ? ts : acc;
    }, null);

    return `
      <div class="popup">
        <h3>${esc(st.nomeImpianto || st.gestore)}</h3>
        <div class="addr">${esc(st.indirizzo)}, ${esc(st.comune)} (${esc(st.bandiera)})</div>
        ${distHtml}
        <table>
          <tr><th>Carburante</th><th>Self</th><th>Servito</th></tr>
          ${table}
        </table>
        ${updated ? `<div class="updated">Aggiornato il ${fmtDateTime(updated)}</div>` : ''}
      </div>`;
  }

  /* ── Posizione utente ───────────────────────────────────────── */

  async function locateUser() {
    try {
      const pos = await Geo.getPosition();
      setMarkerUtente(pos);
      suppressMoveendRender();
      map.flyTo([pos.lat, pos.lng], Math.max(map.getZoom(), 14), { duration: 0.8 });
      return pos;
    } catch {
      // geolocalizzazione negata o timeout
      return null;
    }
  }

  function setMarkerUtente(pos) {
    if (userMarker) map.removeLayer(userMarker);
    userMarker = L.marker([pos.lat, pos.lng], {
      icon: L.divIcon({
        className: '',
        html: '<div class="user-dot"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      }),
      interactive: false,
    }).addTo(map);
  }

  function clearUserMarker() {
    if (userMarker) {
      map.removeLayer(userMarker);
      userMarker = null;
    }
  }

  function flyToStation(st) {
    // Flag per evitare re-render da moveend durante volo programmatico
    suppressMoveendRender();
    map.flyTo([st.lat, st.lng], 17, { duration: 0.6 });
  }

  function setMapCenter(pos) {
    suppressMoveendRender();
    map.flyTo([pos.lat, pos.lng], Math.max(map.getZoom(), 14), { duration: 0.8 });
  }

  function fitAll(stations) {
    if (!stations || !stations.length) return;
    suppressMoveendRender();
    const bounds = L.latLngBounds(stations.map((st) => [st.lat, st.lng]));
    map.fitBounds(bounds, { padding: [40, 40] });
  }

  function fitWithUser(stations, userPos) {
    if (!stations || !stations.length) return;
    suppressMoveendRender();
    const pts = stations.map((st) => [st.lat, st.lng]);
    if (userPos) pts.push([userPos.lat, userPos.lng]);
    map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
  }

  /** Aggiorna icona del pulsante GPS in base allo stato. */
  function setLocateBtnLoading(loading) {
    const btn = document.getElementById('locate-btn');
    if (btn) btn.classList.toggle('locate-loading', loading);
  }

  /** Mostra toast. */
  function toast(msg, isError = false, ms = 4000) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    el.className = isError ? 'error' : '';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.hidden = true;
    }, ms);
  }

  return {
    initMap,
    getMap,
    renderMarkers,
    locateUser,
    setMarkerUtente,
    setMapCenter,
    flyToStation,
    fitAll,
    fitWithUser,
    setLocateBtnLoading,
    toast,
    colorForPrice,
  };
})();