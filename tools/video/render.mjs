// Renders the videos from live map data, with a made-up walk along real streets revealing the map.
// Frames are captured one by one (exact timing even with software rendering) and encoded with ffmpeg.
//   node tools/video/render.mjs [promo|paris]   (after npm run build)
// Output: video-out/walk-it-3d-promo-9x16.mp4, walk-it-3d-paris-9x16.mp4 and a contact sheet each.
import { createServer } from 'node:http';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const root = join(import.meta.dirname, '..', '..');
const dist = join(root, 'dist');
const out = join(root, 'video-out');
mkdirSync(out, { recursive: true });

const SITE = 'yourplace3d.github.io/3d-walking-app';
const FPS = 30;
/** preview: STEP=30 renders one frame a second (no video), to check the look quickly */
const STEP = Number(process.env.STEP || 1);
const W = 1080;
const H = 1920;

/** Height as it is: exaggerated hills make city ground look bumpy on video. */
const EXAGGERATION = 1;
/** Fade through the parchment between cities (s): the map closes and the next one opens. */
const FADE_S = 0.55;

const VIDEOS = {
  // 15 s: three cities, each already partly walked, the walk going on; then the end card
  promo: {
    file: 'walk-it-3d-promo-9x16.mp4',
    scenes: [
      { place: 'Hong Kong', lat: 22.2795, lon: 114.1605, seconds: 4.4, before: 0, during: 560, radius: 50, lines: ['No street names.', ''], seed: 3 },
      { place: 'Porto', lat: 41.1405, lon: -8.611, seconds: 4.4, before: 0, during: 560, radius: 50, lines: ['No labels.', ''], seed: 5 },
      { place: 'Salzburg', lat: 47.7985, lon: 13.0455, seconds: 4.4, before: 0, during: 560, radius: 50, lines: ['The map appears', 'where you walk.'], seed: 7 },
    ],
    end: { seconds: 1.8, title: 'Walk it 3D', what: 'A map and a compass is all you get.', free: 'Free · No account · Your walks stay on your phone' },
  },
  // 20 s: Paris from blank parchment, revealed as the walk goes; then "walk it yourself"
  paris: {
    file: 'walk-it-3d-paris-9x16.mp4',
    scenes: [
      { place: 'Paris', lat: 48.8585, lon: 2.347, seconds: 17, before: 0, during: 1300, radius: 50, lines: ['Paris, downtown.', 'Revealed on foot.'], seed: 11, late: ['Wanna walk it yourself?', 'Name the city.'] },
    ],
    end: { seconds: 3, title: 'Walk it 3D', what: 'Wanna walk it yourself?', free: 'Any city · Free · No account' },
  },
};

// ------------------------------------------------------------------ a walk along real streets

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Street network as a graph: points snapped to 2 m so lines that meet share a node. */
function graph(streets) {
  const nodes = new Map();
  const key = (p) => `${Math.round(p[0] / 2)},${Math.round(p[1] / 2)}`;
  const node = (p) => {
    const k = key(p);
    if (!nodes.has(k)) nodes.set(k, { k, p, edges: [] });
    return nodes.get(k);
  };
  for (const s of streets) {
    for (let i = 1; i < s.pts.length; i++) {
      const a = node(s.pts[i - 1]);
      const b = node(s.pts[i]);
      if (a === b) continue;
      a.edges.push(b);
      b.edges.push(a);
    }
  }
  return nodes;
}

/** Streets a walker would follow: no footpaths through parks and courtyards, no service lanes. */
const STREET_KINDS = new Set(['primary', 'secondary', 'tertiary', 'minor']);

