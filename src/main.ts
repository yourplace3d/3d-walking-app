/**
 * Walk it 3D: walk your own city with only a 3D map and a compass. The map has no names and no
 * labels, and it only appears where you have walked.
 *
 * Privacy: the position is read only while a walk is on (and the app open); walks and the map
 * they reveal stay in this browser (walk/walks.ts). The app fetches public map data for the
 * square it shows, nothing else.
 */

import './styles.css';
import { CircleGeometry, ConeGeometry, Group, Mesh, MeshBasicMaterial, RingGeometry } from 'three';
import { searchOnce } from './geo/geocode';
import { makeProjector, type LngLat } from './geo/projection';
import { DATA_ZOOM, fetchTiles, parseTiles, tilesForSquare } from './geo/tiles';
import { loadHeightGrid } from './geo/terrain';
import { clearMapCache, mapCacheSize } from './geo/mapCache';
import { areaText, bytes, distance, t, translatePage } from './i18n';
import { CityModel } from './scene/cityModel';
import { isWebGL2Available, Viewer } from './scene/viewer';
import { AREA_SIZE_M, areaCentre, areaKey, needsRecentre } from './walk/area';
import { Fog, fogBuildings, fogGround } from './walk/fog';
import { askOrientation, screenAngle, watchHeading } from './walk/heading';
import { isLevel, LEVEL_RULES, type Level } from './walk/levels';
import { GRID_N, saveAround } from './walk/offline';
import { newlyRevealedM2, RevealMask } from './walk/reveal';
import { joins, judgeFix, metresBetween, Tracker, walkLength, type Fix } from './walk/track';
import { IdbStore, newWalk, type Walk } from './walk/walks';

type Screen = 'home' | 'level' | 'walk' | 'map' | 'summary' | 'offline' | 'settings';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Cells of the reveal mask per side of a square: 2 m each. */
const MASK_PX = 1000;
/** Save the walk at most this often while walking (ms). */
const SAVE_EVERY_MS = 5000;
/** The camera on a walk: tilted so buildings stand up, close enough to see the street you're in. */
const WALK_CAMERA = { azimuth: 0, tilt: 55, distance: 300 };
/** Hills a little higher than life, so slopes read on a phone. */
const EXAGGERATION = 2;
/** How dark the contour lines are (0–1). */
const CONTOUR_STRENGTH = 0.4;

const store = new IdbStore();
let walks: Walk[] = [];
let current: Walk | null = null;
let screenNow: Screen = 'home';

// test hooks (e2e): read-only view of what the page is doing
const debug: Record<string, unknown> = { stage: 'home', area: null, revealedM2: 0, kept: 0 };
(window as unknown as { __walk: typeof debug }).__walk = debug;

translatePage();

const webgl = isWebGL2Available();
const viewer = webgl ? new Viewer($<HTMLCanvasElement>('scene')) : null;
if (viewer) viewer.showContactShadow = false;
if (!webgl) {
  $('unsupported').hidden = false;
  for (const id of ['btn-start', 'btn-continue', 'btn-map']) ($(id) as HTMLButtonElement).disabled = true;
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}

// ------------------------------------------------------------------ screens

function setScreen(s: Screen): void {
  screenNow = s;
  document.body.dataset.screen = s;
  for (const el of document.querySelectorAll<HTMLElement>('[data-for]')) el.hidden = !el.dataset.for!.split(' ').includes(s);
  debug.stage = s;
}

function setStatus(text: string, retry?: () => void): void {
  const el = $('status');
  el.textContent = text;
  if (retry) {
    const b = document.createElement('button');
    b.textContent = t.retry;
    b.className = 'link';
    b.addEventListener('click', retry, { once: true });
    el.append(' ', b);
  }
}

async function refreshHome(): Promise<void> {
  walks = await store.all();
  const open = walks.find((w) => w.endedAt === null && w.points.length > 0);
  $('btn-continue').hidden = !open || !webgl;
  ($('btn-map') as HTMLButtonElement).disabled = !webgl;
}

// ------------------------------------------------------------------ the map square

interface Area {
  centre: LngLat;
  model: CityModel;
  mask: RevealMask;
  fog: Fog;
  toLocal: (lon: number, lat: number) => [number, number];
}

let area: Area | null = null;
let areaToken = 0;
let areaLoading: LngLat | null = null;

