/**
 * BenzinaBergamo — server (zero dipendenze)
 *
 * Scarica i dataset open dati del Ministero (MIMIT) per i prezzi carburanti,
 * li filtra sulla sola provincia di Bergamo (BG) e li espone come JSON al
 * frontend con header CORS (il ministero non li serve, quindi serve un backend).
 *
 * Endpoint:
 *   GET /api/anagrafica  → elenco impianti BG
 *   GET /api/prezzi      → prezzi filtrati agli impianti BG
 *   GET /api/fuels       → elenco carburanti disponibili
 *   GET /api/refresh     → forza un aggiornamento dati (mint sincrono)
 *   GET /api/health      → stato cache
 *   /*                   → file statici dell'app (index.html, css/, js/)
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Readable } = require('stream');
const auth = require('./server/auth');
const report = require('./server/report');

/* -------------------------------------------------------------------------- */
/* Costanti                                                                    */
/* -------------------------------------------------------------------------- */

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const CACHE_FILE = path.join(DATA_DIR, 'cache.json');
const TMP_FILE = path.join(DATA_DIR, 'cache.json.tmp');

const PORT_BASE = parseInt(process.env.PORT, 10) || 8080;
const PORT_MAX_FAIL = 20; // prova fino a PORT_BASE+20

const TTL_MS = 6 * 60 * 60 * 1000; // 6 ore: i prezzi MIMIT escono ogni giorno alle 08:00
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 90 * 1000;

const URL_ANAGRAFICA =
  'https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv';
const URL_PREZZI =
  'https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv';

const PROVINCIA = 'BG';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

/* -------------------------------------------------------------------------- */
/* Incapsulamento cache                                                        */
/* -------------------------------------------------------------------------- */

const cache = {
  data: null, // { mintedAt, extractionDate, stations, prezzi }
  inflight: null,
};

function isFresh() {
  return !!cache.data && Date.now() - cache.data.mintedAt < TTL_MS;
}

/** Aggiorna i dati (single-flight): restituisce payload fresco o cache se fallisce. */
async function refresh() {
  if (cache.inflight) return cache.inflight;
  cache.inflight = (async () => {
    try {
      const payload = await mint();
      cache.data = payload;
      console.log(
        `[BenzinaBergamo] dati aggiornati: ${payload.stations.length} impianti BG, ` +
          `estrazione ${payload.extractionDate || 'n/d'}`
      );
      return payload;
    } catch (err) {
      if (cache.data) {
        console.error(`[BenzinaBergamo] refresh fallito, uso la cache: ${err.message}`);
        return cache.data;
      }
      throw err;
    } finally {
      cache.inflight = null;
    }
  })();
  return cache.inflight;
}

/** Serve dati: fresco → subito; stantio → subito + refresh in background; assente → mint sincrono. */
async function getData() {
  if (cache.data) {
    if (isFresh()) return { ...cache.data, stale: false };
    kickRefresh(); // refresh asincrono: non blocchiamo la richiesta
    return { ...cache.data, stale: true };
  }
  return { ...(await refresh()), stale: false };
}

/** Refresh in background senza bloccare e senza rejection non gestite. */
function kickRefresh() {
  refresh().catch((err) =>
    console.error(`[BenzinaBergamo] refresh in background fallito: ${err.message}`)
  );
}

/* -------------------------------------------------------------------------- */
/* Parsing CSV (streaming)                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Divide una riga CSV rispettando i campi con apici doppi:
 * - "|" dentro gli apici è dato, non separatore
 * - "" dentro un campo quotato è un apice letterale
 */
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

/** dtComu nel formato IT "DD/MM/YYYY HH:MM:SS" → epoch ms (ora locale Italia). */
function parseDtComu(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2}):(\d{2})$/.exec((s || '').trim());
  if (!m) return null;
  const [, d, mo, y, h, mi, se] = m;
  return new Date(+y, +mo - 1, +d, +h, +mi, +se).getTime();
}

