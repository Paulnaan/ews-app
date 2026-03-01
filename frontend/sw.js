'use strict';

const CACHE_NAME    = 'qatar-ews-v1';
const OFFLINE_URLS  = [
  '/',
  '/index.html',
  '/manifest.json',
];

// ═══════════════════════════════════════════════════════════════
// INSTALL — pre-cache shell assets
// ═══════════════════════════════════════════════════════════════
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(OFFLINE_URLS))
      .then(() => self.skipWaiting())        // activate immediately
  );
});

// ═══════════════════════════════════════════════════════════════
// ACTIVATE — delete old caches
// ═══════════════════════════════════════════════════════════════
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key  => caches.delete(key))
      ))
      .then(() => self.clients.claim())     // take control of all tabs
  );
});

// ═══════════════════════════════════════════════════════════════
// FETCH — cache-first for shell, network-first for API
// ═══════════════════════════════════════════════════════════════
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GET requests
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // API calls — network-first, no caching
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(
          JSON.stringify({ error: 'Offline — no cached data available' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // Google Fonts — network-first with cache fallback
  if (url.origin.includes('fonts.g')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Shell assets (HTML, JS, CSS, manifest) — cache-first, fallback to network
  event.respondWith(
    caches.match(request)
      .then(cached => {
        if (cached) return cached;

        return fetch(request).then(response => {
          // Only cache valid 200 responses
          if (!response || response.status !== 200 || response.type === 'opaque') {
            return response;
          }
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          return response;
        });
      })
      .catch(() =>
        // Last resort — serve index.html for navigation requests
        request.mode === 'navigate'
          ? caches.match('/index.html')
          : new Response('Offline', { status: 503 })
      )
  );
});

// ═══════════════════════════════════════════════════════════════
// PUSH — receive and display notifications
// ═══════════════════════════════════════════════════════════════
self.addEventListener('push', event => {
  let data = {
    title: 'EWS Alert',
    body:  'Threat level update received.',
    icon:  '/icon-192.png',
    badge: '/icon-72.png',
    data:  { level: 'GREEN', url: '/' },
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
      // Normalise nested data field
      if (!data.data) data.data = {};
      if (parsed.data) data.data = { ...data.data, ...parsed.data };
    } catch {
      data.body = event.data.text();
    }
  }

  const level = (data.data?.level || 'GREEN').toUpperCase();

  // Vibration patterns by threat level
  const VIBRATION = {
    GREEN:  [100, 50, 100],                               // two short pulses
    YELLOW: [200, 100, 200, 100, 200],                    // three medium
    ORANGE: [300, 100, 300, 100, 300, 100, 300],          // four firm bursts
    RED:    [500, 150, 500, 150, 500, 150, 500, 150, 500], // five long urgent
  };

  // Badge colour mapped to threat level
  const BADGE_COLOR = {
    GREEN:  '#00e676',
    YELLOW: '#ffd600',
    ORANGE: '#ff6d00',
    RED:    '#ff1744',
  };

  const vibrate  = VIBRATION[level]    || VIBRATION.GREEN;
  const color    = BADGE_COLOR[level]  || BADGE_COLOR.GREEN;
  const tag      = `ews-threat-${level}`;   // replaces previous same-level notif

  // RED gets an extra urgent prefix
  const title = level === 'RED'
    ? `🚨 ${data.title}`
    : data.title;

  const options = {
    body:            data.body,
    icon:            data.icon  || '/icon-192.png',
    badge:           data.badge || '/icon-72.png',
    vibrate,
    tag,
    renotify:        level === 'RED',    // re-alert even if tag already shown
    requireInteraction: level === 'RED' || level === 'ORANGE', // stay visible
    silent:          false,
    timestamp:       Date.now(),
    data:            { url: data.data?.url || '/', level },
    actions: [
      { action: 'open',    title: 'Open Dashboard' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  // Attempt to set notification colour (Android Chrome)
  if ('NotificationOptions' in self || color) {
    try { options.icon = data.icon || '/icon-192.png'; } catch { /* noop */ }
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ═══════════════════════════════════════════════════════════════
// NOTIFICATION CLICK — open / focus dashboard
// ═══════════════════════════════════════════════════════════════
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        // If dashboard already open, focus it and navigate
        for (const client of clientList) {
          const clientUrl = new URL(client.url);
          if (clientUrl.origin === self.location.origin) {
            client.focus();
            client.navigate(targetUrl);
            return;
          }
        }
        // Otherwise open a new tab
        return self.clients.openWindow(targetUrl);
      })
  );
});

// ═══════════════════════════════════════════════════════════════
// NOTIFICATION CLOSE — optional analytics hook (no-op for now)
// ═══════════════════════════════════════════════════════════════
self.addEventListener('notificationclose', () => {
  // Reserved for future dismiss telemetry
});

// ═══════════════════════════════════════════════════════════════
// MESSAGE — allow main thread to post messages to SW
// ═══════════════════════════════════════════════════════════════
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME);
  }
});