/** The walker's mark: a dot with a wedge for the way the phone points. */
const marker = new Group();
const dot = new Mesh(new CircleGeometry(4, 32), new MeshBasicMaterial({ color: 0xa3237e, depthTest: false, transparent: true }));
const halo = new Mesh(new RingGeometry(4, 6, 32), new MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }));
const wedge = new Mesh(new ConeGeometry(3.5, 10, 3), new MeshBasicMaterial({ color: 0xa3237e, depthTest: false, transparent: true }));
dot.rotation.x = halo.rotation.x = -Math.PI / 2;
wedge.rotation.x = -Math.PI / 2;
wedge.position.set(0, 0, -10);
const wedgeHolder = new Group();
wedgeHolder.add(wedge);
wedgeHolder.visible = false;
marker.add(halo, dot, wedgeHolder);
marker.renderOrder = 10;
for (const m of [dot, halo, wedge]) m.renderOrder = 10;
marker.visible = false;

/** All walks to draw: the stored ones and the one on now. */
function allWalks(): Walk[] {
  return current ? [...walks.filter((w) => w.id !== current!.id), current] : walks;
}

/** Load the square around `centre` and fog it. Resolves when the terrain shows. */
async function loadArea(centre: LngLat, focus?: { at: LngLat; distance?: number }): Promise<void> {
  if (!viewer) return;
  if (area && areaKey(area.centre) === areaKey(centre)) return;
  if (areaLoading && areaKey(areaLoading) === areaKey(centre)) return;
  const token = ++areaToken;
  areaLoading = centre;
  const stale = () => token !== areaToken;
  if (!area) setStatus(t.loadingMap);
  debug.area = 'loading';

  const tilesP = fetchTiles(tilesForSquare(centre, AREA_SIZE_M, DATA_ZOOM)).then((tl) => parseTiles(tl, centre, AREA_SIZE_M));
  tilesP.catch(() => undefined);
  let grid;
  try {
    grid = await loadHeightGrid(centre, AREA_SIZE_M, GRID_N);
  } catch (err) {
    if (stale()) return;
    areaLoading = null;
    console.warn('terrain failed', err);
    debug.area = 'error';
    setStatus(navigator.onLine === false ? t.offlineMissing : t.mapFailed, () => void loadArea(centre));
    return;
  }
  if (stale()) return;

  const mask = new RevealMask(centre, AREA_SIZE_M, MASK_PX);
  for (const w of allWalks()) mask.addWalk(w);
  const fog = new Fog(mask);
  const gl = viewer.renderer.getContext();
  const px = Math.min(viewer.small ? 2048 : 4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
  const model = new CityModel(grid, px, '#a3237e');
  model.setExaggeration(EXAGGERATION);
  // contour lines, as on an orienteering map: they show only where the map is revealed
  model.setContours(true);
  // soft: in flat cities the terrain data is noisy, and strong lines would zigzag across the streets
  model.contour.value = CONTOUR_STRENGTH;
  model.showPin(false);
  // the map has no edge: no plinth walls, no base, just the surface on parchment
  model.terrain.walls.visible = false;
  model.terrain.base.visible = false;
  fogGround(model.terrain.surface.material, fog.uniforms);
  model.group.add(marker);

  // keep the camera's view on the same spot of the ground when the square moves under it
  const old = area;
  const keep = old ? viewer.getCameraState() : null;
  let cam = keep;
  if (old && keep) {
    const ll = makeProjector(old.centre).toLngLat(keep.targetE, keep.targetN);
    const [e, n] = makeProjector(centre).toLocal(ll.lon, ll.lat);
    cam = { ...keep, targetE: e, targetN: n };
  }
  area = { centre, model, mask, fog, toLocal: makeProjector(centre).toLocal };
  areaLoading = null;
  viewer.setModel(model);
  if (old) {
    old.model.group.remove(marker);
    old.model.dispose();
    old.fog.dispose();
  }
  if (!cam) {
    // a fresh map: look at the walker (or the walks), not at the middle of the square
    const [e, n] = focus ? makeProjector(centre).toLocal(focus.at.lon, focus.at.lat) : [0, 0];
    cam = { ...WALK_CAMERA, distance: focus?.distance ?? WALK_CAMERA.distance, targetE: e, targetN: n };
  }
  viewer.setCameraState(cam);
  debug.area = 'terrain';
  debug.revealedM2 = mask.revealedM2();
  model.onBuildings = (mesh) => fogBuildings(mesh, fog.uniforms);
  if (lastFix) placeMarker(lastFix);
  setStatus(lastFixText());

  try {
    const data = await tilesP;
    if (stale()) return;
    model.setBuildingSpecs(data.buildings.map((b) => ({ ...b, estimated: false })));
    debug.buildings = model.stats().buildings;
    model.setFeatures(data.features);
    viewer.retarget();
    debug.area = 'ready';
  } catch (err) {
    if (stale()) return;
    console.warn('map tiles failed', err);
    debug.area = 'error';
    setStatus(navigator.onLine === false ? t.offlineMissing : t.mapFailed, () => {
      area = null;
      void loadArea(centre);
    });
  }
  viewer.requestRender();
}

// ------------------------------------------------------------------ walking

let watchId: number | null = null;
let stopHeading: (() => void) | null = null;
let lastFix: Fix | null = null;
let lastSave = 0;
let follow = true;
let heading: number | null = null;
/** the camera has been aimed at the walker once on this walk (on hard it then stays put) */
let aimed = false;
/** where this outing started in the walk's points (a walk can be continued many times) */
let sessionStart = 0;
let tracker = new Tracker();

function rules() {
  return LEVEL_RULES[current?.level ?? 'medium'];
}

function lastFixText(): string {
  if (screenNow !== 'walk') return '';
  if (!lastFix) return t.waitingGps;
  const m = String(Math.round(lastFix.accuracy));
  return judgeFix(lastFix, null) === 'inaccurate' ? t.gpsWeak(m) : t.gpsAccuracy(m);
}

async function startWalk(level: Level, resume: Walk | null): Promise<void> {
  // in the tap: iPhones only allow asking for the compass here
  const compassOk = await askOrientation();
  current = resume ?? newWalk(level);
  if (!resume) {
    // a new walk ends any walk left open
    for (const w of walks.filter((x) => x.endedAt === null)) {
      w.endedAt = w.points.at(-1)?.[2] ?? w.startedAt;
      await store.put(w);
    }
    await store.put(current);
    walks = await store.all();
  } else {
    await store.put(current);
  }
  sessionStart = current.points.length;
  // a phone may first hand over a position from before the walk started
  tracker = new Tracker(Date.now() - 5000);
  lastFix = null;
  follow = rules().showDot;
  marker.visible = false;
  $('stat-level').textContent = t[`level_${current.level}`];
  setScreen('walk');
  $('btn-follow').hidden = !rules().showDot;
  aimed = false;
  setStatus(t.waitingGps);
  updateStats();
  if (!navigator.geolocation) {
    setStatus(t.gpsUnavailable);
    return;
  }
  watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
  if (compassOk) {
    stopHeading = watchHeading((h) => {
      heading = h;
      updateCompass();
    });
  }
  window.setTimeout(() => {
    if (screenNow === 'walk' && heading === null) $('compass').title = t.compassNoHeading;
  }, 4000);
  // where the walk was, show it straight away (a resumed walk)
  const last = current.points.at(-1);
  if (last) void loadArea(areaCentre({ lon: last[0], lat: last[1] }), { at: { lon: last[0], lat: last[1] } });
}

function onPosition(pos: GeolocationPosition): void {
  if (!current) return;
  const fix: Fix = { lon: pos.coords.longitude, lat: pos.coords.latitude, accuracy: pos.coords.accuracy, time: pos.timestamp || Date.now() };
  lastFix = fix;
  // without a compass, the way you walk is the best heading there is
  if (heading === null && pos.coords.heading !== null && Number.isFinite(pos.coords.heading) && (pos.coords.speed ?? 0) > 0.5) {
    wedgeHolder.visible = rules().showDot;
    wedgeHolder.rotation.y = -((pos.coords.heading ?? 0) * Math.PI) / 180;
  }
  const prev = current.points.at(-1) ?? null;
  const { verdict, point: p } = tracker.next(fix, prev);
  const here = { lon: fix.lon, lat: fix.lat };
  // only fixes that count move the map: a GPS jump must not load another square
  if (!area && !areaLoading && (verdict === 'keep' || verdict === 'still')) void loadArea(areaCentre(here), { at: here });
  else if (area && p && needsRecentre(area.centre, here) && areaKey(areaCentre(here)) !== areaKey(area.centre)) void loadArea(areaCentre(here));
  if (p) {
    current.points.push(p);
    debug.kept = current.points.length;
    if (area) {
      if (area.mask.addStep(prev && joins(prev, p) ? prev : null, p, rules().revealM)) {
        area.fog.update();
        debug.revealedM2 = area.mask.revealedM2();
      }
    }
    if (fix.time - lastSave > SAVE_EVERY_MS) {
      lastSave = fix.time;
      void store.put(current);
    }
  }
  placeMarker(fix);
  setStatus(lastFixText());
  updateStats();
  viewer?.requestRender();
}

function onPositionError(err: GeolocationPositionError): void {
  if (err.code === err.PERMISSION_DENIED) setStatus(t.gpsDenied);
  else if (err.code === err.POSITION_UNAVAILABLE) setStatus(t.gpsUnavailable);
  // a timeout: keep waiting, the watch goes on
}

function placeMarker(fix: Fix): void {
  if (!area || !viewer) return;
  const [e, n] = area.toLocal(fix.lon, fix.lat);
  const inside = Math.abs(e) < AREA_SIZE_M / 2 && Math.abs(n) < AREA_SIZE_M / 2;
  marker.visible = rules().showDot && inside && screenNow === 'walk';
  debug.dot = marker.visible;
  marker.position.set(e, area.model.groundY(e, n) + 3, -n);
  if (inside && (!aimed || (follow && rules().showDot))) {
    viewer.setCameraState({ ...viewer.getCameraState(), targetE: e, targetN: n }, aimed);
    aimed = true;
  }
  viewer.requestRender();
}

function updateStats(): void {
  if (!current) return;
  $('stat-distance').textContent = distance(walkLength(current.points));
}

function updateCompass(): void {
  if (!viewer) return;
  const az = viewer.getCameraState().azimuth;
  $('compass-north').setAttribute('transform', `rotate(${screenAngle(0, az).toFixed(1)})`);
  const h = $('compass-heading');
  h.hidden = heading === null || screenNow !== 'walk';
  if (heading !== null) {
    h.setAttribute('transform', `rotate(${screenAngle(heading, az).toFixed(1)})`);
    wedgeHolder.visible = rules().showDot;
    wedgeHolder.rotation.y = -(heading * Math.PI) / 180;
    viewer.requestRender();
  }
}

async function endWalk(): Promise<void> {
  if (!current) return;
  if (!confirm(t.endWalkConfirm)) return;
  stopWatching();
  current.endedAt = Date.now();
  await store.put(current);
  // what this outing added: its own stretch, against everything walked before it
  const earlier = { level: current.level, points: current.points.slice(0, sessionStart) };
  const outing = { level: current.level, points: current.points.slice(Math.max(0, sessionStart - 1)) };
  const others = [...walks.filter((w) => w.id !== current!.id), earlier];
  $('sum-distance').textContent = distance(walkLength(outing.points));
  $('sum-new').textContent = areaText(newlyRevealedM2(outing, others));
  current = null;
  walks = await store.all();
  marker.visible = false;
  setScreen('summary');
}

function stopWatching(): void {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  stopHeading?.();
  stopHeading = null;
  heading = null;
  void setWakeLock(false);
  ($('wake') as HTMLInputElement).checked = false;
}

// keep the screen on, only while asked and only during a walk
let wakeLock: { release(): Promise<void> } | null = null;
async function setWakeLock(on: boolean): Promise<void> {
  const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
  if (!on) {
    await wakeLock?.release().catch(() => undefined);
    wakeLock = null;
    return;
  }
  try {
    wakeLock = (await nav.wakeLock?.request('screen')) ?? null;
  } catch {
    wakeLock = null;
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && ($('wake') as HTMLInputElement).checked && current) void setWakeLock(true);
  // the walk is saved when the page goes away (a phone may close it without warning)
  if (document.visibilityState === 'hidden' && current) void store.put(current);
});

