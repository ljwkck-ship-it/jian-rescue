const CACHE_VERSION = "jian-rescue-v27";
const APP_SHELL = [
  "./",
  "index.html",
  "favicon.ico",
  "styles/app.css?v=26",
  "src/app.js?v=27",
  "src/game.js?v=26",
  "manifest.webmanifest",
  "assets/logo.svg",
  "assets/jian-rescue-mascot.png",
  "assets/momo-safety-lantern.png",
  "assets/favicon-16.png",
  "assets/favicon-32.png",
  "assets/og-image.png",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/avatars/jian-smile.png",
  "assets/avatars/jian-brave.png",
  "assets/avatars/jian-cheer.png",
  "assets/avatars/jian-salute.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll(APP_SHELL).catch(async () => {
        const requiredShell = APP_SHELL.filter((path) => !path.startsWith("assets/avatars/"));
        await cache.addAll(requiredShell);
      }),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
        return response;
      });
    }),
  );
});
