// Install-only worker: no caching and no respondWith, so every request
// (including /api/**) goes to the network and a dead daemon is never masked.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})
