/** Types the copied 3D engine shares with the app. */

/** Building colours: one colour for all, or coloured by height ('ramp'). */
export const BUILDING_STYLES = ['white', 'grey', 'sand', 'dark', 'ramp'] as const;
export type BuildingStyle = (typeof BUILDING_STYLES)[number];

export interface Layers {
  roads: boolean;
  water: boolean;
  green: boolean;
}

/** Orbit camera: angles in degrees, distance in metres, target offset in metres (E, N). */
export interface CameraState {
  azimuth: number;
  tilt: number;
  distance: number;
  targetE: number;
  targetN: number;
}
