'use strict';
// Netzwerk zuerst, damit Updates sofort ankommen. Ohne oder mit sehr langsamem Netz startet die App aus dem Cache.
const CACHE = 'vokaltrainer-v7';
const FILES = ['./', 'index.html', 'styles.css', 'data.js', 'audio.js', 'pitch.js', 'laute.js', 'app.js', 'songs.js', 'extras.js', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const NETWORK_WAIT = 3000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function networkFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  const network = fetch(request).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy));
    }
    return res;
  });
  if (!cached) return network;
  const slow = new Promise((resolve) => setTimeout(() => resolve(cached), NETWORK_WAIT));
  return Promise.race([network.catch(() => cached), slow]);
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Die Schrift aendert sich nicht: einmal laden, danach aus dem Cache, damit IPA-Zeichen offline stimmen.
  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    })));
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith(networkFirst(e.request));
});
