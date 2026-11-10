# Walk it 3D for iPhone

The iPhone app is the same web app inside a small native shell ([Capacitor](https://capacitorjs.com)). What the app adds over the website:

- **GPS with the screen locked:** a walk keeps recording until you end it; iOS shows its blue location sign meanwhile.
- **The app files on the phone:** it opens without a connection.

The website at github.io stays as it is.

## What you need

- A Mac with Xcode (the current version from the App Store) and Node.js 22 or newer.
- An Apple Developer account ($99 a year) for TestFlight and the App Store. A free Apple ID is enough to run it on your own iPhone for 7 days at a time.
- Your iPhone, with Developer Mode on: Settings › Privacy & Security › Developer Mode (it shows up after the first run from Xcode).

## First run on your iPhone

```sh
git clone https://github.com/yourplace3d/3d-walking-app.git
cd 3d-walking-app
npm ci
```

Tell Xcode which Apple team signs the app, in a file that stays on your Mac (it is in `.gitignore`):

```sh
echo 'DEVELOPMENT_TEAM = ABCDE12345' > ios/signing.xcconfig
```

Put your own Team ID in place of `ABCDE12345`. You find it at developer.apple.com › Account › Membership details. Please don't choose the team in Xcode's Signing tab instead: Xcode would then write it into the project file, which is in git.

Then:

```sh
npm run ios
```

This builds the web app, copies it into the Xcode project and opens Xcode. In Xcode:

1. Wait until "Resolving packages" is done (the first time only).
2. Plug in your iPhone and pick it at the top, next to "App".
3. Press ▶ (Run).

After every code change, run `npm run ios` again (or `npm run build && npx cap sync ios` with Xcode left open), then ▶.

## What to try on a walk

1. Start a walk and allow location ("While Using the App" is enough).
2. Walk a few minutes with the screen on. The map opens along your path.
3. Lock the screen and keep walking for a few minutes. The blue location sign shows at the top.
4. Unlock. The map has opened along the stretch you walked with the screen locked, without a gap.
5. The compass turns with the phone.
6. Save an area for offline use, switch on flight mode, and start a walk there.

If something's off, note what the status line at the top says.

## TestFlight and the App Store

1. In Xcode: Product › Archive, then Distribute App › App Store Connect › Upload.
2. In [App Store Connect](https://appstoreconnect.apple.com), create the app with the bundle ID `io.github.yourplace3d.walkit3d`. The upload shows up under TestFlight after a few minutes. Add yourself as a tester.
3. For the store page:
   - Privacy policy URL: https://yourplace3d.github.io/3d-walking-app/privacy.html
   - App Privacy: "Data Not Collected".
   - Price, screenshots and the listing text.
