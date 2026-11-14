// Service worker mínimo de RADAR: no cachea respuestas; solo hace la app
// instalable en Android, donde Chrome exige un handler de fetch.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {});
