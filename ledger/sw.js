/* Foresight service worker — offline-capable, update-friendly.
 *
 * Strategy:
 *  - Precache the app shell on install so the app still opens with no network.
 *  - The app DOCUMENT (index.html / navigations) uses NETWORK-FIRST: when you're
 *    online it always fetches the latest deploy, so redeploys show up immediately
 *    (no stale-color problem). Falls back to cache only when offline.
 *  - Other same-origin assets use stale-while-revalidate.
 *  - The AI proxy (/.netlify/functions/*) and any non-GET request are never
 *    cached — extraction and the advisor always hit the network live.
 *
 * Bump CACHE when the shell changes to retire old caches on activate.
 */
const CACHE = 'foresight-v7';
const SHELL = ['./', './index.html', './manifest.json', './icon.svg', './icon-180.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                          // leave POSTs (AI function) alone
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // only manage same-origin assets
  if (url.pathname.includes('/.netlify/functions/')) return; // never cache the AI proxy

  // The whole app is one HTML file (CSS + JS inline), so keeping the document
  // fresh is what matters. Network-first guarantees a new deploy is shown online.
  const isDocument = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isDocument) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          // Only cache good responses — a mid-deploy 404 or captive-portal page
          // must never replace the working shell we'd serve offline.
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>                                          // offline → serve cached shell
          caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))
        )
    );
    return;
  }

  // Other assets: stale-while-revalidate (instant, self-updating).
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => cached);
      return cached || network;
    })
  );
});
