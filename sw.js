const CACHE_NAME = "control-prestamos-shell-v7";
const APP_ROOT = new URL("./", self.location.href);
const SHELL_FILES = [
  "./",
  "./index.html",
  "./operador.html",
  "./manifest.webmanifest",
  "./operator.webmanifest",
  "./icons/control-prestamos.svg",
  "./src/styles.css",
  "./src/domain/loans.js",
  "./src/offline-store.js",
  "./src/operator.js",
  "./src/app.js"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(SHELL_FILES.map(async file => {
      const url = new URL(file, APP_ROOT).href;
      try {
        const response = await fetch(url, { cache: "reload" });
        if (response.ok) await cache.put(url, response);
      } catch {
        // A failed optional resource must not prevent the offline shell from installing.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith("control-prestamos-shell-") && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (request.mode === "navigate") {
      try {
        const fresh = await fetch(request);
        if (fresh.ok) await cache.put(request, fresh.clone());
        return fresh;
      } catch {
        const cached = await cache.match(request, { ignoreSearch: true });
        if (cached) return cached;
        const fallback = await cache.match(new URL("./operador.html", APP_ROOT).href);
        return fallback || new Response("Control Préstamos no está disponible sin conexión. Abre la aplicación una vez con Internet para preparar el almacenamiento offline.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
      }
    }

    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;

    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch {
      return new Response("", { status: 504, statusText: "Offline resource unavailable" });
    }
  })());
});
