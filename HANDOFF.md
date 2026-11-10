# Handoff: Walk it 3D, iPhone app

For the next session, running locally on the owner's Mac with Xcode. Read this first, then `ios/README.md`.

## The project

- **Walk it 3D:** you walk your city for real with only a label-free 3D map and a compass. The map shows only where you've walked (parchment fog of war).
- **Repo:** `yourplace3d/3d-walking-app`, branch `main`.
  - Every push to `main` runs the tests and redeploys the website to GitHub Pages: https://yourplace3d.github.io/3d-walking-app/
  - Pushing to `main` is approved.
- **Stack:** TypeScript, Vite and three.js. Unit tests use vitest (`npm test`, 104 tests). `npm run e2e` is a Playwright test with a made-up city and emulated GPS.
- **3D engine:** copied (MIT) from `yourplace3d/3d-city`. Never push to that repo: no branches, no commits.
- **Code map:** see `README.md`. The app's own parts are in `src/walk/`, and the screens and walk logic are in `src/main.ts`.

## State right now

**Done and pushed:**

1. **Weak-GPS fix** (commit 4fc8e59). On a test walk in a real city, the map stopped opening after a few minutes; likely cause: rough Wi-Fi or mast positions.
   - GPS accuracy limit per level (`src/walk/levels.ts`): easy 60 m, medium 45 m, hard 35 m.
   - The dot fades when a fix doesn't count.
   - GPS is restarted when the page comes back (browser only).
   - Not yet tried outdoors.
2. **iPhone app** (commit 7f44d07):
   - Capacitor 8, Xcode project in `ios/`, bundle ID `io.github.yourplace3d.walkit3d`.
   - `src/walk/gps.ts`: in the app, positions come from `@capacitor-community/background-geolocation`, so walks keep recording with the screen locked. The website keeps using `navigator.geolocation`.
   - `src/geo/mapCache.ts`: map tiles go to IndexedDB when there is no Cache Storage (WKWebView).
   - Info.plist: location texts, background mode `location`, iPhone only, portrait.
   - Signing: the team ID goes in `ios/signing.xcconfig` (gitignored, included from `ios/debug.xcconfig` and `ios/release.xcconfig`). Don't set the team in Xcode's Signing tab, or it lands in the committed project file.
   - Privacy policy page: `public/privacy.html`, linked from Settings.

**Never built:** the iOS project was generated on Linux and has not been compiled yet. Expect small Xcode fixes.

## Next steps

1. On the Mac: `npm ci`, create `ios/signing.xcconfig` (`DEVELOPMENT_TEAM = …`), then `npm run ios`. Run it on the owner's iPhone. Fix build errors.
2. Check these on a real walk:
   - The location prompt.
   - Recording with the screen locked (blue location sign, no gap in the path).
   - The compass: does the motion/orientation permission prompt work in WKWebView?
   - Safe areas: the notch and the home bar.
   - External links open in Safari.
   - Save offline, then flight mode.
3. Things that may need care:
   - The plugin asks for "Always" location when a background message is set. "While Using" plus the background mode should be enough. If review or the prompts are awkward, consider asking for "While Using" only.
   - `UIRequiredDeviceCapabilities` is set to arm64, location-services and gps.
   - No app-level `PrivacyInfo.xcprivacy` yet. Add one if Xcode or App Store Connect asks: no tracking, no data collected.
4. TestFlight, then the App Store:
   - Archive and upload.
   - In App Store Connect: privacy URL `https://yourplace3d.github.io/3d-walking-app/privacy.html`, App Privacy "Data Not Collected", price 1.99.
   - The website stays free.
   - Screenshots can be made with Playwright at iPhone sizes. A Paris video for the app preview can be rendered with `tools/video/render.mjs` (output goes to `video-out/`, gitignored).

## Owner's rules (keep applying)

- **Writing:** short, plain answers in English.
- **Privacy:**
  - Never write the owner's name, where they live, or any other personal detail into code, commits, docs or anything public.
  - Don't say which country the project is run from.
  - The Apple team ID stays out of git.
- **Commits and GitHub:**
  - Commit as `Claude <noreply@anthropic.com>`, with the trailer `Co-Authored-By: Claude <noreply@anthropic.com>`. No AI model names in commits or files.
  - No pull requests unless asked.
  - No scheduled GitHub Actions (cron) without asking.
- **Asking first:**
  - Never deploy, release or publish without asking. App Store submission and release count.
  - Ask before anything that costs money. The $99 Apple account is approved; nothing else is.
- **How to build:** plan first. Give a short plan and get the owner's OK before building. Build with unit tests and browser tests.
- **App privacy promise:** the walked track and the revealed map stay on the device, never uploaded, no account. Location is used only during a walk the user started.
