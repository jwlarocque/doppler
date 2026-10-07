// simplified radar refresh change detection
// node tests/radar_refresh.test.js
var assert = require('assert');
var radar = require('../src/pkjs/radar.js');

function frames(prefix, times) {
  return times.map(function (t) { return { time: t, path: '/' + prefix + '/' + t }; });
}

(function noChange() {
  var meta = { past: frames('p', [100, 200, 300]), nowcast: frames('n', [400]) };
  assert.strictEqual(radar.metaChanged(meta, {
    past: frames('p', [100, 200, 300]),
    nowcast: frames('n', [400])
  }), false);
})();

(function newNowcastTail() {
  assert.strictEqual(radar.metaChanged(
    { past: frames('p', [100, 200]), nowcast: frames('n', [300]) },
    { past: frames('p', [100, 200]), nowcast: frames('n', [300, 400]) }
  ), true);
})();

(function newPastObservation() {
  assert.strictEqual(radar.metaChanged(
    {
      past: frames('p', [100, 200, 300]),
      nowcast: frames('n', [400, 500])
    },
    {
      past: frames('p', [100, 200, 300, 400]),
      nowcast: frames('n', [500, 600])
    }
  ), true);
})();

(function droppedOldestPastOnly() {
  assert.strictEqual(radar.metaChanged(
    {
      past: frames('p', [100, 200, 300]),
      nowcast: frames('n', [400])
    },
    {
      past: frames('p', [200, 300]),
      nowcast: frames('n', [400])
    }
  ), false);
})();

(function missingMeta() {
  assert.strictEqual(radar.metaChanged(null, null), false);
  assert.strictEqual(radar.metaChanged(null,
    { past: frames('p', [100]), nowcast: [] }), false);
})();

console.log('radar_refresh tests passed');
