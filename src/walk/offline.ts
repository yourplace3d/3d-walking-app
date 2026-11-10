/**
 * "Save an area for offline": load the map squares around a point once, so their tiles land in
 * the device's map cache (geo/mapCache.ts). A walk there later loads the very same tiles: the
 * squares sit on a fixed grid and use the same terrain detail.
 */

import { DATA_ZOOM, fetchTiles, tilesForSquare } from '../geo/tiles';
import { loadHeightGrid } from '../geo/terrain';
import type { LngLat } from '../geo/projection';
import { AREA_SIZE_M, offlineAreas } from './area';

/** Terrain grid points per side of a square; the walk loads the same, so the same tiles. */
export const GRID_N = 257;

export interface SaveResult {
  saved: number;
  failed: number;
}

export async function saveAround(p: LngLat, onProgress: (done: number, total: number) => void, signal?: AbortSignal): Promise<SaveResult> {
  const areas = offlineAreas(p);
  let done = 0;
  let failed = 0;
  onProgress(0, areas.length);
  // two squares at a time: neighbours share most tiles, and the cache answers the repeats
  const queue = [...areas];
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      if (signal?.aborted) return;
      try {
        await Promise.all([loadHeightGrid(c, AREA_SIZE_M, GRID_N, signal), fetchTiles(tilesForSquare(c, AREA_SIZE_M, DATA_ZOOM), signal)]);
      } catch {
        failed++;
      }
      onProgress(++done, areas.length);
    }
  };
  await Promise.all([worker(), worker()]);
  return { saved: done - failed, failed };
}