// ------------------------------------------------------------------ the map of all walks

/** The walk that went on most recently (by its last point). */
function lastWalkWithPoints(): Walk | undefined {
  return walks.filter((w) => w.points.length).sort((a, b) => a.points.at(-1)![2] - b.points.at(-1)![2]).at(-1);
}

async function showMap(): Promise<void> {
  walks = await store.all();
  setScreen('map');
  const lastWalk = lastWalkWithPoints();
  $('btn-walk-on').hidden = !lastWalk;
  const last = lastWalk?.points.at(-1);
  if (!lastWalk || !last) {
    setStatus(t.noWalksYet);
    return;
  }
  marker.visible = false;
  setStatus('');
  if (area) {
    // walks may have changed since the square was drawn
    area.mask.clear();
    for (const w of walks) area.mask.addWalk(w);
    area.fog.update();
    viewer?.requestRender();
  }
  // frame the last walk
  let w = Infinity, so = Infinity, e = -Infinity, n = -Infinity;
  for (const [lon, lat] of lastWalk.points) {
    w = Math.min(w, lon); e = Math.max(e, lon); so = Math.min(so, lat); n = Math.max(n, lat);
  }
  const mid = { lon: (w + e) / 2, lat: (so + n) / 2 };
  const extent = Math.max(metresBetween(w, mid.lat, e, mid.lat), metresBetween(mid.lon, so, mid.lon, n));
  const focus = { at: mid, distance: Math.min(2400, Math.max(WALK_CAMERA.distance, extent * 2.2)) };
  const centre = areaCentre(mid);
  if (area && areaKey(area.centre) === areaKey(centre)) {
    const [fe, fn] = area.toLocal(mid.lon, mid.lat);
    viewer?.setCameraState({ ...WALK_CAMERA, distance: focus.distance, targetE: fe, targetN: fn }, true);
  } else {
    area = null;
    await loadArea(centre, focus);
  }
  if (screenNow === 'map') setStatus('');
}

