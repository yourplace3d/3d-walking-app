/**
 * GPS fixes into a walked track. Phones report fixes that jump about, especially at the start and
 * between tall buildings, and a jump would open the map where nobody walked. A fix is kept only
 * if it is accurate enough, far enough from the last kept one to be movement, and not faster than
 * a person on foot could have got there.
 */

export interface Fix {
  lon: number;
  lat: number;
  /** radius of 68 % confidence (m), as the Geolocation API reports it */
  accuracy: number;
  /** ms since 1970 */
  time: number;
}

/** A kept point of a walk: [lon, lat, time in ms]. Arrays keep thousands of points small in storage. */
export type WalkPoint = [number, number, number];

/** Fixes less accurate than this are dropped (m). */
export const MAX_ACCURACY_M = 35;
/** Smaller steps than this are standing still or GPS noise (m). */
export const MIN_STEP_M = 4;
/** Faster than this between two fixes is a jump, not walking or running (m/s). */
export const MAX_SPEED_MS = 7;
/** Points further apart than this are not joined into one stretch of revealed path (m). */
export const MAX_JOIN_M = 120;

const R = 6371008.8;
const rad = Math.PI / 180;

/** Great-circle distance in metres. */
export function metresBetween(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export type FixVerdict = 'keep' | 'inaccurate' | 'still' | 'jump';

/** Whether a fix becomes the next point of the walk, given the last point kept (if any). */
export function judgeFix(fix: Fix, last: WalkPoint | null): FixVerdict {
  if (!Number.isFinite(fix.lon) || !Number.isFinite(fix.lat) || !(fix.accuracy <= MAX_ACCURACY_M)) return 'inaccurate';
  if (!last) return 'keep';
  const d = metresBetween(last[0], last[1], fix.lon, fix.lat);
  if (d < Math.max(MIN_STEP_M, fix.accuracy * 0.5)) return 'still';
  const dt = (fix.time - last[2]) / 1000;
  // a long pause (phone in a pocket, app closed) may well end somewhere else: start a new stretch
  if (dt > 0 && dt < 600 && d / dt > MAX_SPEED_MS) return 'jump';
  return 'keep';
}

/** Total length of a walk (m), not counting gaps that aren't joined. */
export function walkLength(points: readonly WalkPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = metresBetween(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
    if (d <= MAX_JOIN_M) total += d;
  }
  return total;
}
