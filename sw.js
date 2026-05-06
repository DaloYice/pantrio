// Pantrio – Service Worker
// Strategie:
//   - Same-origin App-Shell (HTML/CSS/JS, Manifest, Icon): network-first.
//     Holt immer die aktuelle Version vom Netz; Cache nur als Offline-Fallback.
//     Vermeidet Versions-Mismatch zwischen index.html und app.js/css beim Deploy.
//   - Cross-origin (Firebase, Google Fonts, reCAPTCHA): NICHT abgefangen,
//     gehen direkt zum Netzwerk – keine Token-Caching-Probleme.

const CACHE = 'pantrio-shell-v7';
const SHELL = [
  '/',
  '/index.html',
  '/app.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let Firebase / Fonts hit the network directly

  event.respondWith(
    (async () => {
      try {
        const network = await fetch(req);
        if (network && network.ok && network.type === 'basic') {
          const cache = await caches.open(CACHE);
          cache.put(req, network.clone());
        }
        return network;
      } catch (e) {
        const cached = await caches.match(req);
        if (cached) return cached;
        throw e;
      }
    })()
  );
});
