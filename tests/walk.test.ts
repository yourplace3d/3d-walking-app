import { describe, expect, it } from 'vitest';
import { makeProjector } from '../src/geo/projection';
import { AREA_SIZE_M, areaCentre, areaKey, needsRecentre, offlineAreas, RECENTRE_M } from '../src/walk/area';
import { headingFrom, screenAngle, smoothHeading } from '../src/walk/heading';
import { LEVEL_RULES } from '../src/walk/levels';
import { FEATHER_M, newlyRevealedM2, RevealMask } from '../src/walk/reveal';
import { CONFIRM_JUMP_MS, joins, judgeFix, MAX_ACCURACY_M, metresBetween, Tracker, walkLength, type WalkPoint } from '../src/walk/track';
import { isWalk, MemoryStore, newWalk } from '../src/walk/walks';

const C = { lat: 48.78, lon: 9.18 };
const proj = makeProjector(C);
/** a point e, n metres from C at time s (seconds) */
const pt = (e: number, n: number, s = 0): WalkPoint => {
  const ll = proj.toLngLat(e, n);
  return [ll.lon, ll.lat, s * 1000];
};
const fix = (e: number, n: number, s: number, accuracy = 8) => {
  const [lon, lat, time] = pt(e, n, s);
  return { lon, lat, time, accuracy };
};

describe('levels', () => {
  it('opens 100, 50 and 25 m, and hides you only on hard', () => {
    expect(LEVEL_RULES.easy).toMatchObject({ revealM: 100, showDot: true });
    expect(LEVEL_RULES.medium).toMatchObject({ revealM: 50, showDot: true });
    expect(LEVEL_RULES.hard).toMatchObject({ revealM: 25, showDot: false });
  });
  it('lets a wider band take a rougher GPS fix, hard stays strict', () => {
    expect(LEVEL_RULES.easy.maxAccuracyM).toBe(60);
    expect(LEVEL_RULES.medium.maxAccuracyM).toBe(45);
    expect(LEVEL_RULES.hard.maxAccuracyM).toBe(MAX_ACCURACY_M);
  });
});

describe('GPS fixes', () => {
  it('keeps the first good fix', () => {
    expect(judgeFix(fix(0, 0, 0), null)).toBe('keep');
  });
  it('drops fixes that are not accurate enough', () => {
    expect(judgeFix(fix(0, 0, 0, MAX_ACCURACY_M + 1), null)).toBe('inaccurate');
    expect(judgeFix({ ...fix(0, 0, 0), accuracy: NaN }, null)).toBe('inaccurate');
  });
  it('takes a rougher fix when the level allows it', () => {
    expect(judgeFix(fix(0, 0, 0, 50), null, 60)).toBe('keep');
    expect(judgeFix(fix(0, 0, 0, 50), null, 45)).toBe('inaccurate');
  });
  it('ignores standing still', () => {
    expect(judgeFix(fix(2, 1, 5), pt(0, 0, 0))).toBe('still');
  });
  it('keeps walking pace and drops jumps', () => {
    expect(judgeFix(fix(15, 0, 10), pt(0, 0, 0))).toBe('keep');
    expect(judgeFix(fix(300, 0, 10), pt(0, 0, 0))).toBe('jump');
  });
  it('accepts a far point after a long pause (a new stretch)', () => {
    expect(judgeFix(fix(900, 0, 1200), pt(0, 0, 0))).toBe('keep');
  });
  it('measures walks without joining gaps', () => {
    expect(metresBetween(...(pt(0, 0).slice(0, 2) as [number, number]), ...(pt(100, 0).slice(0, 2) as [number, number]))).toBeCloseTo(100, 0);
    expect(walkLength([pt(0, 0), pt(50, 0), pt(100, 0)])).toBeCloseTo(100, 0);
    expect(walkLength([pt(0, 0), pt(50, 0), pt(1000, 0)])).toBeCloseTo(50, 0);
  });
});

