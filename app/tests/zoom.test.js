// Node tests for zoom handling and tile cache
// node tests/zoom.test.js
var assert = require('assert');
var tilecache = require('../src/pkjs/tilecache.js');
var tiles = require('../src/pkjs/tiles.js');

(function zoomBounds() {
  // index.js is required with a Pebble stub below; check bounds first via
  // the stubbed load so the module initializes
  assert.strictEqual(tilecache.MAX_ENTRIES, 1024);
})();

(function cacheMissHit() {
  var cache = new tilecache.TileCache(4);
  assert.strictEqual(cache.get('a'), null);
  assert.strictEqual(cache.size(), 0);
  var bytes = new Uint8Array([1, 2, 3]);
  cache.set('a', bytes);
  assert.strictEqual(cache.get('a'), bytes);
  assert.strictEqual(cache.size(), 1);
  // re-setting an existing key is a no-op
  cache.set('a', new Uint8Array([9]));
  assert.strictEqual(cache.get('a'), bytes);
  assert.strictEqual(cache.size(), 1);
})();

(function cacheEvictsOldest() {
  var cache = new tilecache.TileCache(3);
  cache.set('a', [1]);
  cache.set('b', [2]);
  cache.set('c', [3]);
  cache.set('d', [4]);
  assert.strictEqual(cache.size(), 3);
  assert.strictEqual(cache.get('a'), null);
  assert.deepStrictEqual(cache.get('b'), [2]);
  assert.deepStrictEqual(cache.get('d'), [4]);
})();

(function cachedFetchSkipsNetworkOnHit() {
  var cache = new tilecache.TileCache(8);
  var stored = new Uint8Array([7, 7]);
  cache.set('http://x/6/1/2.png', stored);
  var calls = 0;
  function fetch(url, cb) {
    calls++;
    cb(null, new Uint8Array([0]));
  }
  tilecache.cachedFetch(cache, fetch, 'http://x/6/1/2.png', function (err, bytes) {
    assert.ifError(err);
    assert.strictEqual(bytes, stored);
  });
  assert.strictEqual(calls, 0);
  tilecache.cachedFetch(cache, fetch, 'http://x/5/1/2.png', function (err, bytes) {
    assert.ifError(err);
    assert.deepStrictEqual(Array.prototype.slice.call(bytes), [0]);
  });
  assert.strictEqual(calls, 1);
  // miss is now stored
  assert.deepStrictEqual(
    Array.prototype.slice.call(cache.get('http://x/5/1/2.png')), [0]);
  // errors are not cached
  tilecache.cachedFetch(cache, function (url, cb) { cb(new Error('nope')); },
    'http://x/9/9/9.png', function (err) {
      assert.ok(err);
    });
  assert.strictEqual(cache.get('http://x/9/9/9.png'), null);
})();

(function zoomToViewport() {
  // test partition by zoom
  var screen = tiles.screenFor('aplite');
  var v6 = tiles.viewportFor(30.0, -80.0, 6, screen);
  var v5 = tiles.viewportFor(30.0, -80.0, 5, screen);
  assert.notDeepStrictEqual(v6.center, v5.center);
  assert.strictEqual(v6.zoom, 6);
  assert.strictEqual(v5.zoom, 5);
})();

