import { describe, expect, it } from 'vitest';
import { fromBrowser, fromNative, isNativeApp, nativeProblem } from '../src/walk/gps';

describe('GPS sources', () => {
  it('runs as the website outside the app', () => {
    expect(isNativeApp()).toBe(false);
  });
  it('reads a native position', () => {
    const r = fromNative({ latitude: 52.26, longitude: 10.52, accuracy: 12, altitude: null, altitudeAccuracy: null, simulated: false, bearing: 90, speed: 1.4, time: 1000 });
    expect(r).toEqual({ lon: 10.52, lat: 52.26, accuracy: 12, time: 1000, heading: 90, speed: 1.4 });
  });
  it('fills in a missing time and skips an empty position', () => {
    const r = fromNative({ latitude: 1, longitude: 2, accuracy: 5, altitude: null, altitudeAccuracy: null, simulated: false, bearing: null, speed: null, time: null }, 42);
    expect(r?.time).toBe(42);
    expect(r?.heading).toBeNull();
    expect(fromNative(undefined)).toBeNull();
  });
  it('reads a browser position', () => {
    const pos = { timestamp: 7, coords: { latitude: 1, longitude: 2, accuracy: 9, heading: NaN, speed: null } } as unknown as GeolocationPosition;
    expect(fromBrowser(pos)).toEqual({ lon: 2, lat: 1, accuracy: 9, time: 7, heading: null, speed: null });
  });
  it('tells a refusal from other trouble', () => {
    expect(nativeProblem('NOT_AUTHORIZED')).toBe('denied');
    expect(nativeProblem(undefined)).toBe('unavailable');
  });
});
