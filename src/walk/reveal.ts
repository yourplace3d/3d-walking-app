/**
 * The revealed map as a raster: one byte per cell over the loaded square, 0 where nobody has
 * walked, 255 where the map shows, with a one-cell soft edge. Each stretch of a walk opens a band
 * as wide as its level's reveal distance on each side. Pure TypeScript (no canvas), so the same
 * code runs in the browser and in unit tests, and the revealed area can be counted exactly.
 */

import { makeProjector, type LngLat } from '../geo/projection';
import { LEVEL_RULES, type Level } from './levels';
import { MAX_JOIN_M, metresBetween, type WalkPoint } from './track';

/** The edge of the revealed map fades over this width (m); the shader makes it ragged, like a coastline. */
export const FEATHER_M = 12;

export interface WalkLike {
  level: Level;
  points: readonly WalkPoint[];
}

export class RevealMask {
  readonly data: Uint8Array;
  readonly cellM: number;
  private readonly toLocal: (lon: number, lat: number) => [number, number];

  constructor(
    readonly center: LngLat,
    readonly sizeM: number,
    readonly px: number,
  ) {
    this.data = new Uint8Array(px * px);
    this.cellM = sizeM / px;
    this.toLocal = makeProjector(center).toLocal;
  }

  clear(): void {
    this.data.fill(0);
  }

  /** Open the map along a whole walk. Returns whether anything inside the square changed. */
  addWalk(w: WalkLike): boolean {
    let changed = false;
    const r = LEVEL_RULES[w.level].revealM;
    for (let i = 0; i < w.points.length; i++) {
      const p = w.points[i];
      const q = i > 0 ? w.points[i - 1] : null;
      const joined = q && metresBetween(q[0], q[1], p[0], p[1]) <= MAX_JOIN_M;
      changed = this.addStep(joined ? q : null, p, r) || changed;
    }
    return changed;
  }

  /** Open the map around one new point, joined to the previous point if given. */
  addStep(prev: WalkPoint | null, p: WalkPoint, radiusM: number): boolean {
    const b = this.toLocal(p[0], p[1]);
    const a = prev ? this.toLocal(prev[0], prev[1]) : b;
    return this.capsule(a[0], a[1], b[0], b[1], radiusM);
  }

  /** The local point (m, E/N of centre) as a cell value 0–255, or 0 outside the square. */
  valueAt(e: number, n: number): number {
    const i = Math.floor((e + this.sizeM / 2) / this.cellM);
    const j = Math.floor((this.sizeM / 2 - n) / this.cellM);
    if (i < 0 || j < 0 || i >= this.px || j >= this.px) return 0;
    return this.data[j * this.px + i];
  }

  /** Revealed area inside the square (m²): cells at least half open, i.e. within the reveal distance. */
  revealedM2(): number {
    let cells = 0;
    for (let k = 0; k < this.data.length; k++) if (this.data[k] >= 128) cells++;
    return cells * this.cellM * this.cellM;
  }

  /** Fill a band of radius r around the segment a→b (local metres). Row 0 is the north edge. */
  private capsule(ax: number, ay: number, bx: number, by: number, r: number): boolean {
    const { px, cellM, data } = this;
    const h = this.sizeM / 2;
    const reach = r + FEATHER_M / 2;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach + h) / cellM) - 1);
    const i1 = Math.min(px - 1, Math.ceil((Math.max(ax, bx) + reach + h) / cellM) + 1);
    const j0 = Math.max(0, Math.floor((h - Math.max(ay, by) - reach) / cellM) - 1);
    const j1 = Math.min(px - 1, Math.ceil((h - Math.min(ay, by) + reach) / cellM) + 1);
    if (i0 > i1 || j0 > j1) return false;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let changed = false;
    for (let j = j0; j <= j1; j++) {
      const y = h - (j + 0.5) * cellM;
      for (let i = i0; i <= i1; i++) {
        const x = (i + 0.5) * cellM - h;
        let t = len2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = x - (ax + t * dx);
        const ey = y - (ay + t * dy);
        const d = Math.sqrt(ex * ex + ey * ey);
        // 255 inside, 0 outside, a ramp across the edge (half open exactly at r)
        const v = Math.round(Math.min(1, Math.max(0, (r - d) / Math.max(FEATHER_M, cellM) + 0.5)) * 255);
        const k = j * px + i;
        if (v > data[k]) {
          data[k] = v;
          changed = true;
        }
      }
    }
    return changed;
  }
}

/**
 * How much map a walk opened that no earlier walk had (m²), over a square around the whole walk,
 * at about 4 m cells.
 */
export function newlyRevealedM2(walk: WalkLike, others: readonly WalkLike[]): number {
  if (!walk.points.length) return 0;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lon, lat] of walk.points) {
    w = Math.min(w, lon); e = Math.max(e, lon);
    s = Math.min(s, lat); n = Math.max(n, lat);
  }
  const center = { lon: (w + e) / 2, lat: (s + n) / 2 };
  const [ex, ny] = makeProjector(center).toLocal(e, n);
  const reach = LEVEL_RULES.easy.revealM + FEATHER_M;
  const size = 2 * (Math.max(Math.abs(ex), Math.abs(ny)) + reach);
  const px = Math.min(2048, Math.max(64, Math.ceil(size / 4)));
  const before = new RevealMask(center, size, px);
  for (const o of others) before.addWalk(o);
  const after = new RevealMask(center, size, px);
  after.data.set(before.data);
  after.addWalk(walk);
  return Math.max(0, after.revealedM2() - before.revealedM2());
}