/** A walk of `length` m along streets, from near the centre, always heading for new ground, inside `limit` m. */
function walkRoute(streets, length, seed, limit = 750) {
  const all = [...graph(streets.filter((s) => STREET_KINDS.has(s.kind))).values()];
  // the biggest connected street network, so the walk can't get stuck in a dead-end piece
  const comp = new Map();
  let best = [];
  for (const n of all) {
    if (comp.has(n)) continue;
    const members = [n];
    comp.set(n, members);
    for (let i = 0; i < members.length; i++) for (const nb of members[i].edges) if (!comp.has(nb)) { comp.set(nb, members); members.push(nb); }
    if (members.length > best.length) best = members;
  }
  const rnd = mulberry(seed);
  let cur = best.reduce((b, n) => (Math.hypot(...n.p) < Math.hypot(...b.p) ? n : b));
  const start = cur.p;
  const path = [cur.p];
  const used = new Set();
  const visited = new Set([cur.k]);
  let dir = rnd() * Math.PI * 2;
  let prefer = dir;
  let total = 0;
  let sinceTurn = 0;
  while (total < length) {
    if (sinceTurn > 180) {
      prefer += (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.7);
      sinceTurn = 0;
    }
    let next = null;
    let bestScore = -Infinity;
    for (const nb of cur.edges) {
      const a = Math.atan2(nb.p[1] - cur.p[1], nb.p[0] - cur.p[0]);
      const e = [cur.k, nb.k].sort().join('|');
      let score = Math.cos(a - prefer) + Math.cos(a - dir) * 0.9 + rnd() * 0.25;
      if (used.has(e)) score -= 4;
      if (visited.has(nb.k)) score -= 1.5;
      if (Math.hypot(...nb.p) > limit) score -= 5;
      if (score > bestScore) {
        bestScore = score;
        next = nb;
      }
    }
    if (!next) break;
    const d = Math.hypot(next.p[0] - cur.p[0], next.p[1] - cur.p[1]);
    used.add([cur.k, next.k].sort().join('|'));
    visited.add(next.k);
    dir = Math.atan2(next.p[1] - cur.p[1], next.p[0] - cur.p[0]);
    if (Math.hypot(...next.p) > limit * 0.85) prefer = Math.atan2(start[1] - next.p[1], start[0] - next.p[0]);
    total += d;
    sinceTurn += d;
    path.push(next.p);
    cur = next;
  }
  return path;
}

/** The route up to distance s (m), ending exactly at s; and the walker's heading there. */
function upTo(path, s) {
  const outPts = [path[0]];
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const [a, b] = [path[i - 1], path[i]];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc + d >= s) {
      const t = d ? (s - acc) / d : 0;
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      outPts.push(p);
      const heading = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
      return { pts: outPts, at: p, heading };
    }
    acc += d;
    outPts.push(b);
  }
  const a = path.at(-2) ?? path[0];
  const b = path.at(-1);
  return { pts: outPts, at: b, heading: (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI };
}
const routeLength = (path) => path.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - path[i][0], p[1] - path[i][1]), 0);

