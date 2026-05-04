// Pantrio – Service Worker
// Strategie:
//   - Same-origin App-Shell (HTML/CSS/JS, Manifest, Icon): stale-while-revalidate.
//     Liefert sofort aus Cache (offline-fähig), aktualisiert im Hintergrund.
//   - Cross-origin (Firebase, Google Fonts, reCAPTCHA): NICHT abgefangen,
//     gehen direkt zum Netzwerk – keine Token-Caching-Probleme.

const CACHE = 'pantrio-shell-v3';
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
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((resp) => {
          if (resp && resp.ok && resp.type === 'basic') {
            cache.put(req, resp.clone());
          }
          return resp;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