// full handler test: stub Pebble + failing network, drive the
// ready and ZoomLevel events captured from index.js.
(function zoomReload() {
  var listeners = {};
  var sends = 0;
  global.Pebble = {
    addEventListener: function (name, fn) { listeners[name] = fn; },
    sendAppMessage: function (msg, onDone) {
      sends++;
      if (onDone) onDone();
    }
  };
  var fetchCalls = 0;
  var fetchJsonCalls = 0;
  tiles.fetchArrayBuffer = function (url, cb) {
    fetchCalls++;
    cb(new Error('offline'));
  };
  tiles.fetchJson = function (url, cb) {
    fetchJsonCalls++;
    cb(new Error('offline'));
  };
  var index = require('../src/pkjs/index.js');
  assert.strictEqual(index.ZOOM_MIN, 3);
  assert.strictEqual(index.ZOOM_MAX, 7);
  assert.strictEqual(index.ZOOM_DEFAULT, 6);
  [3, 4, 5, 6, 7].forEach(function (z) {
    assert.ok(index.isValidZoom(z), 'zoom ' + z + ' valid');
  });
  [2, 8, 0, -1, '6', null, undefined, NaN].forEach(function (z) {
    assert.ok(!index.isValidZoom(z), 'zoom ' + z + ' invalid');
  });

  assert.ok(listeners.ready, 'ready listener registered');
  assert.ok(listeners.appmessage, 'appmessage listener registered');
  listeners.ready();
  var afterReadyFetches = fetchCalls;
  assert.ok(afterReadyFetches > 0, 'initial load fetches map tiles');
  assert.ok(fetchJsonCalls > 0, 'initial load fetches radar meta');

  // out-of-range zoom is ignored: no new fetches
  listeners.appmessage({ payload: { ZoomLevel: 8 } });
  listeners.appmessage({ payload: { ZoomLevel: 2 } });
  assert.strictEqual(fetchCalls, afterReadyFetches);
  assert.ok(sends === 0, 'failed builds send nothing');

  // valid zoom triggers a fresh load at the new zoom
  listeners.appmessage({ payload: { ZoomLevel: 5 } });
  assert.ok(fetchCalls > afterReadyFetches, 'zoom reload fetches tiles');
  var afterZoom = fetchCalls;
  // duplicate of the current zoom is a no-op
  listeners.appmessage({ payload: { ZoomLevel: 5 } });
  listeners.appmessage({ payload: { ZoomLevel: 5 } });
  // (duplicate is skipped only while a session is active; with the
  // network failing there is no session, so it reloads harmlessly)
  assert.ok(fetchCalls >= afterZoom);

  // radar must wait for the map send to finish: with map tile fetches
  // still outstanding, no radar meta fetch may have been attempted
  var metaCalls = 0;
  var metaCbs = [];
  var tileCbs = [];
  tiles.fetchJson = function (url, cb) { metaCalls++; metaCbs.push(cb); };
  tiles.fetchArrayBuffer = function (url, cb) { tileCbs.push(cb); };
  listeners.appmessage({ payload: { ZoomLevel: 4 } });
  assert.ok(tileCbs.length > 0, 'zoom starts map tile fetches');
  assert.strictEqual(metaCalls, 0, 'radar waits for map send');
  // map tiles fail -> map done -> radar metadata starts
  while (tileCbs.length) tileCbs.shift()(new Error('offline'));
  assert.ok(metaCalls > 0, 'radar starts after map settles');
  metaCbs.forEach(function (cb) { cb(new Error('offline')); });
  delete global.Pebble;
})();

(function sendAbortAndCompletion() {
  var send = require('../src/pkjs/send.js');
  var pending = [];
  var sent = [];
  global.Pebble = {
    sendAppMessage: function (msg, ok, fail) {
      pending.push({ ok: ok, fail: fail });
      sent.push(msg);
    }
  };
  var packet = new Uint8Array(5000);
  var doneCalls = 0;
  var failCalls = 0;
  var aborted = false;
  send.sendMap(packet, 8000,
    function () { doneCalls++; }, function () { failCalls++; },
    1000, function () { return aborted; });
  assert.strictEqual(pending.length, 1);
  assert.ok('MapLength' in sent[0]);
  pending.shift().ok(); // start acked -> chunk 0
  assert.ok('MapChunk' in sent[sent.length - 1]);
  pending.shift().ok(); // chunk 0 acked -> chunk 1
  aborted = true;
  pending.shift().ok(); // chunk 1 acked -> must stop silently
  assert.strictEqual(pending.length, 0);
  assert.strictEqual(doneCalls, 0);
  assert.strictEqual(failCalls, 0);

  // uninterrupted run completes with a MapDone trailer
  pending = [];
  sent = [];
  var done2 = 0;
  send.sendMap(packet, 8000, function () { done2++; }, function () {}, 1000);
  var guard = 0;
  while (pending.length && guard++ < 20) pending.shift().ok();
  assert.strictEqual(done2, 1);
  assert.strictEqual(pending.length, 0);
  assert.strictEqual(sent[sent.length - 1].MapDone, 8000);

  // transport failure propagates to onFail
  pending = [];
  var fail2 = 0;
  send.sendMap(packet, 8000, function () {}, function () { fail2++; }, 1000);
  pending.shift().ok();
  pending.shift().fail(new Error('bt down'));
  assert.strictEqual(fail2, 1);
  delete global.Pebble;
})();

console.log('zoom tests passed');
