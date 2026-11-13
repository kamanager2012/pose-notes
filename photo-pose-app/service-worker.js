const CACHE_NAME = 'pose-notes-ae127f17944c';
const APP_ROOT = new URL('./', self.location.href);
const IMAGE_ROOT = new URL('../reference-library/poses-shisei-v0.4.1/', self.location.href);
const CATALOG_URL = new URL('../reference-library/photo-pose-selection.json', self.location.href).href;
const CORE_URLS = [
  new URL('./', self.location.href).href,
  new URL('./index.html', self.location.href).href,
  new URL('./style.css', self.location.href).href,
  new URL('./app.js', self.location.href).href,
  new URL('./shoot.js', self.location.href).href,
  new URL('./diagrams/group-three-huddle.svg', self.location.href).href,
  new URL('./diagrams/group-four-seated-standing.svg', self.location.href).href,
  new URL('./diagrams/group-four-ground.svg', self.location.href).href,
  new URL('./diagrams/group-three-walk.svg', self.location.href).href,
  new URL('./diagrams/pair-seated-standing.svg', self.location.href).href,
  new URL('./diagrams/pair-hand-in-hand.svg', self.location.href).href,
  new URL('./diagrams/pair-face-to-face-hands.svg', self.location.href).href,
  new URL('./diagrams/pair-back-hug.svg', self.location.href).href,
  CATALOG_URL,
  new URL('../reference-library/photo-pose-recommendations.mjs', self.location.href).href,
  new URL('../reference-library/photo-pose-gallery.json', self.location.href).href,
];

const FETCH_TIMEOUT = 8000;

function freshRequest(url) {
  return new Request(url, { cache: 'reload' });
}

async function fetchFresh(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    return await fetch(freshRequest(url), { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function cacheCueDrawings(cache) {
  try {
    const catalog = await (await cache.match(CATALOG_URL)).json();
    const poses = [...(catalog.poses || []), ...(catalog.guideBasedPoses || [])];
    const urls = new Set();
    for (const pose of poses) {
      if (!pose.previewImage || pose.imageStatus !== 'cc0_pose_reference') continue;
      const url = new URL(pose.previewImage, APP_ROOT).href;
      if (url.startsWith(IMAGE_ROOT.href) && url.endsWith('.webp')) urls.add(url);
    }
    await Promise.allSettled([...urls].map(async (url) => {
      const response = await fetchFresh(url);
      if (response.ok) await cache.put(url, response);
    }));
  } catch (error) {
    console.warn('Unable to cache cue drawings', error);
  }
}

async function repairCore(cache) {
  const missing = [];
  for (const url of CORE_URLS) {
    if (!(await cache.match(url))) missing.push(url);
  }
  await Promise.allSettled(missing.map(async (url) => {
    const response = await fetchFresh(url);
    if (response.ok) await cache.put(url, response);
  }));
  return missing.length;
}

async function coreIsComplete(cache) {
  return (await Promise.all(CORE_URLS.map((url) => cache.match(url)))).every(Boolean);
}

async function matchPriorCache(lookup) {
  try {
    const keys = (await caches.keys()).filter((key) => key.startsWith('pose-notes-') && key !== CACHE_NAME);
    for (const key of keys.reverse()) {
      const hit = await (await caches.open(key)).match(lookup);
      if (hit) return hit;
    }
  } catch (error) {
    console.warn('Unable to read prior offline cache', error);
  }
  return undefined;
}

async function activateWhenComplete(client) {
  let complete = false;
  try {
    const cache = await caches.open(CACHE_NAME);
    if (await repairCore(cache) > 0) await cacheCueDrawings(cache);
    complete = await coreIsComplete(cache);
  } catch (error) {
    console.warn('Unable to verify the new release before activation', error);
  }
  if (complete) await self.skipWaiting();
  else if (client) client.postMessage({ type: 'update-blocked' });
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const existed = await caches.has(CACHE_NAME);
    const cache = await caches.open(CACHE_NAME);
    try {
      await Promise.all(CORE_URLS.map(async (url) => {
        const response = await fetchFresh(url);
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
        await cache.put(url, response);
      }));
    } catch (error) {
      if (!existed) await caches.delete(CACHE_NAME);
      throw error;
    }
    await cacheCueDrawings(cache);
    const verified = await caches.open(CACHE_NAME);
    if (await repairCore(verified) > 0) await cacheCueDrawings(verified);
    if (!(await coreIsComplete(verified))) {
      if (!existed) await caches.delete(CACHE_NAME);
      throw new Error('Offline core cache incomplete after install');
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    let complete = false;
    try {
      const cache = await caches.open(CACHE_NAME);
      if (await repairCore(cache) > 0) await cacheCueDrawings(cache);
      complete = await coreIsComplete(cache);
    } catch (error) {
      console.warn('Unable to repair offline cache on activation', error);
    }
    if (complete) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith('pose-notes-') && key !== CACHE_NAME)
        .map((key) => caches.delete(key)));
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const coreKey = url.origin + url.pathname;
  const isCore = CORE_URLS.includes(coreKey);
  const isImage = url.href.startsWith(IMAGE_ROOT.href) && url.pathname.endsWith('.webp');
  if (!isCore && !isImage) return;

  event.respondWith((async () => {
    let cache;
    let cached;
    try {
      cache = await caches.open(CACHE_NAME);
      cached = await cache.match(isCore ? coreKey : request);
    } catch (error) {
      console.warn('Offline cache unavailable', error);
      return fetch(request);
    }
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && isCore && response.type === 'basic') {
        try {
          await cache.put(coreKey, response.clone());
        } catch (error) {
          console.warn('Unable to repair offline core file', error);
        }
      }
      if (response.ok && isImage) {
        try {
          await cache.put(request, response.clone());
        } catch (error) {
          console.warn('Unable to cache offline resource', error);
        }
      }
      return response;
    } catch (error) {
      const fallback = await matchPriorCache(isCore ? coreKey : request);
      if (fallback) return fallback;
      if (request.mode === 'navigate') {
        const shell = (await cache.match(CORE_URLS[0])) || (await matchPriorCache(CORE_URLS[0]));
        if (shell) return shell;
      }
      throw error;
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') {
    event.waitUntil(activateWhenComplete(event.source));
    return;
  }
  if (event.data !== 'offline-status' || !event.source) return;
  event.waitUntil((async () => {
    let ready = false;
    try {
      const cache = await caches.open(CACHE_NAME);
      ready = await coreIsComplete(cache);
    } catch (error) {
      console.warn('Unable to check offline cache', error);
    }
    event.source.postMessage({ type: 'offline-status', ready });
  })());
});
