/**
 * Which square of the city is loaded. The map is built one square at a time (2 km a side), centred
 * on a fixed grid of points 1 km apart. When you walk more than 600 m from the square's centre the
 * next one loads, so you are always at least 400 m from its edge. A fixed grid means the squares
 * saved for offline use are exactly the ones a walk loads later.
 */

import type { LngLat } from '../geo/projection';
import { metresBetween } from './track';

export const AREA_SIZE_M = 2000;
export const GRID_STEP_M = 1000;
/** Walk this far from the square's centre and the next square loads (m). */
export const RECENTRE_M = 600;
/** "Save for offline" keeps every square whose centre lies within this distance (m). */
export const OFFLINE_RADIUS_M = 2500;

const M_PER_DEG_LAT = 111320;
const LAT_STEP = GRID_STEP_M / M_PER_DEG_LAT;

function lonStep(lat: number): number {
  return GRID_STEP_M / (M_PER_DEG_LAT * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
}

const fix7 = (x: number) => Math.round(x * 1e7) / 1e7;

/** Grid point by row and column. */
function node(row: number, col: number): LngLat {
  const lat = row * LAT_STEP;
  return { lat: fix7(lat), lon: fix7(col * lonStep(lat)) };
}

/** The grid point nearest to a position: the centre of the square to load there. */
export function areaCentre(p: LngLat): LngLat {
  const row = Math.round(p.lat / LAT_STEP);
  return node(row, Math.round(p.lon / lonStep(row * LAT_STEP)));
}

/** A key for a square, for caches and tests. */
export function areaKey(c: LngLat): string {
  return `${c.lat.toFixed(5)},${c.lon.toFixed(5)}`;
}

/** Whether the walker has left the loaded square's middle and the next square should load. */
export function needsRecentre(current: LngLat, p: LngLat): boolean {
  return metresBetween(current.lon, current.lat, p.lon, p.lat) > RECENTRE_M;
}

/** Centres of the squares to save for offline use around a point, nearest first. */
export function offlineAreas(p: LngLat, radiusM = OFFLINE_RADIUS_M): LngLat[] {
  const rows = Math.ceil(radiusM / GRID_STEP_M) + 1;
  const r0 = Math.round(p.lat / LAT_STEP);
  const out: Array<{ c: LngLat; d: number }> = [];
  for (let r = r0 - rows; r <= r0 + rows; r++) {
    const step = lonStep(r * LAT_STEP);
    const c0 = Math.round(p.lon / step);
    for (let c = c0 - rows - 1; c <= c0 + rows + 1; c++) {
      const n = node(r, c);
      const d = metresBetween(p.lon, p.lat, n.lon, n.lat);
      if (d <= radiusM) out.push({ c: n, d });
    }
  }
  return out.sort((a, b) => a.d - b.d).map((o) => o.c);
}
