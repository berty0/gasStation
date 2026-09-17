/**
 * Configurazione globale e stringhe UI (italiano).
 * Caricato per primo: nessuna dipendenza.
 */
'use strict';

const CONFIG = {
  API: {
    anagrafica: '/api/anagrafica',
    prezzi: '/api/prezzi',
    fuels: '/api/fuels',
    refresh: '/api/refresh',
    health: '/api/health',
    // Account e report (modulo account/)
    auth: {
      register: '/api/auth/register',
      login: '/api/auth/login',
      logout: '/api/auth/logout',
      me: '/api/auth/me',
      visit: '/api/report/visit',
    },
    favorites: '/api/user/favorites',
    report: '/api/report',
  },

  // Fallback: fetch diretto da MIMIT via proxy CORS (quando il backend non è raggiungibile).
  // I proxy gratuiti sono instabili, quindi ne proviamo diversi in sequenza.
  MIMIT: {
    anagrafica: 'https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv',
    prezzi: 'https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv',
    proxies: [
      'https://corsproxy.io/?url=',
      'https://api.codetabs.com/v1/proxy?quest=',
      'https://cors-anywhere.herokuapp.com/',
      'https://api.allorigins.win/raw?url=',
    ],
    proxyTimeout: 30000,
  },

  // Cache già elaborata (server.js): file statico che Live Server serve senza problemi.
  // Usato come fallback offline/affidabile quando proxy e backend non rispondono.
  LOCAL_CACHE: {
    path: 'data/cache.json',
    timeoutMs: 10000,
  },

  // Centro mappa: Bergamo città
  BERGAMO_CENTER: [45.6983, 9.6773],
  BERGAMO_ZOOM: 11,
  MIN_ZOOM: 9,
  MAX_ZOOM: 19,

  // Cache browser (fallback offline)
  LS_KEY: 'benzina:v1',
  LS_TTL_MS: 6 * 60 * 60 * 1000,

  // Peso di prezzo e distanza nella classifica (score basso = migliore)
  RANK: { priceWeight: 0.7, distanceWeight: 0.3 },

  // Colori leva prezzi (rampa continua HSL verde→rosso)
  COLORS: {
    nodata: '#9e9e9e',
    user: '#1a73e8',
  },

  // Ordine preferito nel selettore carburante (i restanti vanno in coda alfabeticamente)
  FUEL_PRIORITY: [
    'Benzina', 'Benzina Plus', 'Benzina speciale',
    'Gasolio', 'Gasolio Premium', 'Gasolio speciale',
    'GPL', 'Metano', 'GNL', 'L-GNC',
    'HVO', 'HVOlution', 'HVO100', 'HVO Future',
    'Blue Super', 'Blue Diesel', 'Super Diesel', 'Supreme Diesel',
    'Hi-Q Diesel', 'HiQ Perform+', 'Diesel Shell V Power',
  ],

  DEFAULTS: {
    fuel: 'Benzina',
    radiusKm: 15,
    radiusUnlimited: true,
    selfOnly: true,
    search: '',
    brands: [],
  },

  STRINGS: {
    loading: 'Caricamento dati dal Ministero...',
    retry: 'Riprova',
    gpsApprox: 'Posizione approssimativa',
    stale: 'dati non aggiornati',
    updated: (base, priceTs) =>
      priceTs
        ? `Prezzi aggiornati al ${fmtDate(priceTs)}`
        : `Dati aggiornati al ${base}`,
    gpsError: 'Attiva la geolocalizzazione per ordinare per distanza.',
    gpsError2: 'Posizione non disponibile: uso il centro della mappa.',
    noData: 'Nessun distributore in questa area con i filtri selezionati.',
    refreshOk: 'Dati aggiornati.',
    refreshErr: 'Aggiornamento non riuscito, dati invariati.',
    topSelf: 'classifica su self service',
    radiusLegend: 'raggio:',
    coordsFailed: 'Impossibile determinare la posizione.',
    authFailed: 'Operazione non riuscita. Riprova.',
    favOffline: 'Preferiti salvati solo su questo dispositivo.',
    favEmpty: 'Nessun preferito. Clicca la stella per aggiungerne.',
  },
};

/** Formatta timestamp → "gg/mm/aaaa" (data italiana). */
function fmtDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('it-IT');
}

/** Formatta timestamp → "gg/mm/aaaa hh:mm". */
function fmtDateTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString('it-IT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}