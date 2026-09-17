'use strict';

const VERSION = 'v2';
const STATIC_CACHE = `static-${VERSION}`;
const API_CACHE = `api-${VERSION}`;

const STATIC_ASSETS = [
  './', './index.html',
  './css/style.css',
  './js/config.js', './js/geo.js', './js/data.js', './js/favorites.js',
  './js/ranking.js', './js/map.js', './js/ui.js', './js/app.js',
  './manifest.json', './icons/droplet.svg',
  './icons/icon-192.png', './icons/icon-512.png',
  // Account section
  './account/report.html',
  './account/css/account.css',
  './account/js/auth.js',
  './account/js/report.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => Promise.all(STATIC_ASSETS.map((u) => cache.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== STATIC_CACHE && k !== API_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // API: network-first, cache fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(API_CACHE).then((c) => c.put(request, clone));
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Static: cache-first
  event.respondWith(
    caches.match(request).then((hit) =>
      hit ||
      fetch(request).then((res) => {
        if (res.ok && (url.origin === self.location.origin || url.origin === 'https://unpkg.com')) {
          const clone = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(request, clone));
        }
        return res;
      })
    )
  );
});