function fetchCsv(url) {
  return fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status} per ${url}`);
    return res;
  });
}

/**
 * Scarica ed elabora i due CSV.
 * Order obbligatorio: prima l'anagrafica (serve l'insieme degli id BG),
 * poi i prezzi filtrati per appartenenza all'insieme.
 */
async function mint() {
  const anag = await readAnagrafica();
  const bgIds = new Set(anag.stations.map((s) => s.id));
  const prezzo = await readPrezzi(bgIds);
  const min = prezzo.prezzi.reduce((acc, p) => (p.ts != null && (acc === null || p.ts < acc) ? p.ts : acc), null);
  const max = prezzo.prezzi.reduce((acc, p) => (p.ts != null && (acc === null || p.ts > acc) ? p.ts : acc), null);

  const payload = {
    mintedAt: Date.now(),
    extractionDate: anag.extractionDate,
    stations: anag.stations,
    prezzi: prezzo.prezzi,
    prezzoMinTs: min,
    prezzoMaxTs: max,
  };
  await persist(payload);
  return payload;
}

async function readAnagrafica() {
  const res = await fetchCsv(URL_ANAGRAFICA);
  const rl = readline.createInterface({
    input: Readable.fromWeb(res.body),
    crlfDelay: Infinity,
  });

  const col = {};
  let sawHeader = false;
  let extractionDate = null;
  const stations = [];
  let skippedNoCoords = 0;

  for await (const raw of rl) {
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
      headers.forEach((h, i) => {
        col[h.trim()] = i;
      });
      continue;
    }

    const f = parseCsvLine(line);
    const provincia = (f[col.Provincia] || '').trim();
    if (provincia !== PROVINCIA) continue;

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

  console.log(
    `[BenzinaBergamo] anagrafica BG: ${stations.length} impianti (${skippedNoCoords} scartati senza coordinate)`
  );
  return { stations, extractionDate };
}

async function readPrezzi(bgIds) {
  const res = await fetchCsv(URL_PREZZI);
  const rl = readline.createInterface({
    input: Readable.fromWeb(res.body),
    crlfDelay: Infinity,
  });

  const col = {};
  let sawHeader = false;
  const rows = new Map(); // key `${id}|${carburante}|${isSelf}` → riga
  let dropped = 0;

  for await (const raw of rl) {
    const line = raw.replace(/^﻿/, '').trimEnd();
    if (!line) continue;
    if (line.startsWith('Estrazione del')) continue;
    if (!sawHeader) {
      if (!line.startsWith('idImpianto|')) continue;
      sawHeader = true;
      const headers = parseCsvLine(line);
      headers.forEach((h, i) => {
        col[h.trim()] = i;
      });
      continue;
    }

    const f = parseCsvLine(line);
    const id = (f[col.idImpianto] || '').trim();
    if (!bgIds.has(id)) continue; // join: solo impianti BG

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
    if (prev && ts != null && prev.ts != null && ts < prev.ts) continue; // tieni la trasmissione più recente
    rows.set(key, { id, carburante, prezzo, isSelf, dtComu, ts });
  }

  console.log(
    `[BenzinaBergamo] prezzi BG: ${rows.size} righe (${dropped} righe malformate scartate)`
  );
  return { prezzi: Array.from(rows.values()) };
}

/* -------------------------------------------------------------------------- */
/* Persistenza su disco                                                        */
/* -------------------------------------------------------------------------- */

function persist(payload) {
  return new Promise((resolve, reject) => {
    fs.mkdir(DATA_DIR, { recursive: true }, (err) => {
      if (err) return reject(err);
      const tmp = TMP_FILE;
      const stream = fs.createWriteStream(tmp);
      stream.on('error', reject);
      stream.on('finish', () => {
        fs.rename(tmp, CACHE_FILE, (e) => (e ? reject(e) : resolve()));
      });
      stream.write(JSON.stringify(payload));
      stream.end();
    });
  });
}

function loadFromDisk() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.stations) && Array.isArray(parsed.prezzi)) {
      cache.data = parsed;
      return true;
    }
  } catch {
    /* niente cache su disco */
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* Endpoint dati                                                               */
/* -------------------------------------------------------------------------- */

function fuelsFrom(payload) {
  const PRIORITY = ['Benzina', 'Benzina Plus', 'Gasolio', 'Gasolio Premium', 'GPL', 'Metano', 'GNL', 'L-GNC'];
  const set = new Set(payload.prezzi.map((p) => p.carburante));
  const ordered = Array.from(set).sort((a, b) => {
    const ia = PRIORITY.indexOf(a);
    const ib = PRIORITY.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b, 'it');
  });
  return ordered;
}

function metaFor(payload, extra = {}) {
  return {
    source: 'MIMIT — open data prezzi carburanti',
    updatedAt: new Date(payload.mintedAt).toISOString(),
    extractionDate: payload.extractionDate,
    stale: !!extra.stale,
    province: PROVINCIA,
    stationCount: payload.stations.length,
    prezziCount: payload.prezzi.length,
    pricesUpdatedAt:
      payload.prezzoMaxTs != null ? new Date(payload.prezzoMaxTs).toISOString() : null,
  };
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/**
 * Invia il risultato di un handler auth: { status, body, setCookie?, clearCookie? }.
 * Imposta/esclude il cookie di sessione quando richiesto, poi risponde JSON.
 */
function sendResult(res, result) {
  if (result.setCookie) auth.setSessionCookie(res, result.setCookie);
  if (result.clearCookie) auth.clearSessionCookie(res);
  sendJson(res, result.status, result.body);
}

/** Legge e parsa il body JSON di una POST/PUT (limite dimensione anti-abuso). */
function readBody(req, limit = 16384) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const err = new Error('Body troppo grande.');
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        const err = new Error('JSON non valido.');
        err.statusCode = 400;
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

async function handleApi(url, req, res) {
  const pathname = url.pathname;

  if (pathname === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      cached: !!cache.data,
      fresh: isFresh(),
      updatedAt: cache.data ? new Date(cache.data.mintedAt).toISOString() : null,
      extractionDate: cache.data ? cache.data.extractionDate : null,
      stationCount: cache.data ? cache.data.stations.length : 0,
      cacheFile: fs.existsSync(CACHE_FILE) ? fs.statSync(CACHE_FILE).size : 0,
    });
  }

  if (pathname === '/api/refresh') {
    try {
      const payload = await refresh(); // sincrono: aspetta il mint o la cache
      return sendJson(res, 200, { meta: metaFor(payload), refreshed: !payload._fromCache });
    } catch (err) {
      return sendJson(res, 503, {
        error: 'refresh_failed',
        message: 'Impossibile aggiornare i dati del Ministero in questo momento.',
        detail: err.message,
      });
    }
  }

  if (pathname === '/api/anagrafica' || pathname === '/api/prezzi') {
    try {
      const payload = await getData();
      const meta = metaFor(payload, { stale: payload.stale });
      if (pathname === '/api/anagrafica') {
        return sendJson(res, 200, { meta, stations: payload.stations });
      }
      return sendJson(res, 200, { meta, prezzi: payload.prezzi });
    } catch (err) {
      return sendJson(res, 503, {
        error: 'no_data',
        message: 'Dati non disponibili al momento. Verifica la connessione e riprova fra poco.',
        detail: err.message,
      });
    }
  }

  if (pathname === '/api/fuels') {
    try {
      const payload = await getData();
      return sendJson(res, 200, { meta: metaFor(payload), fuels: fuelsFrom(payload) });
    } catch (err) {
      return sendJson(res, 503, { error: 'no_data', message: 'Dati non disponibili.', detail: err.message });
    }
  }

  if (pathname === '/api/auth/me') {
    return sendResult(res, auth.me(auth.currentUser(req)));
  }

  if (pathname === '/api/user/favorites') {
    const user = auth.currentUser(req);
    if (!user) return sendJson(res, 401, { error: 'unauthorized', message: 'Effettua il login.' });
    return sendResult(res, auth.getFavorites(user));
  }

  if (pathname === '/api/report') {
    const user = auth.currentUser(req);
    if (!user) return sendJson(res, 401, { error: 'unauthorized', message: 'Effettua il login.' });
    if (!user.isAdmin) {
      return sendJson(res, 403, { error: 'forbidden', message: "Solo l'amministratore può vedere il report." });
    }
    return sendJson(res, 200, report.getReport());
  }

  return sendJson(res, 404, { error: 'not_found', message: 'Endpoint non trovato.' });
}

/** Endpoint non GET (POST/PUT/DELETE): auth, preferiti, report. */
async function handleApiPost(url, req, res) {
  const pathname = url.pathname;
  const body = await readBody(req);

  if (pathname === '/api/auth/register') {
    return sendResult(res, auth.register(body));
  }
  if (pathname === '/api/auth/login') {
    return sendResult(res, auth.login(body));
  }
  if (pathname === '/api/auth/logout') {
    return sendResult(res, auth.logout(req));
  }
  if (pathname === '/api/user/favorites' && req.method === 'PUT') {
    const user = auth.currentUser(req);
    if (!user) return sendJson(res, 401, { error: 'unauthorized', message: 'Effettua il login.' });
    return sendResult(res, auth.putFavorites(user, body));
  }
  if (pathname === '/api/report/visit') {
    const user = auth.currentUser(req);
    report.recordVisit(user, req);
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
    return res.end();
  }

  return sendJson(res, 405, { error: 'method_not_allowed', message: 'Metodo non supportato.' });
}

/* -------------------------------------------------------------------------- */
/* File statici                                                                */
/* -------------------------------------------------------------------------- */

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';

  // Blocca artefatti di sistema del progetto (non dovrebbero mai essere serviti)
  if (/^\/\.|^\/server\.js$|^\/server\/|^\/package(?:-lock)?\.json$|^\/README|^\/data\//.test(pathname)) {
    res.writeHead(403, { 'Access-Control-Allow-Origin': '*' });
    return res.end('403 Forbidden');
  }

  const filePath = path.normalize(path.join(ROOT, pathname));
  if (pathname.includes('..') || !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'Access-Control-Allow-Origin': '*' });
    return res.end('403 Forbidden');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      return res.end('404 Non trovato');
    }
    const type = CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': pathname.startsWith('/js/') || pathname.startsWith('/css/') ? 'max-age=60' : 'no-cache',
      'Content-Length': stats.size,
    });
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => res.end());
    stream.pipe(res);
  });
}

/* -------------------------------------------------------------------------- */
/* Server                                                                      */
/* -------------------------------------------------------------------------- */

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Preflight CORS (per richieste POST/PUT con body)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cookie',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }

  if (url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET') {
      handleApiPost(url, req, res).catch((err) =>
        sendJson(res, typeof err.statusCode === 'number' ? err.statusCode : 500, {
          error: 'internal',
          message: err.message,
        })
      );
      return;
    }
    handleApi(url, req, res).catch((err) =>
      sendJson(res, 500, { error: 'internal', message: err.message })
    );
    return;
  }
  serveStatic(req, res, url);
});

function listen(port) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && port < PORT_BASE + PORT_MAX_FAIL) {
      console.warn(`[BenzinaBergamo] porta ${port} occupata, provo ${port + 1}`);
      listen(port + 1);
    } else {
      console.error(`[BenzinaBergamo] errore server: ${err.message}`);
      process.exit(1);
    }
  });
  server.listen(port, () => {
    console.log('─'.repeat(52));
    console.log('  Benvenuto in BenzinaBergamo');
    console.log(`  Apri nel browser:  http://localhost:${port}`);
    console.log('─'.repeat(52));
  });
}

/* Avvio: carica cache da disco (non blocca mai sull'avvio), aggiorna in background. */
if (loadFromDisk()) {
  console.log(
    `[BenzinaBergamo] cache su disco caricata (${cache.data.stations.length} impianti BG, ` +
      `estrazione ${cache.data.extractionDate || 'n/d'})`
  );
} else {
  console.log('[BenzinaBergamo] nessuna cache su disco: scarico i dati open MIMIT...');
}
kickRefresh(); // primo mint in background: la prima richiesta troverà spesso i dati pronti

setInterval(() => kickRefresh(), REFRESH_INTERVAL_MS).unref();

listen(PORT_BASE);