// ------------------------------------------------------------------ static server for dist/

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const server = createServer((req, res) => {
  let f = join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  if (!existsSync(f)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(4322, '127.0.0.1', r));
const base = 'http://127.0.0.1:4322/?video';

// ------------------------------------------------------------------ the text layer

const icon = readFileSync(join(root, 'public', 'icon.svg'), 'utf8');
const CSS = `
  #promo { position: fixed; inset: 0; z-index: 100; pointer-events: none; color: #3a2e22; }
  #promo .scrim-top { position: absolute; left: 0; right: 0; top: 0; height: 560px; background: linear-gradient(#efe6d2 35%, rgba(239,230,210,0)); }
  #promo .scrim-bottom { position: absolute; left: 0; right: 0; bottom: 0; height: 380px; background: linear-gradient(rgba(239,230,210,0), #efe6d2 70%); }
  #promo .brand { position: absolute; top: 120px; left: 0; right: 0; text-align: center; font: 650 28px/1 Inter, sans-serif; letter-spacing: 0.2em; text-transform: uppercase; color: #a3237e; }
  #promo .caption { position: absolute; top: 210px; left: 60px; right: 60px; text-align: center; opacity: var(--cap, 0); transform: translateY(calc((1 - var(--cap, 0)) * 18px)); }
  #promo .caption div { font: 500 92px/1.05 Fraunces, Georgia, serif; letter-spacing: -0.015em; }
  #promo .late { position: absolute; top: 210px; left: 60px; right: 60px; text-align: center; opacity: var(--late, 0); }
  #promo .late div { font: 500 92px/1.05 Fraunces, Georgia, serif; letter-spacing: -0.015em; }
  #promo .late div + div { font-size: 56px; color: #a3237e; margin-top: 18px; font-style: italic; }
  #promo .place { position: absolute; bottom: 220px; left: 0; right: 0; text-align: center; opacity: var(--cap, 0); font: 600 30px/1 Inter, sans-serif; letter-spacing: 0.18em; text-transform: uppercase; color: #6b5a45; }
  #promo .credit { position: absolute; bottom: 70px; left: 0; right: 0; text-align: center; font: 400 20px/1 Inter, sans-serif; color: #8a7a64; }
  #promo .dip { position: absolute; inset: 0; background: #efe6d2; opacity: var(--dip, 1); }
  #promo .end { position: absolute; inset: 0; background: #efe6d2; opacity: var(--end, 0); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 24px; text-align: center; padding: 0 70px; }
  #promo .end svg { width: 190px; height: 190px; }
  #promo .end h1 { margin: 0; font: 500 128px/1 Fraunces, Georgia, serif; letter-spacing: -0.02em; }
  #promo .end .what { font: italic 400 50px/1.2 Fraunces, Georgia, serif; color: #a3237e; }
  #promo .end .free { font: 500 32px/1.35 Inter, sans-serif; color: #6b5a45; }
  #promo .end .url { margin-top: 20px; font: 600 38px/1 Inter, sans-serif; color: #3a2e22; padding: 18px 30px; border: 3px solid #a3237e; border-radius: 999px; }
  #promo .end .osm { position: absolute; bottom: 60px; font: 400 22px/1 Inter, sans-serif; color: #8a7a64; }
`;
const HTML = (end) => `
  <div id="promo">
    <div class="scrim-top"></div><div class="scrim-bottom"></div>
    <div class="brand">Walk it 3D</div>
    <div class="caption"><div class="l1"></div><div class="l2"></div></div>
    <div class="late"><div class="m1"></div><div class="m2"></div></div>
    <div class="place"></div>
    <div class="credit">Map data © OpenStreetMap contributors</div>
    <div class="dip"></div>
    <div class="end">
      ${icon}
      <h1>${end.title}</h1>
      <div class="what">${end.what}</div>
      <div class="free">${end.free}</div>
      <div class="url">${SITE}</div>
      <div class="osm">Map data © OpenStreetMap contributors</div>
    </div>
  </div>`;

// ------------------------------------------------------------------ rendering

const clamp = (x) => Math.max(0, Math.min(1, x));
const ease = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t));
const which = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(VIDEOS);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

