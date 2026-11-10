/**
 * Map tiles and terrain tiles kept on the device (Cache Storage), so a walk keeps working when the
 * signal drops. "Save for offline" fills it ahead of a walk; every tile a walk loads is kept too.
 * Only public map data goes in here, never the walk. Fails soft: without Cache Storage the
 * network is used as before.
 */

export const MAP_CACHE = 'walk-it-3d-map-v1';

let cachePromise: Promise<Cache | null> | null = null;

function openCache(): Promise<Cache | null> {
  cachePromise ??= (async () => {
    try {
      return typeof caches === 'undefined' ? null : await caches.open(MAP_CACHE);
    } catch {
      return null;
    }
  })();
  return cachePromise;
}

/** fetch, answered from the device when the tile is there; good answers are kept. */
export async function mapFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const cache = await openCache();
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) return hit;
    } catch {
      /* fall through to the network */
    }
  }
  const res = await fetch(url, init);
  if (cache && res.ok) {
    try {
      await cache.put(url, res.clone());
    } catch {
      /* storage full or refused: still show the tile */
    }
  }
  return res;
}

/** How many tiles are kept, and roughly how much space they take (bytes, when the browser says). */
export async function mapCacheSize(): Promise<{ tiles: number; bytes: number | null }> {
  const cache = await openCache();
  let tiles = 0;
  try {
    tiles = cache ? (await cache.keys()).length : 0;
  } catch {
    tiles = 0;
  }
  let bytes: number | null = null;
  try {
    bytes = (await navigator.storage?.estimate?.())?.usage ?? null;
  } catch {
    bytes = null;
  }
  return { tiles, bytes };
}

export async function clearMapCache(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') await caches.delete(MAP_CACHE);
  } catch {
    /* nothing kept */
  }
  cachePromise = null;
}