// double-tap the map to move the square there (to look at walks further away)
viewer?.onDoubleTap((x, y) => {
  if (screenNow !== 'map' || !area) return;
  const hit = viewer.pick(x, y);
  if (!hit) return;
  const ll = makeProjector(area.centre).toLngLat(hit.e, hit.n);
  void loadArea(areaCentre(ll));
});

viewer?.onCameraChange(() => updateCompass());

// ------------------------------------------------------------------ offline

let saving: AbortController | null = null;

async function saveOffline(where: LngLat, name: string): Promise<void> {
  saving?.abort();
  saving = new AbortController();
  const status = $('offline-status');
  const res = await saveAround(where, (done, total) => (status.textContent = t.saving(done, total)), saving.signal);
  status.textContent = res.failed ? t.saveFailed : t.saved(name);
  void showCacheSize();
}

async function showCacheSize(): Promise<void> {
  const { tiles, bytes: b } = await mapCacheSize();
  $('offline-size').textContent = tiles && b ? t.storageUsed(bytes(b)) : '';
}

function here(): Promise<LngLat> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('no geolocation'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lon: p.coords.longitude, lat: p.coords.latitude }),
      reject,
      { enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 },
    );
  });
}

// ------------------------------------------------------------------ controls

function levelChosen(): Level {
  const v = document.querySelector<HTMLInputElement>('input[name="level"]:checked')?.value;
  return isLevel(v) ? v : 'medium';
}