for (const name of which) {
  const video = VIDEOS[name];
  const frames = join(out, `frames-${name}`);
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  let n = 0;
  const framePath = (i) => join(frames, `${String(i).padStart(5, '0')}.jpg`);
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'light', locale: 'en-GB' });

  for (const [si, scene] of video.scenes.entries()) {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log(`  [${scene.place}] page error: ${e.message}`));
    await page.goto(base);
    await page.waitForFunction(() => !!window.__walkVideo);
    await page.evaluate(({ lat, lon, ex }) => window.__walkVideo.load(lat, lon, ex), { ...scene, ex: EXAGGERATION });
    await page.waitForFunction(() => ['ready', 'error'].includes(window.__walkVideo.stage()), null, { timeout: 240000 });
    const stage = await page.evaluate(() => window.__walkVideo.stage());
    const streets = await page.evaluate(() => window.__walkVideo.streets());
    const path = walkRoute(streets, scene.before + scene.during + 20, scene.seed);
    console.log(`${name} ${scene.place}: ${stage}, ${streets.length} street lines, route ${Math.round(routeLength(path))} m`);
    await page.addStyleTag({ url: 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;1,9..144,400;1,9..144,500&family=Inter:wght@400;500;600;650&display=block' }).catch(() => console.log('  fonts unavailable, using fallbacks'));
    await page.addStyleTag({ content: CSS });
    await page.evaluate(({ html, scene }) => {
      document.body.insertAdjacentHTML('beforeend', html);
      const p = document.getElementById('promo');
      p.querySelector('.l1').textContent = scene.lines[0];
      p.querySelector('.l2').textContent = scene.lines[1];
      p.querySelector('.m1').textContent = scene.late?.[0] ?? '';
      p.querySelector('.m2').textContent = scene.late?.[1] ?? '';
      p.querySelector('.place').textContent = scene.place;
    }, { html: HTML(video.end), scene });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1500);

    const total = Math.round(scene.seconds * FPS);
    const last = si === video.scenes.length - 1;
    let target = null;
    for (let i = 0; i < total; i++) {
      if (i % STEP) continue;
      const s = i / FPS;
      const u = i / (total - 1);
      // walk at an even pace, easing in at the very start
      const walked = scene.before + scene.during * Math.min(u, ease(u * 4) * 0.25 + Math.max(0, u - 0.25));
      const r = upTo(path, walked);
      // the camera trails the walker a little
      target = target ? [target[0] + (r.at[0] - target[0]) * 0.3, target[1] + (r.at[1] - target[1]) * 0.3] : r.at;
      const az = -25 + 50 * ease(u);
      // the promo looks more from above, so tall towers don't stand out of the frame
      const tilt = scene.seconds > 10 ? 46 + 8 * ease(u) : 26 + 8 * ease(u);
      // close at the start, pulling back as the map grows
      const distance = scene.seconds > 10 ? 380 + 420 * ease(u) : 560 + 260 * ease(u);
      const dip = Math.max(clamp(1 - s / FADE_S), last ? 0 : clamp((s - (scene.seconds - FADE_S)) / FADE_S));
      const lateOn = scene.late ? clamp((u - 0.62) / 0.06) : 0;
      const cap = clamp(Math.min((s - 0.3) / 0.45, (scene.seconds - 0.25 - s) / 0.4)) * (1 - lateOn);
      await page.evaluate(({ pts, at, heading, radius, cam, dip, cap, late }) => {
        const v = window.__walkVideo;
        v.reveal(pts, radius);
        v.marker(at[0], at[1], heading);
        v.camera(cam);
        const p = document.getElementById('promo');
        p.style.setProperty('--dip', dip);
        p.style.setProperty('--cap', cap);
        p.style.setProperty('--late', late);
        return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      }, { pts: r.pts, at: r.at, heading: r.heading, radius: scene.radius, cam: { azimuth: az, tilt, distance, targetE: target[0], targetN: target[1] }, dip, cap, late: lateOn });
      await page.screenshot({ path: framePath(n++), type: 'jpeg', quality: 92 });
      if (i % 60 === 0) console.log(`  frame ${n}`);
    }
    if (last) {
      const fade = Math.round(0.45 * FPS);
      for (let i = 1; i <= fade; i++) {
        await page.evaluate((v) => document.getElementById('promo').style.setProperty('--end', v), i / fade);
        await page.screenshot({ path: framePath(n++), type: 'jpeg', quality: 92 });
      }
      const hold = framePath(n - 1);
      for (let i = 0; i < Math.round(video.end.seconds * FPS) - fade; i++) copyFileSync(hold, framePath(n++));
    }
    await page.close();
  }
  await ctx.close();

  if (STEP > 1) {
    console.log(`preview frames in ${frames}`);
    continue;
  }
  const file = join(out, video.file);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(frames, '%05d.jpg'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-vf', 'fps=1,scale=270:-1,tile=8x3', '-frames:v', '1', '-q:v', '3', file.replace('.mp4', '-sheet.jpg')]);
  console.log(`${video.file}: ${n} frames, ${(n / FPS).toFixed(1)} s, ${(statSync(file).size / 1048576).toFixed(1)} MB`);
  rmSync(frames, { recursive: true, force: true });
}

await browser.close();
server.close();
