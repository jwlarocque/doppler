// custom location: validation helpers + webviewclosed/poll/ready flow
// node tests/custom_location.test.js
var assert = require('assert');
var Module = require('module');

var listeners = {};
var sent = [];
global.Pebble = {
  addEventListener: function (name, fn) { listeners[name] = fn; },
  sendAppMessage: function (msg, ok, fail) {
    sent.push(msg);
    if (ok) ok();
  },
  openURL: function () {},
  getActiveWatchInfo: function () { return { platform: 'aplite' }; }
};
var store = {};
global.localStorage = {
  getItem: function (k) { return store[k] || null; },
  setItem: function (k, v) { store[k] = String(v); }
};

function FakeClay(config) {
  this.config = config;
}
FakeClay.prototype.generateUrl = function () { return 'http://config.test/'; };
FakeClay.prototype.getSettings = function (response) {
  return JSON.parse(response);
};
var clayPath = require.resolve('@rebble/clay');
require.cache[clayPath] = new Module(clayPath, module);
require.cache[clayPath].exports = FakeClay;
require.cache[clayPath].loaded = true;

var geoCalls = 0;
var nextFix = { lat: 10, lon: 20 };
var realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  writable: true,
  value: {
    geolocation: {
      getCurrentPosition: function (ok, fail) {
        geoCalls++;
        ok({ coords: { latitude: nextFix.lat, longitude: nextFix.lon } });
      }
    }
  }
});

var config = require('../src/pkjs/config.js');
config.settings.useTestFix = false;
var map = require('../src/pkjs/map.js');
var radar = require('../src/pkjs/radar.js');

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
var mapBuilds = 0;
map.buildMapImage = function (fetcher, viewport, screen, cb) {
  mapBuilds++;
  cb(null, { packed: new Uint8Array(100), width: 144, height: 168, tiles: 2 });
};
radar.buildRadarImage = function (fetcher, viewport, screen, frame, cb) {
  cb(null, { packed: new Uint8Array(64), width: 144, height: 168, tiles: 1 });
};

var index = require('../src/pkjs/index.js');

// map/radar payloads also go through Pebble.sendAppMessage, so only
// assert on messages carrying config keys
function configSends(since) {
  return sent.slice(since).filter(function (m) {
    return m.Autoplay !== undefined || m.Palette !== undefined ||
      m.RadarInterval !== undefined || m.Location !== undefined ||
      m.CustomLat !== undefined || m.CustomLon !== undefined;
  });
}

(function helpers() {
  assert.strictEqual(index.parseCoordinate('46.87', -90, 90), 46.87);
  assert.strictEqual(index.parseCoordinate('  -96.79 ', -180, 180), -96.79);
  assert.strictEqual(index.parseCoordinate('', -90, 90), null);
  assert.strictEqual(index.parseCoordinate('abc', -90, 90), null);
  assert.strictEqual(index.parseCoordinate('Infinity', -90, 90), null);
  assert.strictEqual(index.parseCoordinate('91', -90, 90), null);
  assert.strictEqual(index.parseCoordinate('-91', -90, 90), null);
  assert.strictEqual(index.parseCoordinate('181', -180, 180), null);
  assert.strictEqual(index.parseCoordinate('90', -90, 90), 90);
  assert.strictEqual(index.parseCoordinate('-180', -180, 180), -180);
  assert.deepStrictEqual(
    index.customFixFromSettings('custom', '46.87', '-96.79'),
    { lat: 46.87, lon: -96.79, test: false, custom: true });
  assert.strictEqual(index.customFixFromSettings('custom', 'bad', '0'), null);
  assert.strictEqual(index.customFixFromSettings('custom', '0', '200'), null);
  assert.strictEqual(index.customFixFromSettings('current', '46.87', '-96.79'), null);
})();

