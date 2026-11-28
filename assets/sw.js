// Minimal service worker for PWA installability.
// The pet is inherently LAN-bound (the PC is the server), so there is nothing
// useful to cache offline: every request goes straight to the network.
// Models/animations BYPASS the service worker entirely — WebKit's (iOS) SW
// fetch has quirks with large binary responses that Chrome handles fine, and
// the native network stack is perfectly capable on its own.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const p = new URL(event.request.url).pathname;
  // Models/animations BYPASS the service worker entirely — WebKit's (iOS) SW
  // fetch has quirks with large binary responses that Chrome handles fine.
  // They may sit on the TCB origin (cross-origin URL under /pet/models/...)
  // or on this host (/models/...) — match both shapes.
  if (/\/(pet\/)?(models|animations)\//.test(p)) return;
  event.respondWith(fetch(event.request));
});