describe('map squares', () => {
  it('puts nearby points in the same square, on a fixed grid', () => {
    const a = areaCentre(C);
    expect(areaKey(areaCentre({ lat: C.lat + 0.0001, lon: C.lon + 0.0001 }))).toBe(areaKey(a));
    expect(metresBetween(C.lon, C.lat, a.lon, a.lat)).toBeLessThan(720);
  });
  it('moves to the next square only past the threshold', () => {
    const a = areaCentre(C);
    const pa = makeProjector(a);
    const near = pa.toLngLat(RECENTRE_M - 50, 0);
    const far = pa.toLngLat(RECENTRE_M + 50, 0);
    expect(needsRecentre(a, near)).toBe(false);
    expect(needsRecentre(a, far)).toBe(true);
    expect(areaKey(areaCentre(far))).not.toBe(areaKey(a));
  });
  it('keeps the walker well inside the square', () => {
    // the furthest a walker can be from the centre before a new square loads stays far from the edge
    expect(RECENTRE_M).toBeLessThan(AREA_SIZE_M / 2 - 300);
  });
  it('lists the squares to save, nearest first', () => {
    const list = offlineAreas(C, 2500);
    expect(list.length).toBeGreaterThan(15);
    expect(list.length).toBeLessThan(30);
    expect(areaKey(list[0])).toBe(areaKey(areaCentre(C)));
    const d = list.map((c) => metresBetween(C.lon, C.lat, c.lon, c.lat));
    expect([...d].sort((x, y) => x - y)).toEqual(d);
    expect(Math.max(...d)).toBeLessThanOrEqual(2500);
  });
});

describe('reveal mask', () => {
  it('opens nothing before a walk', () => {
    const m = new RevealMask(C, 2000, 500);
    expect(m.revealedM2()).toBe(0);
    expect(m.valueAt(0, 0)).toBe(0);
  });
  it('opens a band as wide as the level along the path', () => {
    for (const level of ['easy', 'medium', 'hard'] as const) {
      const r = LEVEL_RULES[level].revealM;
      const m = new RevealMask(C, 2000, 1000);
      m.addWalk({ level, points: [pt(-200, 0, 0), pt(-100, 0, 60), pt(0, 0, 120), pt(100, 0, 180), pt(200, 0, 240)] });
      // a 400 m stretch, 2r wide, with round ends
      const expected = 400 * 2 * r + Math.PI * r * r;
      expect(m.revealedM2()).toBeGreaterThan(expected * 0.95);
      expect(m.revealedM2()).toBeLessThan(expected * 1.05);
      expect(m.valueAt(0, r - FEATHER_M)).toBe(255);
      expect(m.valueAt(0, r + FEATHER_M)).toBe(0);
      expect(m.valueAt(0, -(r + FEATHER_M))).toBe(0);
    }
  });
  it('does not join points across a gap', () => {
    const m = new RevealMask(C, 2000, 1000);
    m.addWalk({ level: 'hard', points: [pt(-400, 0, 0), pt(400, 0, 10000)] });
    expect(m.valueAt(-400, 0)).toBe(255);
    expect(m.valueAt(400, 0)).toBe(255);
    expect(m.valueAt(0, 0)).toBe(0);
  });
  it('puts north at the top row', () => {
    const m = new RevealMask(C, 2000, 1000);
    m.addStep(null, pt(0, 900), 25);
    expect(m.data[Math.floor(100 / 2) * 1000 + 500]).toBe(255);
    expect(m.data[Math.floor(1900 / 2) * 1000 + 500]).toBe(0);
  });
  it('ignores walks outside the square', () => {
    const m = new RevealMask(C, 2000, 500);
    expect(m.addWalk({ level: 'easy', points: [pt(5000, 5000), pt(5050, 5000, 30)] })).toBe(false);
    expect(m.revealedM2()).toBe(0);
  });
  it('counts only the new map a walk opened', () => {
    const old = { level: 'medium' as const, points: [pt(0, 0, 0), pt(100, 0, 60)] };
    const again = { level: 'medium' as const, points: [pt(0, 0, 0), pt(100, 0, 60)] };
    expect(newlyRevealedM2(again, [old])).toBeLessThan(500);
    const fresh = { level: 'medium' as const, points: [pt(0, 500, 0), pt(100, 500, 60)] };
    const band = 100 * 100 + Math.PI * 50 * 50;
    expect(newlyRevealedM2(fresh, [old])).toBeGreaterThan(band * 0.9);
    expect(newlyRevealedM2(fresh, [old])).toBeLessThan(band * 1.1);
    expect(newlyRevealedM2({ level: 'easy', points: [] }, [])).toBe(0);
  });
});

