/**
 * Fetch layer, cache localStorage e costruzione indici prezzi.
 * Supporta due modalità:
 *   1) Backend Node.js (prefissi /api/)
 *   2) Fallback: fetch diretto CSV da MIMIT via proxy CORS
 * Dipende da: config.js.
 */
'use strict';

const Data = (() => {
  /* ---------- Fetch con retry ---------- */

  async function fetchJson(url, { retries = 3, baseDelay = 600, timeoutMs = 30000 } = {}) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(t);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        lastErr = err;
        if (i < retries - 1) await new Promise((r) => setTimeout(r, baseDelay * 2 ** i));
      }
    }
    throw lastErr;
  }

  async function fetchText(url, { timeoutMs = 90000 } = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status} per ${url}`);
    return await res.text();
  }

  /* ---------- Cache localStorage ---------- */

  function lsKey(type) {
    return `${CONFIG.LS_KEY}:${type}`;
  }
  function lsSave(type, data) {
    try {
      localStorage.setItem(
        lsKey(type),
        JSON.stringify({ ts: Date.now(), data })
      );
    } catch { /* quota exceeded, ignora */ }
  }
  function lsLoad(type) {
    try {
      const raw = localStorage.getItem(lsKey(type));
      if (!raw) return null;
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts > CONFIG.LS_TTL_MS) return null;
      return data;
    } catch {
      return null;
    }
  }

  /* ---------- CSV parser client-side (replica server.js) ---------- */

  /** Pipe-separated CSV, gestisce apici doppi e "" escaped. */
  function parseCsvLine(line) {
    const fields = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === '|') {
        fields.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    fields.push(cur);
    return fields;
  }

  /** "DD/MM/YYYY HH:MM:SS" → epoch ms (ora locale Italia). */
  function parseDtComu(s) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2}):(\d{2})$/.exec((s || '').trim());
    if (!m) return null;
    const [, d, mo, y, h, mi, se] = m;
    return new Date(+y, +mo - 1, +d, +h, +mi, +se).getTime();
  }

  /* ---------- Fetch da MIMIT via proxy CORS ---------- */

  const PROVINCIA_BG = 'BG';

  async function fetchMimitCsv(url) {
    // Prova ogni proxy in sequenza finché uno non risponde.
    let lastErr;
    for (const base of CONFIG.MIMIT.proxies) {
      try {
        const proxyUrl = base + encodeURIComponent(url);
        return await fetchText(proxyUrl, { timeoutMs: CONFIG.MIMIT.proxyTimeout });
      } catch (err) {
        lastErr = err;
        console.warn(`[Data] Proxy fallito (${base}): ${err.message}`);
      }
    }
    if (lastErr) throw lastErr;
    throw new Error('Nessun proxy CORS disponibile.');
  }

  async function parseAnagraficaMimit(csvText) {
    const lines = csvText.split(/\r?\n/);
    const col = {};
    let sawHeader = false;
    let extractionDate = null;
    const stations = [];
    let skippedNoCoords = 0;

    for (const raw of lines) {
      const line = raw.replace(/^﻿/, '').trimEnd();
      if (!line) continue;

      const mExt = /^Estrazione del\s+(\d{4}-\d{2}-\d{2})/.exec(line);
      if (mExt) {
        extractionDate = extractionDate || mExt[1];
        continue;
      }
      if (!sawHeader) {
        if (!line.startsWith('idImpianto|')) continue;
        sawHeader = true;
        const headers = parseCsvLine(line);
        headers.forEach((h, i) => { col[h.trim()] = i; });
        continue;
      }

      const f = parseCsvLine(line);
      const provincia = (f[col.Provincia] || '').trim();
      if (provincia !== PROVINCIA_BG) continue;

      const id = (f[col.idImpianto] || '').trim();
      const lat = parseFloat(f[col.Latitudine]);
      const lng = parseFloat(f[col.Longitudine]);
      if (!id || Number.isNaN(lat) || Number.isNaN(lng)) {
        skippedNoCoords++;
        continue;
      }

      stations.push({
        id,
        gestore: (f[col.Gestore] || '').trim(),
        bandiera: (f[col.Bandiera] || '').trim(),
        tipoImpianto: (f[col['Tipo Impianto']] || '').trim(),
        nomeImpianto: (f[col['Nome Impianto']] || '').trim(),
        indirizzo: (f[col.Indirizzo] || '').trim(),
        comune: (f[col.Comune] || '').trim(),
        lat,
        lng,
      });
    }

    console.log(`[Data] MIMIT anagrafica BG: ${stations.length} impianti (${skippedNoCoords} scartati)`);
    return { stations, extractionDate };
  }

  async function parsePrezziMimit(csvText, bgIds) {
    const lines = csvText.split(/\r?\n/);
    const col = {};
    let sawHeader = false;
    const rows = new Map(); // key `${id}|${carburante}|${isSelf}` → riga
    let dropped = 0;

    for (const raw of lines) {
      const line = raw.replace(/^﻿/, '').trimEnd();
      if (!line) continue;
      if (line.startsWith('Estrazione del')) continue;
      if (!sawHeader) {
        if (!line.startsWith('idImpianto|')) continue;
        sawHeader = true;
        const headers = parseCsvLine(line);
        headers.forEach((h, i) => { col[h.trim()] = i; });
        continue;
      }

      const f = parseCsvLine(line);
      const id = (f[col.idImpianto] || '').trim();
      if (!bgIds.has(id)) continue;

      const carburante = (f[col.descCarburante] || '').trim();
      const prezzo = parseFloat(f[col.prezzo]);
      if (!carburante || Number.isNaN(prezzo)) {
        dropped++;
        continue;
      }
      const isSelf = (f[col.isSelf] || '').trim() === '1' ? 1 : 0;
      const dtComu = (f[col.dtComu] || '').trim();
      const ts = parseDtComu(dtComu);

      const key = `${id}|${carburante}|${isSelf}`;
      const prev = rows.get(key);
      if (prev && ts != null && prev.ts != null && ts < prev.ts) continue;
      rows.set(key, { id, carburante, prezzo, isSelf, dtComu, ts });
    }

    console.log(`[Data] MIMIT prezzi BG: ${rows.size} righe (${dropped} scartate)`);
    return { prezzi: Array.from(rows.values()) };
  }

  async function loadFromMimit() {
    console.log('[Data] Backend non raggiungibile, carico direttamente da MIMIT via proxy CORS...');

    const csvAnag = await fetchMimitCsv(CONFIG.MIMIT.anagrafica);
    const anag = await parseAnagraficaMimit(csvAnag);
    const bgIds = new Set(anag.stations.map((s) => s.id));

    const csvPrezzi = await fetchMimitCsv(CONFIG.MIMIT.prezzi);
    const prix = await parsePrezziMimit(csvPrezzi, bgIds);

    const min = prix.prezzi.reduce((acc, p) => (p.ts != null && (acc === null || p.ts < acc) ? p.ts : acc), null);
    const max = prix.prezzi.reduce((acc, p) => (p.ts != null && (acc === null || p.ts > acc) ? p.ts : acc), null);

    return {
      anag: { meta: { source: 'MIMIT (proxy CORS)', extractionDate: anag.extractionDate, stationCount: anag.stations.length }, stations: anag.stations },
      prix: { meta: { source: 'MIMIT (proxy CORS)', prezziCount: prix.prezzi.length, pricesUpdatedAt: max ? new Date(max).toISOString() : null }, prezzi: prix.prezzi },
    };
  }

  /* ---------- Cache locale (data/cache.json) ---------- */

  /**
   * Legge la cache già elaborata da server.js (data/cache.json) e la
   * rimodella nel formato delle risposte API ({anag, prix}).
   * Percorso statico: funziona con Live Server e anche offline.
   */
  async function loadFromLocalCache() {
    console.log('[Data] Leggo la cache locale (data/cache.json)...');
    const raw = await fetchText(CONFIG.LOCAL_CACHE.path, { timeoutMs: CONFIG.LOCAL_CACHE.timeoutMs });
    const cache = JSON.parse(raw);
    if (!cache || !Array.isArray(cache.stations) || !Array.isArray(cache.prezzi)) {
      throw new Error('Cache locale non valida');
    }
    const pMin = cache.prezzoMinTs != null ? new Date(cache.prezzoMinTs) : null;
    const pMax = cache.prezzoMaxTs != null ? new Date(cache.prezzoMaxTs) : null;
    const anag = {
      meta: {
        source: 'cache locale (data/cache.json)',
        extractionDate: cache.extractionDate || null,
        stationCount: cache.stations.length,
      },
      stations: cache.stations,
    };
    const prix = {
      meta: {
        source: 'cache locale (data/cache.json)',
        prezziCount: cache.prezzi.length,
        pricesUpdatedAt: pMax ? pMax.toISOString() : null,
      },
      prezzi: cache.prezzi,
    };
    console.log(`[Data] Cache locale: ${cache.stations.length} impianti BG, ${cache.prezzi.length} prezzi`);
    return { anag, prix };
  }

  /* ---------- Indici interni ---------- */

  let stations = [];
  let stationsById = new Map();   // id → station
  let pricesByStation = new Map(); // id → { fuels: Map<carburante, {self|null, servito|null}> }
  let allFuels = [];
  let allBrands = [];
  let meta = {};

  /** Costruisci indici a partire da anagrafica + prezzi grezzi (risposte API JSON). */
  function buildIndexes(anagResponse, prixResponse) {
    stations = anagResponse.stations || [];
    const prezzi = prixResponse.prezzi || [];

    stationsById = new Map(stations.map((s) => [s.id, s]));
    pricesByStation = new Map();

    for (const st of stations) {
      pricesByStation.set(st.id, { fuels: new Map() });
    }

    for (const p of prezzi) {
      const entry = pricesByStation.get(p.id);
      if (!entry) continue;
      let fuelMap = entry.fuels.get(p.carburante);
      if (!fuelMap) {
        fuelMap = { self: null, servito: null };
        entry.fuels.set(p.carburante, fuelMap);
      }
      if (p.isSelf) fuelMap.self = p;
      else fuelMap.servito = p;
    }

    // Trova tutti i carburanti effettivamente presenti, in ordine di priority
    const seen = new Set();
    for (const entry of pricesByStation.values()) {
      for (const f of entry.fuels.keys()) seen.add(f);
    }
    allFuels = Array.from(seen).sort((a, b) => {
      const ia = CONFIG.FUEL_PRIORITY.indexOf(a);
      const ib = CONFIG.FUEL_PRIORITY.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b, 'it');
    });

    // Marche
    const brandCount = new Map();
    for (const st of stations) {
      brandCount.set(st.bandiera, (brandCount.get(st.bandiera) || 0) + 1);
    }
    allBrands = Array.from(brandCount.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([b]) => b);

    meta = { ...anagResponse.meta, ...prixResponse.meta };
  }

  /* ---------- Caricamento dati ---------- */

  let loaded = false;

  async function loadAll() {
    // Tentativo 1: backend Node.js (rapido, JSON pronto)
    try {
      const [anag, prix] = await Promise.all([
        fetchJson(CONFIG.API.anagrafica, { retries: 1, timeoutMs: 5000 }),
        fetchJson(CONFIG.API.prezzi, { retries: 1, timeoutMs: 5000 }),
      ]);
      lsSave('anagrafica', anag);
      lsSave('prezzi', prix);
      buildIndexes(anag, prix);
      loaded = true;
      return meta;
    } catch {
      console.log('[Data] Backend non raggiungibile, provo fallback...');
    }

    // Tentativo 2: cache locale elaborata da server.js (data/cache.json).
    // Veloce e affidabile con Live Server (file statico), senza proxy.
    try {
      const { anag, prix } = await loadFromLocalCache();
      lsSave('anagrafica', anag);
      lsSave('prezzi', prix);
      buildIndexes(anag, prix);
      loaded = true;
      return meta;
    } catch (err2) {
      console.error('[Data] Cache locale non disponibile:', err2.message);
    }

    // Tentativo 3: fetch diretto da MIMIT via proxy CORS (lento, instabile).
    try {
      const { anag, prix } = await loadFromMimit();
      lsSave('anagrafica', anag);
      lsSave('prezzi', prix);
      buildIndexes(anag, prix);
      loaded = true;
      return meta;
    } catch (err3) {
      console.error('[Data] Fallback MIMIT fallito:', err3.message);
    }

    throw new Error('Impossibile caricare i dati. Verifica la connessione e riprova.');
  }

  async function ensureLoaded() {
    if (loaded) return meta;
    try {
      return await loadAll();
    } catch {
      // Fallback localStorage
      const anag = lsLoad('anagrafica');
      const prix = lsLoad('prezzi');
      if (!anag || !prix) throw new Error('Impossibile caricare i dati (nessuna connessione e nessuna cache).');
      buildIndexes(anag, prix);
      loaded = true;
      return meta;
    }
  }

  /* ---------- Aggiornamento forzato ---------- */

  async function forceRefresh() {
    // Tentativo 1: backend
    try {
      const json = await fetchJson(CONFIG.API.refresh, { retries: 1, timeoutMs: 45000 });
      const anagJson = await fetchJson(CONFIG.API.anagrafica);
      const prixJson = await fetchJson(CONFIG.API.prezzi);
      lsSave('anagrafica', anagJson);
      lsSave('prezzi', prixJson);
      buildIndexes(anagJson, prixJson);
      meta = { ...anagJson.meta, ...prixJson.meta };
      return true;
    } catch {
      // fallthrough a fallback
    }

    // Tentativo 2: cache locale (aggiornata dal server)
    try {
      const { anag, prix } = await loadFromLocalCache();
      lsSave('anagrafica', anag);
      lsSave('prezzi', prix);
      buildIndexes(anag, prix);
      return true;
    } catch {
      // fallthrough
    }

    // Tentativo 3: MIMIT diretto
    try {
      const { anag, prix } = await loadFromMimit();
      lsSave('anagrafica', anag);
      lsSave('prezzi', prix);
      buildIndexes(anag, prix);
      return true;
    } catch {
      return false;
    }
  }

  /* ---------- Query aiuti ---------- */

  /** Miglior prezzo (€/L) per una stazione e carburante.
   *  Se selfOnly → solo prezzo self (se esiste, altrimenti servito come fallback).
   *  Altrimenti → il minimo dei due.
   *  Restituisce { prezzo, isSelf, dtComu, ts } oppure null. */
  function bestPriceInfo(stationId, fuel, selfOnly = false) {
    const entry = pricesByStation.get(stationId);
    if (!entry) return null;
    const fm = entry.fuels.get(fuel);
    if (!fm) return null;
    if (selfOnly) {
      if (fm.self) return fm.self;
      if (fm.servito) return { ...fm.servito, isSelf: 0 };
      return null;
    }
    if (fm.self && fm.servito) {
      return fm.self.prezzo <= fm.servito.prezzo ? fm.self : fm.servito;
    }
    return fm.self || fm.servito || null;
  }

  /** Prezzo come numero semplice (per compatibilità). */
  function bestPrice(stationId, fuel, selfOnly = false) {
    const info = bestPriceInfo(stationId, fuel, selfOnly);
    return info ? info.prezzo : null;
  }

  /** Info prezzi per popup (self + servito, per ogni carburante della stazione). */
  function pricesForPopup(stationId) {
    const entry = pricesByStation.get(stationId);
    if (!entry) return [];
    const out = [];
    for (const [carb, fm] of entry.fuels) {
      out.push({
        carburante: carb,
        self: fm.self ? { prezzo: fm.self.prezzo, dtComu: fm.self.dtComu, ts: fm.self.ts } : null,
        servito: fm.servito ? { prezzo: fm.servito.prezzo, dtComu: fm.servito.dtComu, ts: fm.servito.ts } : null,
      });
    }
    // Ordina per FUEL_PRIORITY
    out.sort((a, b) => {
      const ia = CONFIG.FUEL_PRIORITY.indexOf(a.carburante);
      const ib = CONFIG.FUEL_PRIORITY.indexOf(b.carburante);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.carburante.localeCompare(b.carburante, 'it');
    });
    return out;
  }

  return {
    ensureLoaded,
    forceRefresh,
    bestPrice,
    bestPriceInfo,
    pricesForPopup,
    getAllFuels: () => allFuels,
    getAllBrands: () => allBrands,
    getStations: () => stations,
    getStationsById: () => stationsById,
    getMeta: () => meta,
    isLoaded: () => loaded,
  };
})();
