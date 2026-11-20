/* تُخزَّن نسخة متناسقة من اللعبة على الجهاز بعد زيارتها أول مرة.
   يُغيَّر اسم ذاكرة التخزين مع كل إصدار لتحديث جميع الملفات معًا. */
const CACHE_NAME = 'space-journey-offline-v7';
const APP_FILES = [
  './index.html', './manifest.json', './bots.js', './online-bots.js',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_FILES.map(path => new Request(path, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('space-journey-offline-') && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Always pair a saved page with the scripts saved in the same cache version.
    if (request.mode === 'navigate') return (await cache.match('./index.html')) || fetch(request);
    return (await cache.match(request)) || fetch(request);
  })());
});
