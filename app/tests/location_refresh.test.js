// location re-center; check threshold math + poll flow
// node tests/location_refresh.test.js
var assert = require('assert');

var listeners = {};
var sent = [];
global.Pebble = {
  addEventListener: function (name, fn) { listeners[name] = fn; },
  sendAppMessage: function (msg, ok, fail) {
    sent.push(msg);
    if (ok) ok();
  },
  getActiveWatchInfo: function () { return { platform: 'aplite' }; }
};

// controllable geolocation fix (Node ships a getter-only navigator global,
// so assignment is ignored and the stub must be defined explicitly)
var nextFix = { lat: 0, lon: 0 };
var geoCalls = 0;
var realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  writable: true,
  value: {
    geolocation: {
      getCurrentPosition: function (ok, fail, opts) {
        geoCalls++;
        ok({ coords: { latitude: nextFix.lat, longitude: nextFix.lon } });
      }
    }
  }
});

var tiles = require('../src/pkjs/tiles.js');
var config = require('../src/pkjs/config.js');
config.useTestFix = false;
var map = require('../src/pkjs/map.js');
var radar = require('../src/pkjs/radar.js');

function frames(prefix, times) {
  return times.map(function (t) { return { time: t, path: '/' + prefix + '/' + t }; });
}
var steadyMeta = {
  host: 'http://radar',
  past: frames('p', [100, 200, 300]),
  nowcast: frames('n', [400]),
  time: 300,
  path: '/p/300'
};
radar.fetchMeta = function (hostOverride, cb) { cb(null, steadyMeta); };

var mapBuilds = 0;
map.buildMapImage = function (fetcher, viewport, screen, cb) {
  mapBuilds++;
  cb(null, { packed: new Uint8Array(100), width: 144, height: 168, tiles: 2 });
};
radar.buildRadarImage = function (fetcher, viewport, screen, frame, cb) {
  cb(null, { packed: new Uint8Array(64), width: 144, height: 168, tiles: 1 });
};

var index = require('../src/pkjs/index.js');

// at zoom 7, 360 deg lon = 32768 px (~91 px/deg at equator)
(function threshold() {
  assert.strictEqual(index.LOCATION_CHECK_ZOOM, 7);
  assert.strictEqual(index.LOCATION_FRACTION, 0.2);
  var screen = tiles.screenFor('aplite'); // w=144 -> 28.8px
  var oldFix = { lat: 0, lon: 0 };
  // 0.2 deg lon ~ 18.2px: no move
  assert.strictEqual(
    index.needsRelocation(oldFix, { lat: 0, lon: 0.2 }, screen), false);
  // 0.5 deg lon ~ 45.5px: move
  assert.strictEqual(
    index.needsRelocation(oldFix, { lat: 0, lon: 0.5 }, screen), true);
  // diagonal: 0.15 deg each ~ 19.3px total
  assert.strictEqual(
    index.needsRelocation(oldFix, { lat: 0.15, lon: 0.15 }, screen), false);
  assert.strictEqual(
    index.needsRelocation(oldFix, { lat: 0.3, lon: 0.3 }, screen), true);
  // wider screen has a wider threshold
  var gabbro = tiles.screenFor('gabbro'); // w=260 -> 52px
  assert.strictEqual(
    index.needsRelocation(oldFix, { lat: 0, lon: 0.5 }, gabbro), false);
  assert.strictEqual(
    index.needsRelocation(oldFix, { lat: 0, lon: 0.7 }, gabbro), true);
  // missing inputs never trigger
  assert.strictEqual(index.needsRelocation(null, oldFix, screen), false);
})();

// poll flow
(function flow() {
  nextFix = { lat: 0, lon: 0 };
  listeners.ready();
  assert.strictEqual(mapBuilds, 1, 'initial load builds map');
  var base = mapBuilds;

  // small move: no rebuild, falls through to metadata check
  nextFix = { lat: 0, lon: 0.1 };
  index.__testonly_pollForLocationOrUpdate();
  assert.strictEqual(mapBuilds, base, 'small move does not rebuild');
  assert.deepStrictEqual(
    [index.__testonly_getState().lastFix.lat, index.__testonly_getState().lastFix.lon],
    [0, 0], 'small move keeps old fix');

  // big move: aborts and rebuilds map + radar
  nextFix = { lat: 0, lon: 1.0 };
  index.__testonly_pollForLocationOrUpdate();
  assert.strictEqual(mapBuilds, base + 1, 'big move rebuilds map');
  assert.deepStrictEqual(
    [index.__testonly_getState().lastFix.lat, index.__testonly_getState().lastFix.lon],
    [0, 1.0], 'big move updates fix');

  // geolocation failure: keeps old fix, still runs
  navigator.geolocation.getCurrentPosition = function (ok, fail) {
    geoCalls++;
    fail(new Error('denied'));
  };
  var before = mapBuilds;
  index.__testonly_pollForLocationOrUpdate();
  assert.strictEqual(mapBuilds, before, 'geo failure does not rebuild');
  assert.deepStrictEqual(
    [index.__testonly_getState().lastFix.lat, index.__testonly_getState().lastFix.lon],
    [0, 1.0], 'geo failure keeps fix');
})();

delete global.Pebble;
if (realNavigator) {
  Object.defineProperty(globalThis, 'navigator', realNavigator);
} else {
  delete globalThis.navigator;
}
console.log('location_refresh tests passed');
