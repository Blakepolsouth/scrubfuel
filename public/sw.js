// ScrubFuel service worker: works offline in the breakroom, always fetches fresh code when online.
const SHELL = "scrubfuel-shell-v9";
const FILES = ["/", "/app.css", "/app.js", "/planner.js", "/food.js", "/steps.js", "/stores.js", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  const fresh = req.mode === "navigate" || /\.(js|css|webmanifest)$/.test(url.pathname);
  if (fresh) {
    const key = req.mode === "navigate" ? url.pathname : req;
    e.respondWith(fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(SHELL).then(c => c.put(key, copy)); } return r; })
      .catch(() => caches.match(key).then(hit => hit || (req.mode === "navigate" ? caches.match("/") : undefined))));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(SHELL).then(c => c.put(req, copy)); } return r; })));
});

// Shift reminders
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: "ScrubFuel", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "ScrubFuel", { body: d.body || "", icon: "/icon-192.png", badge: "/icon-192.png", tag: d.tag || "scrubfuel", data: { url: d.url || "/" } }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) { if ("focus" in c && c.url.startsWith(self.location.origin)) { c.navigate(target); return c.focus(); } }
    return self.clients.openWindow(target);
  }));
});
