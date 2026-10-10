const VERSION = 'cpl4-v10';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'admin.js', 'config.js', 'manifest.json', 'fonts/hanken-grotesk-latin-wght-normal.woff2', 'fonts/big-shoulders-display-latin-700-normal.woff2', 'fonts/big-shoulders-display-latin-800-normal.woff2', 'fonts/big-shoulders-display-latin-900-normal.woff2', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png'];
const LIBS = [
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'
];
const CACHE_FIRST_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.allSettled(SHELL.map(u => c.add(u)));
    await Promise.allSettled(LIBS.map(u => c.add(new Request(u, { mode: 'cors' }))));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (CACHE_FIRST_HOSTS.includes(url.hostname)) {
    e.respondWith((async () => {
      const c = await caches.open(VERSION);
      const hit = await c.match(req);
      if (hit) return hit;
      try { const r = await fetch(req); if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }
      catch (err) { return hit || Response.error(); }
    })());
    return;
  }

  if (url.origin === self.location.origin) {
    // network first so GitHub updates reach users; cache is the offline fallback
    e.respondWith((async () => {
      const c = await caches.open(VERSION);
      try {
        const r = await fetch(req);
        if (r.ok) c.put(req, r.clone());
        return r;
      } catch (err) {
        const hit = await c.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (req.mode === 'navigate') return (await c.match('index.html')) || (await c.match('./'));
        return Response.error();
      }
    })());
  }
  // Supabase API calls are never intercepted
});
