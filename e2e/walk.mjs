/**
 * End-to-end test: run `npm run e2e` (build + this).
 *
 * Serves dist/, drives the app in headless Chromium with a made-up city (vector tiles cut from
 * fixtures/synthetic-city.mjs, terrain from fixtures/terrain.mjs) and an emulated GPS walk.
 * Saves screenshots to e2e/out/. Fails on any console error, page error or unmet expectation.
 */

import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorld } from './fixtures/synthetic-city.mjs';
import { terrainTile } from './fixtures/terrain.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
const out = join(here, 'out');
mkdirSync(out, { recursive: true });
if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/ is missing: run `npm run build` first (or `npm run e2e`).');
  process.exit(2);
}

// a spot in the made-up city
const START = { lat: 48.7765, lon: 9.1772 };
const M_LAT = 111200;
const M_LON = 111320 * Math.cos((START.lat * Math.PI) / 180);
const at = (e, n) => ({ latitude: START.lat + n / M_LAT, longitude: START.lon + e / M_LON, accuracy: 6 });

// ---- static server
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(dist, path);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

// ---- the made-up map
const geojsonvt = require('geojson-vt');
const vtpbf = require('vt-pbf');
const world = Object.fromEntries(
  Object.entries(buildWorld()).map(([k, v]) => [k, (geojsonvt.default ?? geojsonvt)(v, { maxZoom: 14, indexMaxZoom: 4, extent: 4096, buffer: 64, tolerance: 1 })]),
);
const TILE_TEMPLATE = 'https://tiles.openfreemap.org/planet/e2e/{z}/{x}/{y}.pbf';
function tileBytes(z, x, y) {
  const layers = {};
  for (const [name, idx] of Object.entries(world)) {
    const t = idx.getTile(z, x, y);
    if (t) layers[name] = t;
  }
  return Buffer.from(vtpbf.fromGeojsonVt(layers, { version: 2, extent: 4096 }));
}

let network = 'ok';
const requests = [];
const cors = { 'access-control-allow-origin': '*' };
async function routeAll(context) {
  await context.route(/^https?:\/\//, (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith(base)) return route.continue();
    requests.push({ url, method: req.method(), body: req.postData() });
    if (network === 'down') return route.abort('internetdisconnected');
    if (/tiles\.openfreemap\.org\/planet(\?.*)?$/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ tiles: [TILE_TEMPLATE] }) });
    let m = /\/(\d+)\/(\d+)\/(\d+)\.pbf/.exec(url);
    if (m) return route.fulfill({ status: 200, contentType: 'application/x-protobuf', headers: cors, body: tileBytes(+m[1], +m[2], +m[3]) });
    m = /terrarium\/(\d+)\/(\d+)\/(\d+)\.png/.exec(url);
    if (m) return route.fulfill({ status: 200, contentType: 'image/png', headers: cors, body: terrainTile(+m[1], +m[2], +m[3]) });
    if (/nominatim\.openstreetmap\.org/.test(url)) {
      const p = at(1500, 0);
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify([{ lat: String(p.latitude), lon: String(p.longitude), name: 'Testtown', display_name: 'Testtown, Nowhere' }]) });
    }
    return route.fulfill({ status: 404, headers: cors, body: '' });
  });
}

// ---- helpers
const failures = [];
const expect = (cond, msg) => {
  if (!cond) failures.push(msg);
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
};
const errors = [];
function watch(page) {
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
}
const state = (page) => page.evaluate(() => ({ ...window.__walk }));
async function waitFor(page, fn, what, timeout = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (fn(await state(page))) return true;
    await page.waitForTimeout(200);
  }
  failures.push(`timed out waiting for ${what}`);
  console.log(`✗ timed out waiting for ${what}`);
  return false;
}
/** Share of sampled screen pixels that are plain parchment (unwalked). */
async function paperShare(page, region) {
  const png = (await page.screenshot({ clip: region })).toString('base64');
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let paper = 0;
    let n = 0;
    for (let k = 0; k < d.length; k += 4 * 7) {
      n++;
      if (Math.abs(d[k] - 0xef) < 9 && Math.abs(d[k + 1] - 0xe6) < 9 && Math.abs(d[k + 2] - 0xd2) < 9) paper++;
    }
    return paper / n;
  }, png);
}
/** Walk east from (e0, n0) in steps of `step` m, one fix a second (a brisk walking pace). */
async function walkEast(context, page, e0, n0, steps, step = 5) {
  for (let i = 1; i <= steps; i++) {
    await context.setGeolocation(at(e0 + i * step, n0));
    await page.waitForTimeout(1050);
  }
}

