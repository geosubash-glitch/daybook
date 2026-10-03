// Keeps the app shell available so Daybook opens fast. Your entries are never cached here; they live online.
const CACHE = 'daybook-shell-v2';
const SHELL = ['./', 'index.html', 'app.js', 'ai.js', 'config.js', 'store-firebase.js', 'store-memory.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'privacy.html', 'terms.html', 'delete-account.html'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