describe('compass', () => {
  it('reads iPhone headings directly', () => {
    expect(headingFrom({ alpha: 10, webkitCompassHeading: 270 })).toBe(270);
  });
  it('turns absolute alpha into a heading', () => {
    expect(headingFrom({ alpha: 90, absolute: true })).toBe(270);
    expect(headingFrom({ alpha: 0, absolute: true })).toBe(0);
    expect(headingFrom({ alpha: 90, absolute: true }, 90)).toBe(0);
  });
  it('gives no heading without north', () => {
    expect(headingFrom({ alpha: 90, absolute: false })).toBeNull();
    expect(headingFrom({ alpha: null, absolute: true })).toBeNull();
  });
  it('shows bearings on screen for a turned map', () => {
    expect(screenAngle(0, 0)).toBe(0);
    expect(screenAngle(0, 90)).toBe(90);
    expect(screenAngle(270, 90)).toBe(0);
  });
  it('smooths the short way round', () => {
    expect(smoothHeading(null, 370)).toBe(10);
    expect(smoothHeading(350, 10, 0.5)).toBe(0);
    expect(smoothHeading(10, 350, 0.5)).toBe(0);
  });
});

describe('walk storage', () => {
  it('keeps walks in order and clears them', async () => {
    const s = new MemoryStore();
    const a = newWalk('easy', 1000);
    const b = newWalk('hard', 500);
    a.points.push(pt(0, 0, 1));
    await s.put(a);
    await s.put(b);
    expect((await s.all()).map((w) => w.id)).toEqual([b.id, a.id]);
    // stored copies: changing the walk afterwards doesn't change what's stored
    a.points.push(pt(10, 0, 2));
    expect((await s.all())[1].points.length).toBe(1);
    await s.clear();
    expect(await s.all()).toEqual([]);
  });
  it('accepts only well-formed walks from storage', () => {
    expect(isWalk(newWalk('medium'))).toBe(true);
    expect(isWalk({ ...newWalk('medium'), level: 'extreme' })).toBe(false);
    expect(isWalk({ ...newWalk('medium'), points: [[1, 2]] })).toBe(false);
    expect(isWalk(null)).toBe(false);
  });
});

describe('tracker', () => {
  it('ignores positions from before the walk', () => {
    const tr0 = new Tracker(0, 60);
    expect(tr0.next(fix(0, 0, 1000, 55), null).verdict).toBe('keep');
    const tr = new Tracker(100_000);
    expect(tr.next(fix(0, 0, 50), null).verdict).toBe('stale');
    expect(tr.next(fix(0, 0, 101), null).point).not.toBeNull();
  });
  it('drops a lone jump', () => {
    const tr = new Tracker();
    const last = pt(0, 0, 0);
    expect(tr.next(fix(500, 0, 1), last).verdict).toBe('jump');
    expect(tr.next(fix(5, 0, 2), last).verdict).toBe('keep');
    expect(tr.next(fix(500, 0, 3), last).point).toBeNull();
  });
  it('goes on from a jump the next fixes confirm, as a new stretch', () => {
    const tr = new Tracker();
    const last = pt(0, 0, 0);
    expect(tr.next(fix(500, 0, 1), last).point).toBeNull();
    expect(tr.next(fix(503, 0, 2), last).point).toBeNull();
    const r = tr.next(fix(508, 0, 1 + CONFIRM_JUMP_MS / 1000), last);
    expect(r.verdict).toBe('keep');
    expect(r.point?.[3]).toBe(1);
    // and the two places aren't joined
    expect(joins(last, r.point!)).toBe(false);
    expect(walkLength([last, r.point!])).toBe(0);
    const m = new RevealMask(C, 2000, 1000);
    m.addWalk({ level: 'hard', points: [pt(-100, 0, 0), r.point!] });
    expect(m.valueAt(200, 0)).toBe(0);
  });
  it('stores the stretch mark', () => {
    const w = newWalk('easy');
    w.points.push([1, 2, 3, 1]);
    expect(isWalk(w)).toBe(true);
    w.points.push([1, 2, 3, 2 as 1]);
    expect(isWalk(w)).toBe(false);
  });
});
