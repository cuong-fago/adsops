/* AdsOps service worker.
 * Caches ONLY the static shell (hashed /assets/*, icons, fonts, offline page).
 * Never caches HTML documents, /api/*, auth, server functions or any private data. */
const VERSION = "adsops-shell-v1";
const PRECACHE = ["/offline.html", "/favicon.svg", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

function isStatic(url) {
  if (url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com") return true;
  if (url.origin !== self.location.origin) return false;
  return url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/") || url.pathname === "/favicon.svg";
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (req.mode === "navigate") {
    // Network only (pages carry private data); offline → static fallback page.
    e.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
    return;
  }
  if (!isStatic(url)) return; // API, auth, _serverFn, everything else: straight to network
  e.respondWith(
    caches.open(VERSION).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === "opaque") c.put(req, res.clone());
      return res;
    }))),
  );
});

/* ---- Web push ---- */
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : "" }; }
  const title = d.title || "AdsOps";
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: d.tag || undefined,
    data: { url: typeof d.url === "string" && d.url.startsWith("/") ? d.url : "/" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ws) => {
    for (const w of ws) { if ("focus" in w) { w.navigate(url).catch(() => {}); return w.focus(); } }
    return self.clients.openWindow(url);
  }));
});
