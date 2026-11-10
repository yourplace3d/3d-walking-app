/**
 * The three levels. A walk keeps the level it started with: how far the map opens around your
 * path, and whether your own position shows on it.
 */

export const LEVELS = ['easy', 'medium', 'hard'] as const;
export type Level = (typeof LEVELS)[number];

export interface LevelRules {
  /** how far the map opens on each side of your path (m) */
  revealM: number;
  /** your own position as a dot on the map */
  showDot: boolean;
  /**
   * GPS fixes less accurate than this don't open the map (m). Phones often fall back to rough
   * Wi-Fi or mast positions in town; a wide band can take a rougher fix than a narrow one.
   */
  maxAccuracyM: number;
}

export const LEVEL_RULES: Record<Level, LevelRules> = {
  easy: { revealM: 100, showDot: true, maxAccuracyM: 60 },
  medium: { revealM: 50, showDot: true, maxAccuracyM: 45 },
  hard: { revealM: 25, showDot: false, maxAccuracyM: 35 },
};

export function isLevel(v: unknown): v is Level {
  return typeof v === 'string' && (LEVELS as readonly string[]).includes(v);
}
