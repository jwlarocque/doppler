// radar palette selection
// node tests/palette.test.js
var assert = require('assert');
var radar = require('../src/pkjs/radar.js');

// two opaque pixels, rain dbz=48 and snow dbz=40
var px = [80, 0, 0, 255, 200, 0, 0, 255];

(function setPaletteValidation() {
  assert.strictEqual(radar.setPalette('nexrad'), true);
  assert.strictEqual(radar.setPalette('darksky'), true);
  assert.strictEqual(radar.setPalette('nonexistant'), false);
  assert.strictEqual(radar.setPalette(null), false);
  assert.strictEqual(radar.setPalette(undefined), false);
})();

(function defaultFollowsSetter() {
  radar.setPalette('nexrad');
  assert.deepStrictEqual(
    radar.classify(px, 2, 1).indices,
    radar.classify(px, 2, 1, radar.COLOR_PALETTES.nexrad).indices);
  // retain previous palette if rejected
  assert.strictEqual(radar.setPalette('nonexistant'), false);
  assert.deepStrictEqual(
    radar.classify(px, 2, 1).indices,
    radar.classify(px, 2, 1, radar.COLOR_PALETTES.nexrad).indices);
  radar.setPalette('darksky');
  assert.deepStrictEqual(
    radar.classify(px, 2, 1).indices,
    radar.classify(px, 2, 1, radar.COLOR_PALETTES.darksky).indices);
})();

(function palettesCover15Bands() {
  // watch color tables have 16 entries (0 is transparent)
  ['nexrad', 'darksky'].forEach(function (name) {
    var pal = radar.COLOR_PALETTES[name];
    assert.strictEqual(pal.rain.bands + pal.snow.bands, 15);
  });
})();

console.log('palette tests passed');
