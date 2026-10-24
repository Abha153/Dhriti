// Network-first with cache fallback so the app shell and helplines still open offline. Chat, health, journeys and share links are never cached; resources, help points and reports are.
const C = 'dhriti-v2';
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(C).then((c) => c.addAll(['/', '/logo-180.png']))); });
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== C).map((x) => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const r = e.request, p = new URL(r.url).pathname;
  if (r.method !== 'GET' || (p.startsWith('/api/') && !['/api/resources', '/api/helppoints', '/api/reports'].includes(p))) return;
  e.respondWith(fetch(r).then((res) => { const cp = res.clone(); caches.open(C).then((c) => c.put(r, cp)); return res; }).catch(() => caches.match(r).then((m) => m || caches.match('/'))));
});
