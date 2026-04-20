const CACHE_NAME = 'wirepath-pwa-v1';

self.addEventListener('install', (event) => {
    // Force the waiting service worker to become the active service worker
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    // Claim the clients immediately
    event.waitUntil(self.clients.claim());
});

// Stale-While-Revalidate caching strategy
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) {
        return;
    }

    event.respondWith(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.match(event.request).then((cachedResponse) => {
                const fetchedResponse = fetch(event.request).then((networkResponse) => {
                    // Update cache with new response
                    cache.put(event.request, networkResponse.clone());
                    return networkResponse;
                }).catch(() => {
                    // Ignore fetch errors (e.g., when completely offline)
                });

                // Return cached if available, otherwise return network response
                return cachedResponse || fetchedResponse;
            });
        })
    );
});