/**
 * Where positions come from. In the browser: the Geolocation API, which pauses while the screen is
 * off. In the iPhone app: the native location service, which keeps going with the screen locked
 * (iOS shows its blue location sign meanwhile). Positions stay on the device either way.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import type { BackgroundGeolocationPlugin, Location } from '@capacitor-community/background-geolocation';

/** One position, the same from either source. */
export interface Reading {
  lon: number;
  lat: number;
  /** m, 68 % confidence */
  accuracy: number;
  /** ms since 1970 */
  time: number;
  /** direction of travel (° from north), when moving */
  heading: number | null;
  /** m/s */
  speed: number | null;
}

export type GpsProblem = 'denied' | 'unavailable';

export interface GpsTexts {
  /** shown by the system while the app tracks in the background */
  backgroundTitle: string;
  backgroundMessage: string;
}

/** Whether this runs as the installed app (native GPS that works with the screen off). */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** A native location as a reading (null when it has no position). */
export function fromNative(loc: Location | undefined, now = Date.now()): Reading | null {
  if (!loc || !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) return null;
  return {
    lon: loc.longitude,
    lat: loc.latitude,
    accuracy: Number.isFinite(loc.accuracy) ? loc.accuracy : Infinity,
    time: loc.time ?? now,
    heading: loc.bearing ?? null,
    speed: loc.speed ?? null,
  };
}

/** A browser position as a reading. */
export function fromBrowser(pos: GeolocationPosition, now = Date.now()): Reading {
  const c = pos.coords;
  return {
    lon: c.longitude,
    lat: c.latitude,
    accuracy: c.accuracy,
    time: pos.timestamp || now,
    heading: c.heading !== null && Number.isFinite(c.heading) ? c.heading : null,
    speed: c.speed ?? null,
  };
}

/** The native plugin's error codes as our two kinds of trouble. */
export function nativeProblem(code: string | undefined): GpsProblem {
  return code === 'NOT_AUTHORIZED' ? 'denied' : 'unavailable';
}

let native: BackgroundGeolocationPlugin | null = null;

/**
 * Start positions; returns a function that stops them. Errors that only mean "no fix yet" are
 * not reported: the watch goes on.
 */
export function startGps(onReading: (r: Reading) => void, onProblem: (p: GpsProblem) => void, texts: GpsTexts): () => void {
  if (isNativeApp()) {
    native ??= registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');
    let id: string | null = null;
    let stopped = false;
    native
      .addWatcher(
        { backgroundTitle: texts.backgroundTitle, backgroundMessage: texts.backgroundMessage, requestPermissions: true, stale: false, distanceFilter: 0 },
        (loc, err) => {
          if (stopped) return;
          if (err) return onProblem(nativeProblem(err.code));
          const r = fromNative(loc);
          if (r) onReading(r);
        },
      )
      .then((w) => {
        id = w;
        if (stopped) void native!.removeWatcher({ id: w });
      })
      .catch(() => onProblem('unavailable'));
    return () => {
      stopped = true;
      if (id !== null) void native!.removeWatcher({ id });
    };
  }

  if (!navigator.geolocation) {
    onProblem('unavailable');
    return () => undefined;
  }
  const watch = navigator.geolocation.watchPosition(
    (pos) => onReading(fromBrowser(pos)),
    (err) => {
      if (err.code === err.PERMISSION_DENIED) onProblem('denied');
      else if (err.code === err.POSITION_UNAVAILABLE) onProblem('unavailable');
      // a timeout: keep waiting, the watch goes on
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 },
  );
  return () => navigator.geolocation.clearWatch(watch);
}
