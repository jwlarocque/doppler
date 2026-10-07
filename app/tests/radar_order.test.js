// Node test for phone->watch message ordering during data load
// node tests/radar_order.test.js
var assert = require('assert');

var listeners = {};
var pending = [];
var sent = [];
global.Pebble = {
  addEventListener: function (name, fn) { listeners[name] = fn; },
  sendAppMessage: function (msg, ok, fail) {
    pending.push({ ok: ok, fail: fail });
    sent.push(msg);
  }
};

var tiles = require('../src/pkjs/tiles.js');
var map = require('../src/pkjs/map.js');
var radar = require('../src/pkjs/radar.js');

tiles.fetchArrayBuffer = function (url, cb) { cb(new Error('offline')); };
tiles.fetchJson = function (url, cb) { cb(new Error('offline')); };
map.buildMapImage = function (fetcher, viewport, screen, cb) {
  cb(null, { packed: new Uint8Array(100), width: 144, height: 168, tiles: 2 });
};
radar.fetchMeta = function (hostOverride, cb) {
  cb(null, {
    host: 'http://radar',
    past: [
      { time: 100, path: '/a' },
      { time: 200, path: '/b' },
      { time: 300, path: '/c' }
    ],
    nowcast: [],
    time: 300,
    path: '/c'
  });
};
radar.buildRadarImage = function (fetcher, viewport, screen, frame, cb) {
  cb(null, { packed: new Uint8Array(64), width: 144, height: 168, tiles: 1 });
};

require('../src/pkjs/index.js');

function pump() {
  var guard = 0;
  while (pending.length) {
    if (++guard > 500) throw new Error('pump runaway');
    pending.shift().ok();
  }
}

function findIdx(pred) {
  for (var i = 0; i < sent.length; i++) {
    if (pred(sent[i])) return i;
  }
  return -1;
}

listeners.ready();
pump();

// ack layout, then each frame header as it arrives
var ackedLayout = false;
var ackedSlots = {};
for (var round = 0; round < 10; round++) {
  if (findIdx(function (m) { return m.RadarDone === 3; }) >= 0) break;
  if (!ackedLayout) {
    assert.ok(findIdx(function (m) { return m.RadarLayout !== undefined; }) >= 0,
      'layout sent before frame streaming');
    ackedLayout = true;
    listeners.appmessage({ payload: { RadarAck: -1 } });
  } else {
    var slot = null;
    for (var i = sent.length - 1; i >= 0; i--) {
      if (sent[i].RadarFrame !== undefined && sent[i].RadarLength !== undefined) {
        slot = sent[i].RadarFrame;
        break;
      }
    }
    assert.ok(slot !== null && !ackedSlots[slot], 'watch acks each new frame once');
    ackedSlots[slot] = true;
    listeners.appmessage({ payload: { RadarAck: slot } });
  }
  pump();
}

var mapDone = findIdx(function (m) { return m.MapDone !== undefined; });
var liveLen = findIdx(function (m) {
  return m.RadarLength !== undefined && m.RadarFrame === undefined;
});
var liveDone = findIdx(function (m) { return m.RadarDone === 64; });
var layout = findIdx(function (m) { return m.RadarLayout !== undefined; });
var firstFrame = findIdx(function (m) { return m.RadarFrame !== undefined; });
var terminal = findIdx(function (m) { return m.RadarDone === 3; });

assert.ok(mapDone >= 0, 'map stream completes');
assert.ok(liveLen > mapDone, 'radar live starts after map send');
assert.ok(liveDone > liveLen, 'live stream done before layout');
assert.ok(layout > liveDone, 'layout queued after live stream');
assert.ok(firstFrame > layout, 'frames stream after layout');
assert.ok(terminal > firstFrame, 'session terminates after frame acks');
assert.deepStrictEqual(Object.keys(ackedSlots).sort(), ['0', '1']);

delete global.Pebble;
console.log('radar_order tests passed');
