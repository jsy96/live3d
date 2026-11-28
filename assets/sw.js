// Minimal service worker for PWA installability.
// The pet is inherently LAN-bound (the PC is the server), so there is nothing
// useful to cache offline: every request goes straight to the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request));
});
