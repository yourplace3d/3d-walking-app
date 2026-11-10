/**
 * Every text the app shows, in English. The other languages have the same keys and the same
 * function signatures (TypeScript checks it), so nothing can be left out.
 */

export const en = {
  docTitle: 'Walk it 3D: a map and a compass is all you get',
  language: 'Language',
  canvasLabel: 'Your 3D map. It shows only where you have walked.',
  unsupportedText: 'This browser can’t show the 3D map. Try a current version of Safari, Chrome, Firefox or Edge.',
  postcodeOf: (code: string) => `Postcode ${code}`,
  fromMapLink: 'From a map link',
  unnamedPlace: 'Unnamed place',

  // home
  tagline: 'A map and a compass is all you get.',
  intro: 'Walk your own city for real. The 3D map has no names and no labels, and it only appears where you have walked.',
  startWalk: 'Start a walk',
  continueWalk: 'Continue your walk',
  seeMap: 'See my map',
  saveOffline: 'Save an area for offline',
  settings: 'Settings',
  privacyShort: 'Your walks and your map stay on this phone. Nothing is uploaded, and there is no account.',

  // levels
  pickLevel: 'Pick a level',
  levelFixed: 'The level stays the same for the whole walk.',
  level_easy: 'Easy',
  level_medium: 'Medium',
  level_hard: 'Hard',
  levelText_easy: 'The map opens 100 m around your path. You see yourself on the map.',
  levelText_medium: 'The map opens 50 m around your path. You see yourself on the map.',
  levelText_hard: 'The map opens 25 m around your path. You don’t see yourself: like real orienteering.',
  go: 'Go',
  back: 'Back',

  // walking
  waitingGps: 'Waiting for your position…',
  gpsAccuracy: (m: string) => `Position ±${m} m`,
  gpsWeak: (m: string) => `Weak GPS (±${m} m): the map opens again when the signal is better. Open sky helps.`,
  gpsDenied: 'Location is off for this site. Allow it in your browser settings to walk.',
  gpsUnavailable: 'This device can’t give a position.',
  loadingMap: 'Loading the map…',
  mapFailed: 'The map couldn’t load. Check your connection.',
  retry: 'Try again',
  offlineMissing: 'You are offline and this part of the map isn’t saved.',
  centreOnMe: 'Centre on me',
  followOn: 'Following you',
  endWalk: 'End walk',
  endWalkConfirm: 'End this walk?',
  keepScreenOn: 'Keep the screen on',
  screenOnNote: 'The map only opens while this app is open on screen.',
  compassLabel: 'Compass. Tap to turn the map north up.',
  compassNoHeading: 'Your phone gives no heading here: the compass shows north only.',
  distance: 'Distance',

  // summary
  walkDone: 'Walk done',
  newMap: 'New map',
  done: 'Done',

  // map viewer
  yourMap: 'Your map',
  noWalksYet: 'No walks yet. Start one and the map appears where you go.',
  home: 'Home',

  // offline
  offlineTitle: 'Save an area for offline',
  offlineText: 'Keeps the map about 2 km around a place on this phone, so a walk there works without signal.',
  aroundMe: 'Around my location',
  orPlace: 'Or search a place',
  searchPlaceholder: 'A place or address',
  search: 'Search',
  nothingFound: (q: string) => `Nothing found for “${q}”`,
  searchFailed: 'Search is unavailable right now.',
  saving: (done: number, total: number) => `Saving… ${done} of ${total}`,
  saved: (place: string) => `Saved: the map around ${place}.`,
  saveFailed: 'Some of the map couldn’t be saved. Check your connection and try again.',
  thisPlace: 'this place',
  yourLocation: 'your location',
  storageUsed: (size: string) => `Map data on this phone: ${size}`,

  // settings
  deleteWalks: 'Delete my walks and map',
  deleteWalksConfirm: 'Delete all your walks? The map fogs over again. This can’t be undone.',
  deletedWalks: 'Your walks are deleted.',
  deleteMapData: 'Delete saved map data',
  deletedMapData: 'Saved map data deleted.',
  privacyTitle: 'Privacy',
  privacyLong:
    'Your position is only used while a walk is on and the app is open. Your walks and the map they reveal are kept in this browser on this device. They are never uploaded, and there is no account. The app fetches the public map for the area you are in from OpenFreeMap (map data) and AWS Open Data (terrain), like any map app.',
  credits: 'Map data © OpenStreetMap contributors (ODbL), tiles by OpenFreeMap. Terrain: Mapzen Terrain Tiles on AWS Open Data. Built on the Your Place 3D engine (MIT).',
  close: 'Close',
};

export type Messages = typeof en;
