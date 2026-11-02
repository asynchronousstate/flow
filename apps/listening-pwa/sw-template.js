/* Offline shell only. Books stay in IndexedDB and never enter a network request. */
/* global __ASSETS__ -- injected by build.cjs */
const CACHE = '__CACHE__'
const ASSETS = __ASSETS__

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      for (const path of ASSETS) {
        const response = await fetch(
          new Request(path, { cache: 'reload', credentials: 'same-origin' }),
        )
        // Never cache a redirect to the hosting sign-in page as app content.
        if (!response.ok || response.redirected)
          throw new Error('Offline asset unavailable: ' + path)
        if (
          path === '/' &&
          !response.headers.get('content-type')?.includes('text/html')
        )
          throw new Error('Invalid app shell')
        await cache.put(path, response)
      }
    })(),
  )
  // Updates wait for every old app window to close, preserving active narration.
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('flow-listening-') && name !== CACHE)
          await caches.delete(name)
      }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  // Allow authentication and unrelated URLs through untouched.
  if (
    request.mode === 'navigate' &&
    (url.pathname === '/' || url.pathname === '/index.html')
  ) {
    event.respondWith(
      caches
        .open(CACHE)
        .then(async (cache) => (await cache.match('/')) || fetch(request)),
    )
  } else if (ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches
        .open(CACHE)
        .then(
          async (cache) => (await cache.match(url.pathname)) || fetch(request),
        ),
    )
  }
})
