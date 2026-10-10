// BW dither pattern selection
// node tests/dither.test.js
var assert = require('assert');
var radar = require('../src/pkjs/radar.js');

(function setDitherValidation() {
  assert.strictEqual(radar.setDither('2x2'), true);
  assert.strictEqual(radar.setDither('4x4'), true);
  assert.strictEqual(radar.setDither('nonsense'), false);
  assert.strictEqual(radar.setDither(null), false);
  assert.strictEqual(radar.setDither(undefined), false);
})();

(function defaultFollowsSetter() {
  // 30% rain coverage on every pixel
  function coverage() {
    var n = 16;
    var indices = [], phases = [], dbzs = [];
    for (var i = 0; i < n; i++) {
      indices.push(1);
      phases.push(1);
      dbzs.push(22);
    }
    return { indices: indices, phases: phases, dbzs: dbzs };
  }
  radar.setDither('2x2');
  var two = Array.from(radar.ditherToMask(coverage(), 4, 4));
  // retain previous matrix on rejected name
  assert.strictEqual(radar.setDither('nonsense'), false);
  assert.deepStrictEqual(Array.from(radar.ditherToMask(coverage(), 4, 4)), two);
  radar.setDither('4x4');
  var four = Array.from(radar.ditherToMask(coverage(), 4, 4));
  assert.strictEqual(four.length, 16);
  assert.ok(four.some(function (v) { return v === 1; }));
  assert.ok(two.some(function (v, i) { return v !== four[i]; }));
  radar.setDither('2x2');
})();

console.log('dither tests passed');
