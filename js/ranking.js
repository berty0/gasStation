/**
 * Classifica pesata prezzo + distanza.
 * Dipende da: config.js (RANK weights), geo.js (distanceKm), data.js (bestPrice).
 */
'use strict';

const Ranking = (() => {
  /** Filtra e ordina le stazioni attive. Restituisce lista + dati normalizzazione. */
  function compute(state, sortDir) {
    const {
      fuel,
      radiusKm,
      radiusUnlimited,
      userPos,
      center,  // centro mappa (fallback geolocalizzazione)
      selfOnly,
      brands,
      search,
    } = state;

    const origin = userPos || center;
    const searchLower = (search || '').toLowerCase();

    const results = [];

    for (const st of Data.getStations()) {
      // Filtro marche
      if (brands.length && !brands.includes(st.bandiera)) continue;

      // Filtro ricerca
      if (searchLower) {
        const hay = `${st.nomeImpianto} ${st.indirizzo} ${st.comune} ${st.bandiera} ${st.gestore}`.toLowerCase();
        if (!hay.includes(searchLower)) continue;
      }

      const info = Data.bestPriceInfo(st.id, fuel, selfOnly);
      if (info == null) continue;
      const price = info.prezzo;

      const dist = origin ? Geo.distanceKm(origin, { lat: st.lat, lng: st.lng }) : null;
      if (!radiusUnlimited && dist != null && dist > radiusKm) continue;

      results.push({ station: st, price, dist, isSelf: info.isSelf });
    }

    // Dati per normalizzazione
    const prices = results.map((r) => r.price);
    const minP = prices.length ? Math.min(...prices) : 0;
    const maxP = prices.length ? Math.max(...prices) : 0;
    const dists = results.filter((r) => r.dist != null).map((r) => r.dist);
    const maxD = dists.length ? Math.max(...dists) : 1;

    const wp = CONFIG.RANK.priceWeight;
    const wd = CONFIG.RANK.distanceWeight;
    const priceRange = Math.max(1e-6, maxP - minP);

    for (const r of results) {
      const np = (r.price - minP) / priceRange;
      const nd = r.dist != null ? Math.min(1, r.dist / maxD) : 0;
      r.score = wp * np + wd * nd;
    }

    // Ordina per prezzo (asc = più economico, desc = più costoso); tiebreak su distanza/id
    const pd = sortDir === 'desc' ? -1 : 1;
    results.sort((a, b) => (a.price - b.price) * pd || (a.dist ?? Infinity) - (b.dist ?? Infinity) || a.station.id.localeCompare(b.station.id));

    return { list: results, minP, maxP };
  }

  return { compute };
})();