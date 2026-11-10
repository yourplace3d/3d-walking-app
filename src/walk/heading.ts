/**
 * Which way the phone points, in degrees clockwise from north. iPhones give it directly
 * (webkitCompassHeading); other phones give an absolute orientation (alpha counts anticlockwise,
 * and the screen may be turned). Only read while a walk is on; nothing is stored.
 */

export interface OrientationLike {
  alpha: number | null;
  absolute?: boolean;
  webkitCompassHeading?: number;
}

const norm = (deg: number) => ((deg % 360) + 360) % 360;

/** Heading from an orientation event, or null when it isn't tied to north. */
export function headingFrom(e: OrientationLike, screenAngle = 0): number | null {
  if (typeof e.webkitCompassHeading === 'number' && Number.isFinite(e.webkitCompassHeading)) {
    // already for the screen as held on iOS
    return norm(e.webkitCompassHeading);
  }
  if (e.absolute && typeof e.alpha === 'number' && Number.isFinite(e.alpha)) return norm(360 - e.alpha + screenAngle);
  return null;
}

/** Where on screen a bearing points, clockwise from straight up, for a camera turned by `azimuth`. */
export function screenAngle(bearing: number, azimuth: number): number {
  return norm(bearing + azimuth);
}

/** Smooth a noisy heading the short way round (k = share of the new reading). */
export function smoothHeading(prev: number | null, next: number, k = 0.25): number {
  if (prev === null) return norm(next);
  let d = norm(next) - prev;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return norm(prev + d * k);
}

type PermissionFn = () => Promise<'granted' | 'denied' | 'default'>;

/** Ask for motion access where the browser wants it (iOS); must run in a tap. */
export async function askOrientation(): Promise<boolean> {
  const D = (globalThis as { DeviceOrientationEvent?: { requestPermission?: PermissionFn } }).DeviceOrientationEvent;
  if (!D) return false;
  if (typeof D.requestPermission !== 'function') return true;
  try {
    return (await D.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/** Follow the heading; returns a function that stops it. */
export function watchHeading(fn: (deg: number) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  let smoothed: number | null = null;
  const onEvent = (ev: Event) => {
    const e = ev as DeviceOrientationEvent & { webkitCompassHeading?: number };
    const angle = (screen.orientation?.angle ?? 0) as number;
    const h = headingFrom({ alpha: e.alpha, absolute: ev.type === 'deviceorientationabsolute' || e.absolute, webkitCompassHeading: e.webkitCompassHeading }, angle);
    if (h === null) return;
    smoothed = smoothHeading(smoothed, h);
    fn(smoothed);
  };
  const absolute = 'ondeviceorientationabsolute' in window;
  const type = absolute ? 'deviceorientationabsolute' : 'deviceorientation';
  window.addEventListener(type, onEvent);
  return () => window.removeEventListener(type, onEvent);
}
