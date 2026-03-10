// Service Worker for Claude Code UI PWA
const CACHE_NAME = 'claude-ui-v2';
const urlsToCache = [
  '/manifest.json'
];

// Install event
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

// Fetch event - network-first strategy to avoid stale cache issues
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Only cache successful GET requests for static assets
        if (response.ok && event.request.method === 'GET') {
          const url = new URL(event.request.url);
          // Only cache manifest and icon assets, not HTML/JS/CSS which change frequently
          if (url.pathname === '/manifest.json' || url.pathname.startsWith('/icons/')) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
          }
        }
        return response;
      })
      .catch(() => {
        // Fallback to cache only when network fails
        return caches.match(event.request);
      })
  );
});

// Activate event - clean up old caches immediately
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});