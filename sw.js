// Offline support: cache the game shell so it plays without a connection.
// The page itself (index.html) is fetched fresh whenever we're online, so players get a new
// version (and it gets counted) on the first open after an update; the saved copy is only used
// offline or on a very slow connection. Icons and the manifest are served from the cache and
// refreshed in the background.
// Bump VERSION whenever you want installed copies to drop the old cache.
const VERSION = 'drone-dash-v226';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];
const PAGE_TIMEOUT = 4000;   // ms to wait for the network before falling back to the saved page

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's HTTP cache, so an update really downloads the new files
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Music streams straight from the network (players ask for it in pieces, which a cache can't answer).
  if (new URL(req.url).pathname.includes('/audio/')) return;
  if (req.mode === 'navigate') { e.respondWith(page(req)); return; }
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      // Stale-while-revalidate: answer from cache instantly, update it from the network.
      const fresh = fetch(req)
        .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});

// Network first for the page: 'no-cache' asks GitHub whether it changed (cheap when it hasn't),
// so the browser's own 10-minute cache can't hold an old version back either.
async function page(req) {
  const cache = await caches.open(VERSION);
  const net = fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
    .then((res) => { if (res.ok) cache.put('./index.html', res.clone()); return res; });
  const saved = () => cache.match('./index.html').then((r) => r || cache.match('./'));
  try {
    return await Promise.race([
      net,
      new Promise((_, no) => setTimeout(() => no(new Error('slow')), PAGE_TIMEOUT)),
    ]);
  } catch {
    return (await saved()) || net;   // offline or slow: the saved copy (or keep waiting if there is none)
  }
}