$('btn-start').addEventListener('click', () => setScreen('level'));
$('btn-go').addEventListener('click', () => void startWalk(levelChosen(), null));
$('btn-continue').addEventListener('click', () => {
  const open = walks.find((w) => w.endedAt === null && w.points.length > 0);
  if (open) void startWalk(open.level, open);
});
$('btn-map').addEventListener('click', () => void showMap());
$('btn-offline').addEventListener('click', () => {
  $('offline-status').textContent = '';
  setScreen('offline');
  void showCacheSize();
});
$('btn-settings').addEventListener('click', () => {
  $('settings-status').textContent = '';
  setScreen('settings');
});
for (const b of document.querySelectorAll('button.back')) {
  b.addEventListener('click', () => {
    saving?.abort();
    setScreen('home');
    void refreshHome();
  });
}
$('btn-end').addEventListener('click', () => void endWalk());
$('btn-summary-done').addEventListener('click', () => {
  setScreen('home');
  void refreshHome();
});
// pick up the last walk where it stopped: same walk, same level, the map keeps growing
$('btn-walk-on').addEventListener('click', () => {
  const last = lastWalkWithPoints();
  if (!last) return;
  last.endedAt = null;
  void startWalk(last.level, last);
});
$('btn-home').addEventListener('click', () => {
  setScreen('home');
  void refreshHome();
});
$('btn-follow').addEventListener('click', () => {
  follow = true;
  if (lastFix) placeMarker(lastFix);
});
$('compass').addEventListener('click', () => viewer?.resetNorth());
// moving the map yourself stops it following you
$('scene').addEventListener('pointerdown', () => {
  if (screenNow === 'walk') follow = false;
});
$('wake').addEventListener('change', (e) => void setWakeLock((e.target as HTMLInputElement).checked));