(function saveCustomTriggersFullRefresh() {
  listeners.ready();
  var base = mapBuilds;
  assert.ok(base > 0, 'initial load ran');
  assert.strictEqual(index.__testonly_getState().lastFix.custom, false);
  var sentBase = sent.length;
  // tiny move that the relocation threshold would ignore
  listeners.webviewclosed({ response: JSON.stringify({
    Location: { value: 'custom' },
    CustomLat: { value: '10.001' },
    CustomLon: { value: '20.001' }
  })});
  assert.deepStrictEqual(configSends(sentBase), [], 'location keys stay phone-side');
  assert.strictEqual(mapBuilds, base + 1, 'custom save forces full refresh');
  var fix = index.__testonly_getState().lastFix;
  assert.deepStrictEqual([fix.lat, fix.lon, fix.custom], [10.001, 20.001, true]);
})();

(function unchangedCustomSaveDoesNothing() {
  var base = mapBuilds;
  var sentBase = sent.length;
  listeners.webviewclosed({ response: JSON.stringify({
    Location: { value: 'custom' },
    CustomLat: { value: '10.001' },
    CustomLon: { value: '20.001' }
  })});
  assert.deepStrictEqual(configSends(sentBase), []);
  assert.strictEqual(mapBuilds, base, 'identical custom save rebuilds nothing');
})();

(function customCoordinateChangeRefreshes() {
  var base = mapBuilds;
  listeners.webviewclosed({ response: JSON.stringify({
    Location: { value: 'custom' },
    CustomLat: { value: '10.002' },
    CustomLon: { value: '20.001' }
  })});
  assert.strictEqual(mapBuilds, base + 1, 'lat change forces full refresh');
})();

(function invalidCustomFallsBackToCurrent() {
  var base = mapBuilds;
  var geoBase = geoCalls;
  listeners.webviewclosed({ response: JSON.stringify({
    Location: { value: 'custom' },
    CustomLat: { value: 'not-a-number' },
    CustomLon: { value: '20' }
  })});
  assert.ok(geoCalls > geoBase, 'invalid custom consults geolocation');
  assert.strictEqual(mapBuilds, base + 1, 'fallback triggers full refresh');
  var fix = index.__testonly_getState().lastFix;
  assert.deepStrictEqual([fix.lat, fix.lon, fix.custom], [10, 20, false]);
})();

(function backToCurrentRefreshes() {
  index.__testonly_setState({
    lastFix: { lat: 10.002, lon: 20.001, test: false, custom: true }
  });
  var base = mapBuilds;
  var geoBase = geoCalls;
  listeners.webviewclosed({ response: JSON.stringify({
    Location: { value: 'current' }
  })});
  assert.ok(geoCalls > geoBase, 'switch to current consults geolocation');
  assert.strictEqual(mapBuilds, base + 1, 'switch to current forces full refresh');
  assert.strictEqual(index.__testonly_getState().lastFix.custom, false);
})();

(function customPollSkipsGeolocation() {
  index.__testonly_setState({
    lastFix: { lat: 1, lon: 2, test: false, custom: true }
  });
  var geoBase = geoCalls;
  var base = mapBuilds;
  index.__testonly_pollForLocationOrUpdate();
  assert.strictEqual(geoCalls, geoBase, 'custom poll never consults geolocation');
  assert.strictEqual(mapBuilds, base, 'custom poll without new meta rebuilds nothing');
})();

(function readyHonorsStoredCustomLocation() {
  store['clay-settings'] = JSON.stringify({
    Location: 'custom', CustomLat: '46.87', CustomLon: '-96.79'
  });
  var geoBase = geoCalls;
  var base = mapBuilds;
  listeners.ready();
  assert.strictEqual(geoCalls, geoBase, 'stored custom skips geolocation');
  assert.ok(mapBuilds > base, 'stored custom loads map at startup');
  var fix = index.__testonly_getState().lastFix;
  assert.deepStrictEqual([fix.lat, fix.lon, fix.custom], [46.87, -96.79, true]);
  delete store['clay-settings'];
})();

delete global.Pebble;
delete global.localStorage;
if (realNavigator) {
  Object.defineProperty(globalThis, 'navigator', realNavigator);
} else {
  delete globalThis.navigator;
}
console.log('custom_location tests passed');
