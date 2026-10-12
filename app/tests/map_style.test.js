// map tile style selection (tiles_simple vs tiles_dither)
// node tests/map_style.test.js
var assert = require('assert');
var config = require('../src/pkjs/config.js');
var map = require('../src/pkjs/map.js');

(function setMapStyleValidation() {
  config.setMapStyle('simple');
  assert.strictEqual(config.setMapStyle('simple'), false);
  assert.strictEqual(config.setMapStyle('dither'), true);
  assert.strictEqual(config.settings.mapStyle, 'dither');
  assert.strictEqual(config.setMapStyle('dither'), false);
  assert.strictEqual(config.setMapStyle('nonsense'), false);
  assert.strictEqual(config.setMapStyle(null), false);
  assert.strictEqual(config.setMapStyle(undefined), false);
  // rejected names retain the previous style
  assert.strictEqual(config.settings.mapStyle, 'dither');
  assert.strictEqual(config.setMapStyle('simple'), true);
})();

(function tileUrls() {
  config.setMapStyle('simple');
  assert.strictEqual(
    map.tileUrl(7, 32, 47),
    config.settings.mapTileHost + '/tiles_simple/7/32/47.png');
  config.setMapStyle('dither');
  assert.strictEqual(
    map.tileUrl(7, 32, 47),
    config.settings.mapTileHost + '/tiles_dither/7/32/47.png');
  // explicit base override
  assert.strictEqual(map.tileUrl(7, 32, 47, 'http://x'), 'http://x/7/32/47.png');
  // otherwise, URL must have a style
  assert.ok(map.tileUrl(7, 32, 47).indexOf('/tiles_') !== -1);
  config.setMapStyle('simple');
})();

console.log('map_style tests passed');
