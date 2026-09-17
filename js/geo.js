/**
 * Utilità geografiche: distanza, geolocalizzazione, formattazione.
 * Dipende da: config.js (per STRINGS usati da app.js, non qui).
 */
'use strict';

const Geo = {
  /** Distanza Haversine in km tra due coordinate. */
  haversineKm(aLat, aLng, bLat, bLng) {
    const R = 6371;
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  },

  /** Distanza da un punto a una stazione (entrambe {lat,lng}). */
  distanceKm(from, to) {
    if (!from || !to) return null;
    return this.haversineKm(from.lat, from.lng, to.lat, to.lng);
  },

  /** Promisificazione della geolocalizzazione del browser. */
  getPosition(opts) {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) {
        return reject(new Error('geolocation-not-supported'));
      }
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          }),
        (err) => reject(err),
        Object.assign(
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
          opts
        )
      );
    });
  },

  /** {{lat,lng} | null} ➜ punto {lat,lng} interno. */
  toPoint(p) {
    return p && typeof p.lat === 'number' && typeof p.lng === 'number'
      ? { lat: p.lat, lng: p.lng }
      : Array.isArray(p) && typeof p[0] === 'number'
        ? { lat: p[0], lng: p[1] }
        : null;
  },
};

/** Prezzo "1,849" (3 decimali, virgola). */
function formatPrice(p) {
  return (p == null ? '—' : p.toFixed(3)).replace('.', ',');
}

/** Distanza "1,2 km" oppure "850 m". */
function formatKm(km) {
  if (km == null) return '—';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toLocaleString('it-IT', { maximumFractionDigits: 1 })} km`;
}

/** Escape HTML per inject sicuro in template literal. */
function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape per attributi HTML (aggiunge escape di doppi apici). */
function escAttr(s) {
  return esc(s).replace(/"/g, '&quot;');
}

/** Geocoding via Nominatim (OpenStreetMap). Restituisce {lat, lng, displayName}. */
async function geocodeAddress(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&addressdetails=1&countrycodes=it`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`Geocoding fallito: HTTP ${res.status}`);
  const results = await res.json();
  if (!results.length) throw new Error('Indirizzo non trovato. Prova con un indirizzo più specifico.');
  const r = results[0];
  return {
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    displayName: r.display_name,
  };
}