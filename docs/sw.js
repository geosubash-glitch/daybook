// Keeps the app shell available so Daybook opens fast. Your entries are never cached here; they live online.
const CACHE = 'daybook-shell-v36';
const SHELL = ['./', 'index.html', 'app.js', 'grammar.js', 'native.js', 'telemetry.js', 'config.js', 'store-firebase.js', 'vendor/firebase.js', 'store-memory.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'privacy.html', 'terms.html', 'delete-account.html', 'download.html', 'support.html', 'pdf.js', 'vendor/jspdf.umd.min.js', 'fonts/Newsreader_400Regular.ttf', 'fonts/Newsreader_400Regular_Italic.ttf'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // Network first so a new version shows straight away; fall back to the saved copy when offline or slow.
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; });
    const slow = new Promise((res) => setTimeout(res, 4000, null));
    try { const r = await Promise.race([net, slow.then(async () => (await c.match(e.request)) || net)]); if (r) return r; } catch (err) {}
    return (await c.match(e.request)) || Response.error();
  }));
});
