// simplified refresh flow with stubbed transport
// node tests/radar_refresh_flow.test.js
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

var currentMeta = null;
function frames(prefix, times) {
  return times.map(function (t) { return { time: t, path: '/' + prefix + '/' + t }; });
}
function makeMeta(past, nowcast) {
  var live = past[past.length - 1];
  return {
    host: 'http://radar', past: past, nowcast: nowcast,
    time: live.time, path: live.path
  };
}

map.buildMapImage = function (fetcher, viewport, screen, cb) {
  cb(null, { packed: new Uint8Array(100), width: 144, height: 168, tiles: 2 });
};
radar.fetchMeta = function (hostOverride, cb) { cb(null, currentMeta); };
radar.buildRadarImage = function (fetcher, viewport, screen, frame, cb) {
  cb(null, { packed: new Uint8Array(64), width: 144, height: 168, tiles: 1 });
};

var index = require('../src/pkjs/index.js');

function pump() {
  var guard = 0;
  while (pending.length) {
    if (++guard > 1000) throw new Error('pump runaway');
    pending.shift().ok();
  }
}

function findIdx(pred, from) {
  for (var i = from || 0; i < sent.length; i++) {
    if (pred(sent[i])) return i;
  }
  return -1;
}

// one full radar session: ack layout, then frame headers
function settleSession(expectDone) {
  var ackedLayout = false;
  var acked = {};
  for (var round = 0; round < 30; round++) {
    pump();
    if (findIdx(function (m) { return m.RadarDone === expectDone; }) >= 0) return;
    if (!ackedLayout) {
      assert.ok(findIdx(function (m) { return m.RadarLayout !== undefined; }) >= 0,
        'layout sent');
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
      assert.ok(slot !== null && !acked[slot], 'stream progresses');
      acked[slot] = true;
      listeners.appmessage({ payload: { RadarAck: slot } });
    }
  }
  throw new Error('session did not settle');
}

// initial load: 3 past + 1 nowcast = 4 frames
currentMeta = makeMeta(frames('p', [100, 200, 300]), frames('n', [400]));
listeners.ready();
settleSession(4);
pump();
assert.ok(index.__testonly_getState().lastMeta, 'baseline meta retained');

var mark = sent.length;

// unchanged metadata: poll sends nothing
index.__testonly_pollForUpdate();
pump();
assert.strictEqual(sent.length, mark, 'no traffic without change');

// new nowcast frame: full radar reload, map untouched
currentMeta = makeMeta(frames('p', [100, 200, 300]), frames('n', [400, 500]));
index.__testonly_pollForUpdate();
settleSession(5);
pump();

var layoutIdx = findIdx(function (m) { return m.RadarLayout !== undefined; }, mark);
assert.ok(layoutIdx >= 0, 'refresh re-sends full layout');
var layout = radar.decodeLayout(sent[layoutIdx].RadarLayout);
assert.strictEqual(layout.count, 5, 'layout covers new frame set');
assert.strictEqual(layout.slots[layout.liveSlot].time, 300, 'live stays on latest past');
assert.strictEqual(
  findIdx(function (m) { return m.MapLength !== undefined; }, mark), -1,
  'map is not re-sent on time-only refresh');
assert.strictEqual(
  findIdx(function (m) {
    return m.RadarShift !== undefined || m.RadarUpdate !== undefined;
  }, mark), -1,
  'no incremental watch messages');
assert.ok(findIdx(function (m) { return m.RadarDone === 5; }, mark) >= 0,
  'terminal count matches reloaded layout');

delete global.Pebble;
console.log('radar_refresh_flow tests passed');
