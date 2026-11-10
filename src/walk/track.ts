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

/**
 * A kept point of a walk: [lon, lat, time in ms], and a 4th element 1 when it starts a new stretch
 * (after a confirmed jump: not joined to the point before). Arrays keep thousands of points small.
 */
export type WalkPoint = [number, number, number, 1?];

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

/** Whether the path runs on from `prev` to `p` (else a gap: a new stretch starts at p). */
export function joins(prev: WalkPoint, p: WalkPoint): boolean {
  return p[3] !== 1 && metresBetween(prev[0], prev[1], p[0], p[1]) <= MAX_JOIN_M;
}

/** Total length of a walk (m), not counting gaps that aren't joined. */
export function walkLength(points: readonly WalkPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    if (joins(points[i - 1], points[i])) total += metresBetween(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
  }
  return total;
}

/** A jump confirmed by fixes for this long (ms) is where you really are: a new stretch starts there. */
export const CONFIRM_JUMP_MS = 3000;

/**
 * Turns fixes into points for one outing. Ignores positions older than the outing (a phone may
 * hand over a cached one first), and gets out of a jump: if the fixes after it agree with each
 * other for a few seconds, the walk goes on from there, without joining the two places.
 */
export class Tracker {
  private pending: WalkPoint | null = null;

  constructor(private readonly notBefore = 0) {}

  next(fix: Fix, last: WalkPoint | null): { verdict: FixVerdict | 'stale'; point: WalkPoint | null } {
    if (fix.time < this.notBefore) return { verdict: 'stale', point: null };
    const verdict = judgeFix(fix, last);
    if (verdict === 'keep') {
      this.pending = null;
      return { verdict, point: [fix.lon, fix.lat, fix.time] };
    }
    if (verdict !== 'jump') return { verdict, point: null };
    const p = this.pending;
    const agrees = p && judgeFix(fix, p) !== 'jump' && fix.time - p[2] >= CONFIRM_JUMP_MS;
    if (agrees) {
      this.pending = null;
      return { verdict: 'keep', point: [fix.lon, fix.lat, fix.time, 1] };
    }
    if (!p || judgeFix(fix, p) === 'jump') this.pending = [fix.lon, fix.lat, fix.time];
    return { verdict, point: null };
  }
}
