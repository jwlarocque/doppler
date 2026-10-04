var tiles = require('./tiles.js');
var config = require('./config.js');
var png = require('./png.js');


var COLOR_PALETTES = {
  nexrad: {
    rain: { start: 10, end: 70, bands: 12 },
    snow: { start: 5, end: 35, bands: 3 }
  }
};
var ACTIVE_PALETTE = 'nexrad';

var BW_COVERAGE = {
  rain: { start: 10, end: 50 },
  snow: { start: 0, end: 40 }
};
var BAYER_2X2 = [[0, 2], [3, 1]];
var BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
];
var DITHER_MATRIX = BAYER_2X2;

// Convert a LiberWXR scheme 0 (grayscale) pixel to {phase, dbz}
// or null for transparent
function decodePixel(r, a) {
  if (a === 0) return null;
  if (r < 128) return { phase: 'rain', dbz: r - 32 };
  if (r === 128) return null; // snow background
  return { phase: 'snow', dbz: r - 160 };
}

function bandIndex(dbz, start, end, count) {
  if (count <= 0) return -1;
  if (dbz < start) return -1;
  if (end <= start) return count - 1;
  var w = (end - start) / count;
  var b = Math.floor((dbz - start) / w);
  if (b < 0) b = 0;
  if (b >= count) b = count - 1;
  return b;
}

function bwCoverage(dbz, start, end) {
  if (end <= start) return dbz >= end ? 1 : 0;
  var f = (dbz - start) / (end - start);
  if (f < 0) return 0;
  if (f > 1) return 1;
  return f;
}

function bwOpaque(f, x, y, matrix) {
  var m = matrix || DITHER_MATRIX;
  var n = m.length;
  if (f <= 0) return false;
  if (f >= 1) return true;
  return m[y % n][x % n] < f * n * n;
}

// Convert RGBA (screenW*screenH*4) to uint4 palette indices
// and phase/dbz for dithering on bw
function classify(rgba, screenW, screenH, palette) {
  var pal = palette || COLOR_PALETTES[ACTIVE_PALETTE];
  var rainBands = pal.rain.bands;
  var indices = new Uint8Array(screenW * screenH);
  var phases = new Uint8Array(screenW * screenH); // 0 none, 1 rain, 2 snow
  var dbzs = new Int16Array(screenW * screenH);
  for (var i = 0; i < screenW * screenH; i++) {
    var dec = decodePixel(rgba[i * 4], rgba[i * 4 + 3]);
    if (!dec) continue;
    var b;
    if (dec.phase === 'rain') {
      b = bandIndex(dec.dbz, pal.rain.start, pal.rain.end, rainBands);
      if (b < 0) continue;
      indices[i] = 1 + b;
      phases[i] = 1;
    } else {
      b = bandIndex(dec.dbz, pal.snow.start, pal.snow.end, pal.snow.bands);
      if (b < 0) continue;
      indices[i] = 1 + rainBands + b;
      phases[i] = 2;
    }
    dbzs[i] = dec.dbz;
  }
  return { indices: indices, phases: phases, dbzs: dbzs };
}

// Dither to 1bpp opaque-on-transparent for bw
function ditherToMask(classified, screenW, screenH, matrix) {
  var mask = new Uint8Array(screenW * screenH);
  for (var y = 0; y < screenH; y++) {
    for (var x = 0; x < screenW; x++) {
      var i = y * screenW + x;
      if (!classified.indices[i]) continue;
      var range = classified.phases[i] === 1 ? BW_COVERAGE.rain : BW_COVERAGE.snow;
      var f = bwCoverage(classified.dbzs[i], range.start, range.end);
      mask[i] = bwOpaque(f, x, y, matrix) ? 1 : 0;
    }
  }
  return mask;
}

function fetchMeta(hostOverride, callback) {
  var host = hostOverride || config.librewxrHost;
  tiles.fetchJson(host + '/public/weather-maps.json', function (err, meta) {
    if (err) {
      callback(err);
      return;
    }
    var past = meta && meta.radar && meta.radar.past;
    if (!past || !past.length) {
      callback(new Error('no past radar frames in metadata'));
      return;
    }
    var frame = past[past.length - 1];
    callback(null, {
      host: meta.host || host,
      time: frame.time,
      path: frame.path
    });
  });
}

function tileUrl(host, path, z, x, y) {
  return host + path + '/256/' + z + '/' + x + '/' + y + '/0/0_1.png';
}

function decodeTile(bytes) {
  return { data: png.decodeRgbaPng(bytes).rgba, bytesPerPixel: 4 };
}

function buildRadarImage(fetcher, viewport, screen, frame, callback) {
  tiles.fetchViewport(fetcher, viewport, decodeTile, function (err, res) {
    if (err) {
      callback(err);
      return;
    }
    var classified = classify(res.stitched, viewport.screenW, viewport.screenH);
    if (screen.round) {
      tiles.clearCorners(classified.indices, viewport.screenW, viewport.screenH);
    }
    var packed;
    if (screen.bw) {
      var mask = ditherToMask(classified, viewport.screenW, viewport.screenH);
      packed = tiles.packTo1bpp(mask, viewport.screenW, viewport.screenH, 1);
    } else {
      packed = tiles.packIndices(classified.indices, viewport.screenW, viewport.screenH, 4);
    }
    callback(null, {
      packed: packed,
      indices: classified.indices,
      width: viewport.screenW,
      height: viewport.screenH,
      tiles: res.tiles,
      center: res.center
    });
  });
}

module.exports = {
  COLOR_PALETTES: COLOR_PALETTES,
  ACTIVE_PALETTE: ACTIVE_PALETTE,
  BW_COVERAGE: BW_COVERAGE,
  BAYER_2X2: BAYER_2X2,
  BAYER_4X4: BAYER_4X4,
  DITHER_MATRIX: DITHER_MATRIX,
  decodePixel: decodePixel,
  bandIndex: bandIndex,
  bwCoverage: bwCoverage,
  bwOpaque: bwOpaque,
  classify: classify,
  ditherToMask: ditherToMask,
  fetchMeta: fetchMeta,
  tileUrl: tileUrl,
  buildRadarImage: buildRadarImage
};
