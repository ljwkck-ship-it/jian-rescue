const CACHE_VERSION = "jian-rescue-v24";
const APP_SHELL = [
  "./",
  "index.html",
  "favicon.ico",
  "styles/app.css?v=24",
  "src/app.js?v=24",
  "src/game.js?v=24",
  "manifest.webmanifest",
  "assets/logo.svg",
  "assets/jian-rescue-mascot.png",
  "assets/momo-safety-lantern.png",
  "assets/favicon-16.png",
  "assets/favicon-32.png",
  "assets/og-image.png",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/faces/face-01.png",
  "assets/faces/face-02.png",
  "assets/faces/face-03.png",
  "assets/faces/face-04.png",
  "assets/faces/face-05.png",
  "assets/faces/face-06.png",
  "assets/faces/face-07.png",
  "assets/faces/face-08.png",
  "assets/faces/face-09.png",
  "assets/faces/face-10.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll(APP_SHELL).catch(async () => {
        const requiredShell = APP_SHELL.filter((path) => !path.startsWith("assets/faces/"));
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
