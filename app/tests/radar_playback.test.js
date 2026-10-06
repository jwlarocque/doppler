// Node unit tests for radar multi-frame planning.
// Run: node tests/radar_playback.test.js
var assert = require('assert');
var radar = require('../src/pkjs/radar.js');
var tiles = require('../src/pkjs/tiles.js');
var queue = require('../src/pkjs/queue.js');

function frames(prefix, times) {
  return times.map(function (t) { return { time: t, path: '/' + prefix + '/' + t }; });
}

(function priorityOrderBasic() {
  var past = frames('p', [100, 200, 300]);
  var now = frames('n', [400, 500]);
  var order = radar.priorityOrder(past, now);
  assert.deepStrictEqual(order.map(function (e) { return e.time; }), [300, 200, 400, 100, 500]);
  assert.deepStrictEqual(order.map(function (e) { return e.kind; }),
    ['live', 'past', 'nowcast', 'past', 'nowcast']);
})();

(function caps() {
  var past = [];
  for (var i = 0; i < 13; i++) past.push({ time: 1000 + i, path: '/p' + i });
  var now = [];
  for (var j = 0; j < 8; j++) now.push({ time: 2000 + j, path: '/n' + j });
  var order = radar.priorityOrder(past, now);
  assert.strictEqual(order.length, 18);
  var pastKept = order.filter(function (e) { return e.kind !== 'nowcast'; }).length;
  var nowKept = order.filter(function (e) { return e.kind === 'nowcast'; }).length;
  assert.strictEqual(pastKept, 12);
  assert.strictEqual(nowKept, 6);
  // oldest past (1000) dropped, newest nowcast kept are the first 6
  assert.ok(order.every(function (e) { return e.time !== 1000; }));
  assert.ok(order.every(function (e) { return e.time < 2006 || e.kind !== 'nowcast'; }));
})();

(function emptyAndShortNowcast() {
  var past = frames('p', [100, 200, 300]);
  var empty = radar.priorityOrder(past, []);
  assert.deepStrictEqual(empty.map(function (e) { return e.time; }), [300, 200, 100]);
  var short = radar.priorityOrder(past, frames('n', [400]));
  assert.deepStrictEqual(short.map(function (e) { return e.time; }), [300, 200, 400, 100]);
})();

(function greedyStop() {
  var past = frames('p', [100, 200, 300, 400]);
  var now = frames('n', [500, 600]);
  // priority: 400,300,500,200,600,100
  var sizes = { 400: 1000, 300: 1000, 500: 1000, 200: 5000, 600: 100, 100: 100 };
  var kept = radar.orderFrames(past, now, sizes, 3000);
  assert.deepStrictEqual(kept.frames.map(function (e) { return e.time; }), [400, 300, 500]);
  assert.strictEqual(kept.totalBytes, 3000);
  assert.strictEqual(kept.stop, 'greedy');
  // farther small frame (600) must not displace nearer overflow (200)
  assert.ok(kept.frames.every(function (e) { return e.time !== 600; }));
})();

(function layoutSlotsChronological() {
  var past = frames('p', [100, 200, 300]);
  var now = frames('n', [400]);
  var order = radar.priorityOrder(past, now); // 300,200,400,100
  var sizes = { 100: 10, 200: 20, 300: 30, 400: 40 };
  var layout = radar.layoutSlots(order, sizes);
  assert.deepStrictEqual(layout.slots.map(function (s) { return s.time; }), [100, 200, 300, 400]);
  assert.deepStrictEqual(layout.slots.map(function (s) { return s.slot; }), [0, 1, 2, 3]);
  assert.deepStrictEqual(layout.slots.map(function (s) { return s.offset; }), [0, 10, 30, 60]);
  assert.strictEqual(layout.liveSlot, 2);
  assert.strictEqual(layout.totalBytes, 100);
  var one = radar.slotFor(layout.slots.slice().sort(function (a, b) { return a.time - b.time; }),
    function (e) { return sizes[e.time]; }, 2);
  assert.strictEqual(one.slot, 2);
  assert.strictEqual(one.offset, 30);
  assert.strictEqual(one.len, 30);
})();

(function layoutEncodeRoundTrip() {
  var past = frames('p', [100, 200, 300]);
  var order = radar.priorityOrder(past, []);
  var sizes = { 100: 10, 200: 20, 300: 30 };
  var layout = radar.layoutSlots(order, sizes);
  var bytes = radar.encodeLayout(layout);
  assert.strictEqual(bytes.length, 4 + 3 * 12);
  var back = radar.decodeLayout(bytes);
  assert.strictEqual(back.version, 1);
  assert.strictEqual(back.count, 3);
  assert.strictEqual(back.liveSlot, 2);
  assert.deepStrictEqual(back.slots.map(function (s) { return s.offset; }), [0, 10, 30]);
  var arena = 60;
  back.slots.forEach(function (s) { assert.ok(s.offset + s.len <= arena); });
})();

(function arenaMirror() {
  // tiles.js must mirror c/radar.h; spot-check keys and 2-frame minimum.
  var expect = { aplite: 10219, basalt: 43851, chalk: 42551, diorite: 49131, flint: 49131, emery: 102400, gabbro: 98549 };
  assert.deepStrictEqual(tiles.RADAR_ARENA_BYTES, expect);
  assert.strictEqual(tiles.radarArenaFor('flint'), 49131);
  assert.strictEqual(tiles.radarArenaFor('unknown'), 49131);
})();

(function queueSession() {
  var meta = { past: frames('p', [100, 200, 300]), nowcast: frames('n', [400]) };
  var session = queue.createSession(meta, 1000);
  assert.deepStrictEqual(session.priority.map(function (e) { return e.time; }), [300, 200, 400, 100]);
  assert.ok(queue.noteFetched(session, session.priority[0], 30, [1]));
  assert.ok(queue.noteFetched(session, session.priority[1], 20, [2]));
  assert.ok(!queue.noteFetched(session, session.priority[2], 2000, [3]));
  assert.strictEqual(session.stopped, 'greedy');
  var layout = queue.finishFetch(session);
  assert.strictEqual(layout.count, 2);
  var first = queue.onLayoutAck(session);
  assert.strictEqual(first.time, 200);
  assert.strictEqual(first.slot, 0);
  var done = queue.onFrameAck(session, first.slot);
  assert.strictEqual(done, null);
  assert.strictEqual(queue.terminalCount(session), 2);
})();

console.log('radar_playback tests passed');
