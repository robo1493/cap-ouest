// Service worker : garde l'application (fichiers et Leaflet) pour l'ouvrir sans réseau.
// Augmenter VERSION à chaque publication pour forcer la mise à jour.
const VERSION = 'cap-ouest-v0.6.1';
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/main.js',
  'js/data.js',
  'js/geo.js',
  'js/routing.js',
  'js/stations.js',
  'js/store.js',
  'js/sync.js',
  'js/config.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Fichiers de l'application : réseau d'abord (pour avoir la dernière version), cache si hors ligne.
// Tuiles de carte et calculs de trajet : jamais mis en cache ici.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const isShell = url.origin === location.origin || url.hostname === 'cdnjs.cloudflare.com' || url.hostname === 'cdn.jsdelivr.net';
  if (e.request.method !== 'GET' || !isShell) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
