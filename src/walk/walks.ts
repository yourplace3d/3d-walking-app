/**
 * Walks are kept on this device only, in IndexedDB: never uploaded, no account. Each walk is its
 * level and its points; the revealed map is drawn again from them, so deleting the walks deletes
 * the map. Every operation fails soft (private windows, blocked storage): the walk then lasts as
 * long as the page.
 */

import { isLevel, type Level } from './levels';
import type { WalkPoint } from './track';

export interface Walk {
  id: string;
  level: Level;
  /** ms since 1970 */
  startedAt: number;
  endedAt: number | null;
  points: WalkPoint[];
}

export interface WalkStore {
  all(): Promise<Walk[]>;
  put(w: Walk): Promise<void>;
  clear(): Promise<void>;
}

/** Only well-formed walks come back from storage. */
export function isWalk(v: unknown): v is Walk {
  const w = v as Walk;
  return (
    !!w &&
    typeof w.id === 'string' &&
    isLevel(w.level) &&
    typeof w.startedAt === 'number' &&
    Array.isArray(w.points) &&
    w.points.every((p) => Array.isArray(p) && p.length === 3 && p.every((x) => typeof x === 'number' && Number.isFinite(x)))
  );
}

export function newWalk(level: Level, now = Date.now()): Walk {
  const rand = Math.random().toString(36).slice(2, 8);
  return { id: `${now.toString(36)}-${rand}`, level, startedAt: now, endedAt: null, points: [] };
}

/** In memory: for tests, and when the browser keeps no storage. */
export class MemoryStore implements WalkStore {
  private readonly walks = new Map<string, Walk>();
  async all(): Promise<Walk[]> {
    return [...this.walks.values()].map((w) => structuredClone(w)).sort((a, b) => a.startedAt - b.startedAt);
  }
  async put(w: Walk): Promise<void> {
    this.walks.set(w.id, structuredClone(w));
  }
  async clear(): Promise<void> {
    this.walks.clear();
  }
}

const DB = 'walk-it-3d';
const STORE = 'walks';

export class IdbStore implements WalkStore {
  private db: Promise<IDBDatabase | null> | null = null;
  /** walks that couldn't be stored stay here, so the page still shows them */
  private readonly fallback = new MemoryStore();

  private open(): Promise<IDBDatabase | null> {
    this.db ??= new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return this.db;
  }

  async all(): Promise<Walk[]> {
    const db = await this.open();
    const extra = await this.fallback.all();
    if (!db) return extra;
    const stored = await new Promise<Walk[]>((resolve) => {
      try {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        req.onsuccess = () => resolve((req.result as unknown[]).filter(isWalk));
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
    const ids = new Set(stored.map((w) => w.id));
    return [...stored, ...extra.filter((w) => !ids.has(w.id))].sort((a, b) => a.startedAt - b.startedAt);
  }

  async put(w: Walk): Promise<void> {
    const db = await this.open();
    const ok =
      !!db &&
      (await new Promise<boolean>((resolve) => {
        try {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(w);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
          tx.onabort = () => resolve(false);
        } catch {
          resolve(false);
        }
      }));
    if (!ok) await this.fallback.put(w);
  }

  async clear(): Promise<void> {
    await this.fallback.clear();
    const db = await this.open();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}
