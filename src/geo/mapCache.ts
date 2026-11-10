/**
 * Map tiles and terrain tiles kept on the device, so a walk keeps working when the signal drops.
 * "Save for offline" fills it ahead of a walk; every tile a walk loads is kept too. Only public
 * map data goes in here, never the walk. Cache Storage where there is one; IndexedDB where there
 * isn't (the iPhone app's web view). Fails soft: with neither, the network is used as before.
 */

export const MAP_CACHE = 'walk-it-3d-map-v1';

/** The bit of the Cache interface used here. */
interface TileCache {
  match(url: string): Promise<Response | undefined>;
  put(url: string, res: Response): Promise<void>;
  keys(): Promise<readonly unknown[]>;
  /** only the IndexedDB one: Cache Storage is deleted as a whole */
  clear?(): Promise<void>;
}

const IDB_STORE = 'tiles';

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** Tiles in IndexedDB, as bytes and a content type, keyed by URL. */
async function idbCache(): Promise<TileCache | null> {
  if (typeof indexedDB === 'undefined') return null;
  const open = indexedDB.open(MAP_CACHE, 1);
  open.onupgradeneeded = () => open.result.createObjectStore(IDB_STORE);
  const db = await req(open);
  const store = (mode: IDBTransactionMode) => db.transaction(IDB_STORE, mode).objectStore(IDB_STORE);
  return {
    async match(url) {
      const hit = (await req(store('readonly').get(url))) as { body: ArrayBuffer; type: string } | undefined;
      return hit ? new Response(hit.body, { headers: { 'content-type': hit.type } }) : undefined;
    },
    async put(url, res) {
      const body = await res.arrayBuffer();
      await req(store('readwrite').put({ body, type: res.headers.get('content-type') ?? '' }, url));
    },
    async keys() {
      return req(store('readonly').getAllKeys());
    },
    async clear() {
      await req(store('readwrite').clear());
    },
  };
}

let cachePromise: Promise<TileCache | null> | null = null;

function openCache(): Promise<TileCache | null> {
  cachePromise ??= (async () => {
    try {
      return typeof caches === 'undefined' ? await idbCache() : await caches.open(MAP_CACHE);
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
    else await (await openCache())?.clear?.();
  } catch {
    /* nothing kept */
  }
  cachePromise = null;
}
