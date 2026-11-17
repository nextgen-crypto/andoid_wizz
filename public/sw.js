/* WIZZ offline media cache.
 *
 * Caches image requests by canonical storage path instead of the full signed
 * URL, so a refreshed signed URL still hits the same offline entry. Videos are
 * deliberately not cached (quota + range requests); their posters are.
 */

const CACHE_NAME = "wizz-media-v1";
const MAX_ENTRIES = 180;

const MEDIA_PATH =
  /\.(?:jpe?g|png|gif|webp|avif|heic|heif|bmp|svg)(?:$|\?)|(?:\/storage\/v1\/object\/)/i;
const VIDEO_PATH = /\.(?:mp4|m4v|webm|mov|ogv)(?:$|\?)/i;

function canonicalKey(rawUrl) {
  try {
    const url = new URL(rawUrl);
    // Supabase signed/public object paths are stable; only the token changes.
    return `${url.host}${url.pathname}`;
  } catch {
    return rawUrl;
  }
}

function isVideoRequest(request, url) {
  return request.destination === "video" || VIDEO_PATH.test(url.pathname);
}

function shouldCache(request, url) {
  if (request.method !== "GET") return false;
  // Video byte-range requests must stay network-only; caching partial ranges
  // produces broken playback. Posters/images are cached normally.
  if (request.headers.has("range")) return false;
  if (isVideoRequest(request, url)) return false;
  return request.destination === "image" || MEDIA_PATH.test(url.pathname);
}

async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_ENTRIES) return;
  await Promise.all(
    keys.slice(0, keys.length - MAX_ENTRIES).map((key) => cache.delete(key)),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("wizz-media-") && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CLEAR_MEDIA_CACHE") {
    event.waitUntil(caches.delete(CACHE_NAME));
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (!shouldCache(request, url)) return;

  event.respondWith(
    (async () => {
      const key = canonicalKey(request.url);
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(key);

      // Cache-first for media. Stale entries are refreshed in the background
      // but always render immediately, including when the device is offline.
      if (cached) {
        event.waitUntil(
          fetch(request)
            .then((response) => {
              if (response && response.ok) return cache.put(key, response.clone());
            })
            .catch(() => undefined),
        );
        return cached;
      }

      try {
        const response = await fetch(request);
        if (response && (response.ok || response.type === "opaque")) {
          await cache.put(key, response.clone());
          await trimCache(cache);
        }
        return response;
      } catch (error) {
        return cached || Response.error();
      }
    })(),
  );
});
