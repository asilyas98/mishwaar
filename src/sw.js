/* Mishwaar service worker: offline app shell, cached map tiles, and push notifications. */
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { clientsClaim } from 'workbox-core'

self.skipWaiting()
clientsClaim()
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/\.netlify\//] }))

// Map tiles: once seen (or saved for offline), they stay available without internet.
registerRoute(
  ({ url }) => url.origin !== self.location.origin && /\/\d+\/\d+\/\d+(\.png)?$/.test(url.pathname),
  new CacheFirst({
    cacheName: 'mishwaar-tiles-v2',
    plugins: [new CacheableResponsePlugin({ statuses: [0, 200] }), new ExpirationPlugin({ maxEntries: 8000, maxAgeSeconds: 60 * 60 * 24 * 60 })],
  }),
)
registerRoute(
  ({ url }) => url.origin.includes('fonts.g'),
  new StaleWhileRevalidate({ cacheName: 'mishwaar-fonts', plugins: [new CacheableResponsePlugin({ statuses: [0, 200] })] }),
)

// Push from netlify/functions/notify.mjs: { title, body, tag, url }
self.addEventListener('push', (event) => {
  let d = {}
  try { d = event.data?.json() || {} } catch { d = { body: event.data?.text() } }
  event.waitUntil(
    self.registration.showNotification(d.title || 'مشوار', {
      body: d.body || '', tag: d.tag, renotify: Boolean(d.tag), dir: 'rtl', lang: 'ar',
      icon: '/icon-192.png', badge: '/icon-192.png', vibrate: [200, 100, 200], data: { url: d.url || '/#taxi' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = all.find((c) => new URL(c.url).origin === self.location.origin)
    if (open) { await open.focus(); return }
    await self.clients.openWindow(url)
  })())
})
