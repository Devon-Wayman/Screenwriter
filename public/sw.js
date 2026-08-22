const CACHE = 'screenwriter-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icons/screenwriter.svg', '/icons/screenwriter-maskable.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    const index = await cache.match('/');
    if (index) {
      const html = await index.text();
      const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
      await cache.addAll(assets);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin || new URL(request.url).pathname.startsWith('/api/')) return;
  event.respondWith(fetch(request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy));
    return response;
  }).catch(async () => (await caches.match(request)) || (request.mode === 'navigate' ? caches.match('/') : undefined)));
});
