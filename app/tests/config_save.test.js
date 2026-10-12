// regression test for webviewclosed handler
// node tests/config_save.test.js
var assert = require('assert');
var Module = require('module');

var listeners = {};
var sent = [];
var opened = [];
global.Pebble = {
  addEventListener: function (name, fn) { listeners[name] = fn; },
  sendAppMessage: function (msg, ok, fail) {
    sent.push(msg);
    if (ok) ok();
  },
  openURL: function (url) { opened.push(url); },
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

var radar = require('../src/pkjs/radar.js');
var config = require('../src/pkjs/config.js');
var map = require('../src/pkjs/map.js');
require('../src/pkjs/index.js');

assert.ok(listeners.showConfiguration);
assert.ok(listeners.webviewclosed);

(function frameLimitsOnly() {
  // no forwarded keys, only phone-side settings
  sent = [];
  listeners.webviewclosed({ response: JSON.stringify({
    PastFrames: { value: 3 },
    NowcastFrames: { value: 1 }
  })});
  assert.deepStrictEqual(sent, []);
  var order = radar.priorityOrder(
    [{ time: 100 }, { time: 200 }, { time: 300 }, { time: 400 }],
    [{ time: 500 }, { time: 600 }]);
  assert.deepStrictEqual(order.map(function (e) { return e.time; }), [400, 300, 500, 200]);
  radar.setFrameLimits(12, 6);
})();

(function fullSave() {
  sent = [];
  listeners.webviewclosed({ response: JSON.stringify({
    Autoplay: { value: true },
    Palette: { value: 'nexrad' },
    Dither: { value: '4x4' },
    PastFrames: { value: 12 },
    NowcastFrames: { value: 6 }
  })});
  assert.deepStrictEqual(sent, [{ Autoplay: 1, Palette: 'nexrad' }]);
  radar.setPalette('darksky');
  radar.setDither('2x2');
})();

(function showConfiguration() {
  listeners.showConfiguration();
  assert.deepStrictEqual(opened, ['http://config.test/']);
})();

(function mapStyleOnly() {
  // phone-side only - tile URL styles change
  config.setMapStyle('simple');
  assert.strictEqual(
    map.tileUrl(7, 32, 47),
    config.settings.mapTileHost + '/tiles_simple/7/32/47.png');
  sent = [];
  listeners.webviewclosed({ response: JSON.stringify({
    MapStyle: { value: 'dither' }
  })});
  assert.deepStrictEqual(sent, []);
  assert.strictEqual(config.settings.mapStyle, 'dither');
  assert.strictEqual(
    map.tileUrl(7, 32, 47),
    config.settings.mapTileHost + '/tiles_dither/7/32/47.png');
  config.setMapStyle('simple');
})();

(function saveReloads() {
  var mapBuilds = 0;
  var radarBuilds = 0;
  var metaCalls = 0;
  function frames(prefix, times) {
    return times.map(function (t) { return { time: t, path: '/' + prefix + '/' + t }; });
  }
  map.buildMapImage = function (fetcher, viewport, screen, cb) {
    mapBuilds++;
    cb(null, { packed: new Uint8Array(100), width: 144, height: 168, tiles: 2 });
  };
  radar.buildRadarImage = function (fetcher, viewport, screen, frame, cb) {
    radarBuilds++;
    cb(null, { packed: new Uint8Array(64), width: 144, height: 168, tiles: 1 });
  };
  radar.fetchMeta = function (hostOverride, cb) {
    metaCalls++;
    cb(null, {
      host: 'http://radar',
      past: frames('p', [100, 200, 300]),
      nowcast: frames('n', [400]),
      time: 300, path: '/p/300'
    });
  };
  // baseline matching the Clay defaults
  radar.setPalette('darksky');
  radar.setDither('2x2');
  radar.setFrameLimits(12, 6);
  config.setMapStyle('simple');
  listeners.ready();
  var baseMap = mapBuilds;
  var baseRadar = radarBuilds;
  var baseMeta = metaCalls;
  assert.ok(baseMap > 0 && baseMeta > 0, 'initial load ran');
  function fullSettings(overrides) {
    var s = {
      Autoplay: { value: true },
      Palette: { value: 'darksky' },
      Dither: { value: '2x2' },
      PastFrames: { value: 12 },
      NowcastFrames: { value: 6 },
      MapStyle: { value: 'simple' }
    };
    for (var k in overrides) s[k] = overrides[k];
    return s;
  }
  // unchanged save rebuilds nothing
  sent = [];
  listeners.webviewclosed({ response: JSON.stringify(fullSettings({})) });
  assert.deepStrictEqual(sent, [{ Autoplay: 1, Palette: 'darksky' }]);
  assert.strictEqual(mapBuilds, baseMap, 'unchanged save does not rebuild map');
  assert.strictEqual(radarBuilds, baseRadar, 'unchanged save does not rebuild radar');
  assert.strictEqual(metaCalls, baseMeta, 'unchanged save does not refetch meta');
  // map-only change rebuilds the map and leaves radar alone
  listeners.webviewclosed({ response: JSON.stringify(
    fullSettings({ MapStyle: { value: 'dither' } })) });
  assert.strictEqual(mapBuilds, baseMap + 1, 'map style change rebuilds map');
  assert.strictEqual(radarBuilds, baseRadar, 'map style change leaves radar alone');
  assert.strictEqual(metaCalls, baseMeta, 'map style change does not refetch meta');
  // combined change reloads everything
  listeners.webviewclosed({ response: JSON.stringify(
    fullSettings({ Palette: { value: 'nexrad' }, MapStyle: { value: 'simple' } })) });
  assert.strictEqual(mapBuilds, baseMap + 2, 'combined change rebuilds map');
  assert.ok(metaCalls > baseMeta, 'combined change refetches meta');
  assert.ok(radarBuilds > baseRadar, 'combined change rebuilds radar');
  radar.setPalette('darksky');
  config.setMapStyle('simple');
})();

console.log('config_save tests passed');
