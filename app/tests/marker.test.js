// user-location marker: position math + send flow
// node tests/marker.test.js
var assert = require('assert');

var listeners = {};
global.Pebble = {
  addEventListener: function (name, fn) { listeners[name] = fn; },
  sendAppMessage: function (msg, ok, fail) {
    if (ok) ok();
  },
  getActiveWatchInfo: function () { return { platform: 'aplite' }; }
};

// getCurrentPosition stub
var nextFix = { lat: 0, lon: 0 };
var realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  writable: true,
  value: {
    geolocation: {
      getCurrentPosition: function (ok, fail, opts) {
        ok({ coords: { latitude: nextFix.lat, longitude: nextFix.lon } });
      }
    }
  }
});

var tiles = require('../src/pkjs/tiles.js');
var config = require('../src/pkjs/config.js');
config.useTestFix = false;
var send = require('../src/pkjs/send.js');
var map = require('../src/pkjs/map.js');
var radar = require('../src/pkjs/radar.js');

(function position() {
  var screen = tiles.screenFor('aplite'); // 144x168
  var home = { lat: 10, lon: 20 };
  // same fix renders at screen center
  assert.deepStrictEqual(
    tiles.markerForViewport(10, 20, home, 6, screen), { x: 72, y: 84 });
  // 1 degree east at zoom 6 is 16384/360 ~= 45.5px
  assert.deepStrictEqual(
    tiles.markerForViewport(10, 21, home, 6, screen), { x: 118, y: 84 });
  // north decreases y
  var north = tiles.markerForViewport(11, 20, home, 6, screen);
  assert.strictEqual(north.x, 72);
  assert.ok(north.y < 84, 'north moves marker up, got ' + north.y);
  // far fixes clamp to the screen edge
  assert.deepStrictEqual(
    tiles.markerForViewport(10, 120, home, 6, screen), { x: 143, y: 84 });
  assert.deepStrictEqual(
    tiles.markerForViewport(-60, 20, home, 6, screen).y, 167);
})();

(function keys() {
  assert.strictEqual(send.MARKER_KEYS.x, 'MarkerX');
  assert.strictEqual(send.MARKER_KEYS.y, 'MarkerY');
  var dicts = [];
  global.Pebble.sendAppMessage = function (msg, ok) {
    dicts.push(msg);
    if (ok) ok();
  };
  var done = 0;
  send.sendMarker(72, 84, function () { done++; }, function () {});
  assert.deepStrictEqual(dicts, [{ MarkerX: 72, MarkerY: 84 }]);
  assert.strictEqual(done, 1);
})();

(function flow() {
  global.Pebble.sendAppMessage = function (msg, ok) { if (ok) ok(); };
  function frames(prefix, times) {
    return times.map(function (t) { return { time: t, path: '/' + prefix + '/' + t }; });
  }
  radar.fetchMeta = function (hostOverride, cb) {
    cb(null, {
      host: 'http://radar',
      past: frames('p', [100, 200, 300]),
      nowcast: frames('n', [400]),
      time: 300, path: '/p/300'
    });
  };
  map.buildMapImage = function (fetcher, viewport, screen, cb) {
    cb(null, { packed: new Uint8Array(100), width: 144, height: 168, tiles: 2 });
  };
  radar.buildRadarImage = function (fetcher, viewport, screen, frame, cb) {
    cb(null, { packed: new Uint8Array(64), width: 144, height: 168, tiles: 1 });
  };
  var markers = [];
  send.sendMarker = function (x, y, onDone) {
    markers.push({ x: x, y: y });
    if (onDone) onDone();
  };
  var index = require('../src/pkjs/index.js');

  nextFix = { lat: 0, lon: 0 };
  listeners.ready();
  assert.deepStrictEqual(markers, [{ x: 72, y: 84 }],
    'initial load centers marker, got ' + JSON.stringify(markers));
  assert.deepStrictEqual(
    [index.__testonly_getState().lastViewportFix.lat,
      index.__testonly_getState().lastViewportFix.lon], [0, 0]);

  // sub-pixel drift at the current zoom: no resend
  nextFix = { lat: 0, lon: 0.01 };
  index.__testonly_pollForLocationOrUpdate();
  assert.strictEqual(markers.length, 1, 'same-pixel drift sends nothing');

  // visible drift below the re-center threshold: marker-only update
  nextFix = { lat: 0, lon: 0.05 };
  index.__testonly_pollForLocationOrUpdate();
  assert.strictEqual(markers.length, 2, 'drift updates marker');
  assert.ok(markers[1].x > 72, 'drift moves marker east, got ' + JSON.stringify(markers[1]));
  assert.strictEqual(markers[1].y, 84);
  assert.deepStrictEqual(
    [index.__testonly_getState().lastFix.lat,
      index.__testonly_getState().lastFix.lon], [0, 0.05]);

  // large move: full reload re-centers the marker
  nextFix = { lat: 0, lon: 1.0 };
  index.__testonly_pollForLocationOrUpdate();
  assert.deepStrictEqual(markers[markers.length - 1], { x: 72, y: 84 },
    'relocate re-centers marker, got ' + JSON.stringify(markers));
})();

delete global.Pebble;
if (realNavigator) {
  Object.defineProperty(globalThis, 'navigator', realNavigator);
} else {
  delete globalThis.navigator;
}
console.log('marker tests passed');
