// radar frame count limits
// node tests/frame_limits.test.js
var assert = require('assert');
var radar = require('../src/pkjs/radar.js');

function frames(prefix, times) {
  return times.map(function (t) { return { time: t, path: '/' + prefix + '/' + t }; });
}

(function setFrameLimitsValidation() {
  assert.strictEqual(radar.setFrameLimits(3, 1), true);
  assert.strictEqual(radar.setFrameLimits(3, 1), false);
  assert.strictEqual(radar.setFrameLimits('bogus', {}), false);
  assert.strictEqual(radar.setFrameLimits(null, undefined), false);
  assert.strictEqual(radar.setFrameLimits(0, -1), true);
  assert.strictEqual(radar.setFrameLimits(99, 99), true);
  radar.setFrameLimits(12, 6);
})();

(function clampsToRange() {
  radar.setFrameLimits(0, -1);
  var order = radar.priorityOrder(frames('p', [100, 200, 300]), frames('n', [400]));
  assert.deepStrictEqual(order.map(function (e) { return e.time; }), [300]);
  assert.deepStrictEqual(order.map(function (e) { return e.kind; }), ['live']);
  radar.setFrameLimits(99, 99);
  order = radar.priorityOrder(frames('p', [100, 200, 300]), frames('n', [400, 500]));
  assert.deepStrictEqual(order.map(function (e) { return e.time; }), [300, 200, 400, 100, 500]);
  radar.setFrameLimits(12, 6);
})();

(function honorsCustomCaps() {
  radar.setFrameLimits(3, 1);
  var order = radar.priorityOrder(
    frames('p', [100, 200, 300, 400, 500]), frames('n', [600, 700]));
  assert.deepStrictEqual(order.map(function (e) { return e.time; }), [500, 400, 600, 300]);
  assert.deepStrictEqual(order.map(function (e) { return e.kind; }),
    ['live', 'past', 'nowcast', 'past']);
  radar.setFrameLimits(12, 6);
})();

(function liveOnly() {
  radar.setFrameLimits(1, 0);
  var order = radar.priorityOrder(frames('p', [100, 200, 300]), frames('n', [400]));
  assert.deepStrictEqual(order.map(function (e) { return e.time; }), [300]);
  assert.deepStrictEqual(order.map(function (e) { return e.kind; }), ['live']);
  radar.setFrameLimits(12, 6);
})();

console.log('frame_limits tests passed');
