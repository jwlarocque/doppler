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

console.log('config_save tests passed');
