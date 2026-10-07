// FGYG service worker: caches the app shell so it opens fast (chat data is always live)
const CACHE = "gather-v14";
const SHELL = ["./", "index.html", "download.html", "manifest.json", "small-groups.js", "small-groups.css", "icons/icon-192.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/__/")) return;
  // network first, cache as fallback (so updates show up right away)
  e.respondWith(
    fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request))
  );
});

// ---- notifications ----
// The notice only says who sent something; message text stays encrypted and never reaches the server.
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    // the app is open and on screen: it already shows the new message (iPhone must always show a notice)
    if (!ios && d.kind !== "test" && wins.some(w => w.visibilityState === "visible" && w.focused)) return;
    await self.registration.showNotification(d.title || "Gather", {
      body: d.body || "You have a new message",
      tag: d.tag || "gather", renotify: true,
      icon: "icons/icon-192.png", badge: "icons/icon-192.png",
      data: { g: d.g || "", room: d.room || "" }
    });
    if (self.navigator.setAppBadge) self.navigator.setAppBadge().catch(() => {});
  })());
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const { g, room } = e.notification.data || {};
  const url = new URL("index.html" + (g ? `?g=${encodeURIComponent(g)}${room ? "&room=" + encodeURIComponent(room) : ""}` : ""), self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const w = wins.find(x => x.url.startsWith(self.registration.scope));
    if (w){ await w.focus().catch(() => {}); w.postMessage({ open: { g, room } }); return; }
    await self.clients.openWindow(url);
  })());
});