// ---- run
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ ...devices['Pixel 7'], permissions: ['geolocation'], geolocation: at(0, 0), serviceWorkers: 'block' });
  await routeAll(context);
  const page = await context.newPage();
  watch(page);

  await page.goto(base);
  await page.waitForSelector('#btn-start');
  expect(await page.isVisible('#home h1'), 'home screen shows');
  expect((await page.textContent('#home .tagline')).includes('compass'), 'tagline in English');
  await page.screenshot({ path: join(out, '01-home.png') });

  // ---- a walk on medium
  await page.click('#btn-start');
  expect(await page.isVisible('#level'), 'level picker shows');
  await page.screenshot({ path: join(out, '02-level.png') });
  await page.click('#btn-go');
  await waitFor(page, (s) => s.stage === 'walk', 'the walk screen');
  await waitFor(page, (s) => s.area === 'ready', 'the map square to load');
  await page.waitForTimeout(500);
  const vp = page.viewportSize();
  const centre = { x: vp.width / 2 - 60, y: vp.height / 2 - 60, width: 120, height: 120 };
  const corner = { x: 0, y: 140, width: 90, height: 90 };
  expect((await paperShare(page, corner)) > 0.9, 'before walking far, the map away from you is blank parchment');

  await walkEast(context, page, 0, 0, 24);
  let s = await state(page);
  expect(s.kept >= 15, `GPS fixes become the walk (${s.kept} points kept)`);
  // ~120 m walked at 50 m each side: about 2 × 50 × 120 + π × 50² ≈ 19,800 m²
  expect(s.revealedM2 > 14000 && s.revealedM2 < 26000, `the map opened along the path (${Math.round(s.revealedM2)} m²)`);
  expect(s.dot === true, 'on medium you see yourself');
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, '03-walking.png') });
  expect((await paperShare(page, centre)) < 0.5, 'around you the map shows');
  expect((await paperShare(page, corner)) > 0.9, 'away from your path it stays blank');
  expect((await page.textContent('#stat-distance')) !== '0 m', 'the distance counts up');

  // a GPS jump doesn't open the map where nobody walked
  const before = (await state(page)).revealedM2;
  await context.setGeolocation(at(700, 400));
  await page.waitForTimeout(1100);
  expect(Math.abs((await state(page)).revealedM2 - before) < 1, 'a GPS jump opens nothing');
  await context.setGeolocation(at(125, 0));
  await page.waitForTimeout(1100);

  await page.click('#btn-end');
  await waitFor(page, (s) => s.stage === 'summary', 'the summary');
  const sumNew = await page.textContent('#sum-new');
  expect(/\d/.test(sumNew) && !/^0 /.test(sumNew), `the summary counts the new map (${sumNew})`);
  await page.screenshot({ path: join(out, '04-summary.png') });
  await page.click('#btn-summary-done');

  // ---- it's kept on the device
  await page.reload();
  await page.waitForSelector('#btn-map');
  await page.click('#btn-map');
  await waitFor(page, (s) => s.stage === 'map' && s.area === 'ready', 'my map');
  s = await state(page);
  expect(s.revealedM2 > 14000, `the map is still there after a reload (${Math.round(s.revealedM2)} m²)`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(out, '05-my-map.png') });
  expect((await paperShare(page, { x: 0, y: vp.height / 2 - 100, width: vp.width, height: 200 })) < 0.9, 'my map opens on the walk, not on blank parchment');
  await page.click('#btn-home');

  // ---- hard: you don't see yourself, and the band is narrower
  await page.click('#btn-start');
  await page.check('input[name="level"][value="hard"]');
  await context.setGeolocation(at(0, 360));
  await page.click('#btn-go');
  await waitFor(page, (s) => s.stage === 'walk' && s.area === 'ready', 'the hard walk');
  const hardBefore = (await state(page)).revealedM2;
  await walkEast(context, page, 0, 360, 12);
  s = await state(page);
  expect(s.dot === false, 'on hard you don’t see yourself');
  expect(!(await page.isVisible('#btn-follow')), 'on hard there is no “Centre on me”');
  expect(s.buildings > 50, `the square has buildings (${s.buildings})`);
  const opened = s.revealedM2 - hardBefore;
  expect(opened > 2500 && opened < 6000, `hard opens 25 m each side (${Math.round(opened)} m² for ~60 m)`);
  await page.screenshot({ path: join(out, '06-hard.png') });
  await page.click('#btn-end');
  await page.click('#btn-summary-done');

  // ---- offline: save an area, then lose the network
  await page.click('#btn-offline');
  await page.fill('#offline-q', 'Testtown');
  await page.click('#offline-search button[type="submit"]');
  await page.waitForFunction(() => /Saved/.test(document.getElementById('offline-status').textContent), null, { timeout: 120000 });
  expect(true, 'an area is saved for offline');
  await page.screenshot({ path: join(out, '07-offline.png') });
  network = 'down';
  await page.click('#offline .back');
  await page.click('#btn-start');
  await context.setGeolocation(at(1500, 0));
  await page.click('#btn-go');
  await waitFor(page, (s) => s.area === 'ready', 'the saved square to load with no network');
  await walkEast(context, page, 1500, 0, 4);
  expect((await state(page)).kept >= 3, 'walking works offline');
  await page.click('#btn-end');
  await page.click('#btn-summary-done');
  network = 'ok';

  // ---- privacy: nothing is ever sent, only public map data fetched
  const sent = requests.filter((r) => r.method !== 'GET' || r.body);
  expect(sent.length === 0, 'no request sends anything (no uploads)');
  const hosts = new Set(requests.map((r) => new URL(r.url).host));
  const allowed = new Set(['tiles.openfreemap.org', 's3.amazonaws.com', 'nominatim.openstreetmap.org']);
  expect([...hosts].every((h) => allowed.has(h)), `only map hosts are contacted (${[...hosts].join(', ')})`);
  const coordsInUrls = requests.filter((r) => /nominatim/.test(r.url) === false && /lat=|lon=/.test(r.url));
  expect(coordsInUrls.length === 0, 'no position in any map request');

  // ---- delete everything
  await page.click('#btn-settings');
  await page.click('#btn-delete-walks');
  await page.click('#settings .back');
  await page.click('#btn-map');
  await page.waitForTimeout(500);
  expect(/No walks yet/.test(await page.textContent('#status')), 'after deleting, there are no walks');

  // ---- another language
  const de = await browser.newContext({ ...devices['Pixel 7'], locale: 'de-DE', serviceWorkers: 'block' });
  await routeAll(de);
  const p2 = await de.newPage();
  watch(p2);
  await p2.goto(base);
  expect((await p2.textContent('#btn-start')) === 'Losgehen', 'German follows the browser');
  await de.close();

  expect(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log('\nall passed');
