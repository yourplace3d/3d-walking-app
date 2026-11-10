# Walk it 3D

**A map and a compass is all you get.** Walk your own city for real, with only a 3D map and a compass.
The map has no street names and no labels: just the city in 3D (terrain, buildings, streets, water and green as
shapes), and it only appears where you have walked.

## How it works

- **Start a walk** and pick a level. The level stays the same for the whole walk.

  | Level | The map opens around your path | You on the map |
  | --- | --- | --- |
  | Easy | 100 m | shown |
  | Medium | 50 m | shown |
  | Hard | 25 m | hidden, like real orienteering |

- Where nobody has walked, the map is blank parchment. As you walk, it opens around your path with a ragged,
  inked edge, and it stays open. Buildings appear whole once the middle of their footprint is revealed.
- **The compass** shows north, and the way your phone points where the phone can tell. Tap it to turn the map
  north up.
- **See my map** shows everything you have walked, on your last walk. **Continue your walk** picks it up there,
  with its level, so one walk can grow over many outings. There's no timer: the summary after each outing
  shows how far you went and how much new map you opened.
- **Save an area for offline** keeps the map about 2 km around your location or a place you search on the phone,
  so a walk there works without signal. Map squares you've opened are kept too.
- The map loads one 2 km square at a time, on a fixed grid, and the next square loads as you walk on.
- GPS fixes are filtered: inaccurate fixes, positions from before the walk, standing still and jumps faster
  than a runner don't open the map. If the fixes after a jump agree for a few seconds, the walk goes on from
  there, without joining the two places.
- English, Spanish, Portuguese (Brazil) and German, from the browser's language or the picker in Settings.

## Privacy

Your position is read only while a walk is on and the app is open. Your walks and the map they reveal are kept in
this browser on this device (IndexedDB): never uploaded, no account, no share links. Settings can delete them,
and the saved map data. The app fetches only public map data for the square it shows (OpenFreeMap vector
tiles, AWS terrain tiles) and, when you search a place to save offline, Nominatim.

## Run it yourself

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/ (relative paths, host it anywhere)
npm test           # unit tests (vitest)
npm run e2e        # build + headless-browser test with a made-up city and an emulated GPS walk
```

**Deploys.** `.github/workflows/pages.yml` runs the unit tests, builds, and publishes `dist/` to GitHub Pages on
every push to `main`. One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**. The app
is then at https://yourplace3d.github.io/3d-walking-app/.

The end-to-end test needs Playwright with Chromium; it answers every map request from fixtures
(`e2e/fixtures/`), so it runs without network. Screenshots go to `e2e/out/`.

## Code

- `src/walk/`: the app's own parts. `levels.ts` (the three levels), `track.ts` (GPS fixes into a walk),
  `area.ts` (which 2 km square is loaded), `reveal.ts` (the revealed map as a raster, and the area a walk
  opened), `fog.ts` (the shader: parchment where unwalked), `heading.ts` (compass), `walks.ts` (storage on the
  device), `offline.ts` (saving squares for offline).
- `src/geo/`, `src/scene/`, `src/export/`: the 3D engine, copied from [Your Place](https://github.com/yourplace3d/3d-city)
  (MIT). Changes: tiles go through an on-device cache (`geo/mapCache.ts`); buildings carry their footprint's
  middle (`aFoot`) and a hook for the fog; the viewer's plinth shadow can be turned off.
- `src/main.ts`: the screens and the walk.

## Credits

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL), vector tiles by
[OpenFreeMap](https://openfreemap.org). Terrain: Mapzen Terrain Tiles on AWS Open Data. Built on the Your Place
3D engine (MIT, see LICENSE).