$('btn-save-here').addEventListener('click', async () => {
  $('offline-status').textContent = t.waitingGps;
  try {
    await saveOffline(await here(), t.yourLocation);
  } catch {
    $('offline-status').textContent = t.gpsUnavailable;
  }
});
$('offline-search').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = ($('offline-q') as HTMLInputElement).value.trim();
  if (!q) return;
  const status = $('offline-status');
  try {
    const place = await searchOnce(q);
    if (!place) {
      status.textContent = t.nothingFound(q);
      return;
    }
    await saveOffline(place.center, place.label || t.thisPlace);
  } catch {
    status.textContent = t.searchFailed;
  }
});

$('btn-delete-walks').addEventListener('click', async () => {
  if (!confirm(t.deleteWalksConfirm)) return;
  await store.clear();
  walks = [];
  if (area) {
    area.mask.clear();
    area.fog.update();
    viewer?.requestRender();
  }
  $('settings-status').textContent = t.deletedWalks;
  void refreshHome();
});
$('btn-delete-map').addEventListener('click', async () => {
  await clearMapCache();
  $('settings-status').textContent = t.deletedMapData;
});

setScreen('home');
void refreshHome();

// ------------------------------------------------------------------ video recording (tools/video)

// Only with ?video in the address: lets tools/video/render.mjs load a square, reveal a made-up walk
// and set the camera frame by frame. Nothing here runs for a walker.
if (new URLSearchParams(location.search).has('video') && viewer) {
  const v = viewer;
  (window as unknown as { __walkVideo: unknown }).__walkVideo = {
    async load(lat: number, lon: number) {
      setScreen('map');
      for (const el of document.querySelectorAll<HTMLElement>('.hud, .card')) el.hidden = true;
      area = null;
      await loadArea({ lat, lon });
    },
    stage: () => debug.area,
    contours(strength: number) {
      if (area) area.model.contour.value = strength;
      v.requestRender();
    },
    info: () => (area ? { ...area.model.stats(), interval: area.model.uniforms.uInterval.value } : null),
    /** walkable lines (local metres), for the route */
    streets: () =>
      (area?.model.featureSet?.lines ?? [])
        .filter((l) => ['primary', 'secondary', 'tertiary', 'minor', 'path', 'service'].includes(l.kind))
        .map((l) => ({ kind: l.kind, pts: l.pts })),
    ground: (e: number, n: number) => area?.model.groundY(e, n) ?? 0,
    /** open the map along a path of local points, `radius` m each side */
    reveal(path: Array<[number, number]>, radius: number) {
      if (!area) return;
      area.mask.clear();
      const ll = (p: [number, number]) => {
        const q = makeProjector(area!.centre).toLngLat(p[0], p[1]);
        return [q.lon, q.lat, 0] as [number, number, number];
      };
      for (let i = 0; i < path.length; i++) area.mask.addStep(i ? ll(path[i - 1]) : null, ll(path[i]), radius);
      area.fog.update();
      v.requestRender();
    },
    marker(e: number | null, n = 0, headingDeg = 0) {
      if (!area || e === null) {
        marker.visible = false;
        return;
      }
      marker.visible = true;
      // seen from further away than on a walk: a bigger dot
      marker.scale.setScalar(1.8);
      marker.position.set(e, area.model.groundY(e, n) + 3, -n);
      wedgeHolder.visible = true;
      wedgeHolder.rotation.y = -(headingDeg * Math.PI) / 180;
      v.requestRender();
    },
    camera(c: { azimuth: number; tilt: number; distance: number; targetE: number; targetN: number }) {
      v.setCameraState(c);
    },
  };
}
