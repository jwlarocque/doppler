var tiles = require('./tiles.js');
var config = require('./config.js');
var png = require('./png.js');


var COLOR_PALETTES = {
  nexrad: {
    rain: { start: 10, end: 70, bands: 12 },
    snow: { start: 5, end: 35, bands: 3 }
  },
  darksky: {
    rain: { start: 15, end: 55, bands: 9 },
    snow: { start: 10, end: 35, bands: 6 },
    dither: true,
    ditherStrength: 1.0
  }
};
var ACTIVE_PALETTE = 'darksky';

function setPalette(name) {
  if (name && COLOR_PALETTES[name]) {
    ACTIVE_PALETTE = name;
    return true;
  }
  return false;
}

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
var DITHER_MATRICES = {
  '2x2': BAYER_2X2,
  '4x4': BAYER_4X4
};
var ACTIVE_DITHER = '2x2';

function setDither(name) {
  if (name && DITHER_MATRICES[name]) {
    ACTIVE_DITHER = name;
    return true;
  }
  return false;
}

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
  var m = matrix || DITHER_MATRICES[ACTIVE_DITHER];
  var n = m.length;
  if (f <= 0) return false;
  if (f >= 1) return true;
  return m[y % n][x % n] < f * n * n;
}

// Bayer dither between adjacent color bands (and transparent)
function ditherBand(dbz, start, end, count, x, y, strength) {
  if (count <= 0) return -1;
  if (end <= start) return count - 1;
  var w = (end - start) / count;
  var p = (dbz - start) / w;
  if (p < -1) return -1;
  if (p >= count) return count - 1;
  var lo = Math.floor(p);
  var frac = p - lo;
  if (p < 0) { lo = -1; frac = p + 1; }
  var t = BAYER_2X2[y & 1][x & 1] / 4;
  var thresh = (1 - strength) * 0.5 + strength * t;
  var sel = (frac > thresh) ? lo + 1 : lo;
  if (sel < 0) return -1;
  if (sel >= count) return count - 1;
  return sel;
}

// Convert RGBA (screenW*screenH*4) to uint4 palette indices
// and phase/dbz for dithering on bw
function classify(rgba, screenW, screenH, palette) {
  var pal = palette || COLOR_PALETTES[ACTIVE_PALETTE];
  var rainBands = pal.rain.bands;
  var useDither = !!pal.dither && pal.ditherStrength > 0;
  var strength = pal.ditherStrength || 0;
  var indices = new Uint8Array(screenW * screenH);
  var phases = new Uint8Array(screenW * screenH); // 0 none, 1 rain, 2 snow
  var dbzs = new Int16Array(screenW * screenH);
  for (var i = 0; i < screenW * screenH; i++) {
    var dec = decodePixel(rgba[i * 4], rgba[i * 4 + 3]);
    if (!dec) continue;
    var x = i % screenW;
    var y = (i / screenW) | 0;
    var b;
    if (dec.phase === 'rain') {
      b = useDither
        ? ditherBand(dec.dbz, pal.rain.start, pal.rain.end, rainBands, x, y, strength)
        : bandIndex(dec.dbz, pal.rain.start, pal.rain.end, rainBands);
      if (b < 0) continue;
      indices[i] = 1 + b;
      phases[i] = 1;
    } else {
      b = useDither
        ? ditherBand(dec.dbz, pal.snow.start, pal.snow.end, pal.snow.bands, x, y, strength)
        : bandIndex(dec.dbz, pal.snow.start, pal.snow.end, pal.snow.bands);
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
    var nowcast = (meta && meta.radar && meta.radar.nowcast) || [];
    var frame = past[past.length - 1];
    callback(null, {
      host: meta.host || host,
      past: past,
      nowcast: nowcast,
      time: frame.time,
      path: frame.path
    });
  });
}

function tileUrl(host, path, z, x, y) {
  return host + path + '/256/' + z + '/' + x + '/' + y + '/0/0_1.png';
}

// returns true when new radar data is available:
// - new past frame (replaces a nowcast)
// - new nowcast frame (new timestamp)
function metaChanged(oldMeta, newMeta) {
  if (!oldMeta || !newMeta) return false;
  var oldPast = oldMeta.past || [];
  var newPast = newMeta.past || [];
  var oldLatest = oldPast.length ? oldPast[oldPast.length - 1].time : -1;
  var newLatest = newPast.length ? newPast[newPast.length - 1].time : -1;
  if (newLatest !== oldLatest) return true;
  var oldNow = oldMeta.nowcast || [];
  var newNow = newMeta.nowcast || [];
  if (newNow.length !== oldNow.length) return true;
  for (var i = 0; i < newNow.length; i++) {
    if (newNow[i].time !== oldNow[i].time) return true;
  }
  return false;
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

var PAST_MAX = 12;
var NOWCAST_MAX = 6;
var MAX_FRAMES = 18;

// fetch priority order, middle-out starting with live:
// live, past[-2], nowcast[0], past[-3], nowcast[1], ...
function priorityOrder(past, nowcast) {
  past = past || [];
  nowcast = nowcast || [];
  var cappedPast = past.slice(Math.max(0, past.length - PAST_MAX));
  var cappedNow = nowcast.slice(0, NOWCAST_MAX);
  if (!cappedPast.length) return [];
  var out = [];
  var live = cappedPast[cappedPast.length - 1];
  out.push({ kind: 'live', time: live.time, path: live.path });
  var pastRest = [];
  for (var i = cappedPast.length - 2; i >= 0; i--) {
    pastRest.push({ kind: 'past', time: cappedPast[i].time, path: cappedPast[i].path });
  }
  var j = 0;
  var k = 0;
  while (j < pastRest.length || k < cappedNow.length) {
    if (j < pastRest.length) out.push(pastRest[j++]);
    if (k < cappedNow.length) {
      out.push({ kind: 'nowcast', time: cappedNow[k].time, path: cappedNow[k].path });
      k++;
    }
  }
  return out;
}

function sizeOfEntry(sizes, entry) {
  if (!sizes) return 0;
  if (typeof sizes === 'function') return sizes(entry);
  return sizes[entry.time];
}

// pack in priority order; sum sizes until the arena size is exceeded
function orderFrames(past, nowcast, sizes, arenaBytes) {
  var ordered = priorityOrder(past, nowcast);
  var kept = [];
  var total = 0;
  var stop = 'exhausted';
  for (var i = 0; i < ordered.length; i++) {
    var s = sizeOfEntry(sizes, ordered[i]);
    if (typeof s !== 'number') break;
    if (total + s > arenaBytes) {
      stop = 'greedy';
      break;
    }
    kept.push(ordered[i]);
    total += s;
  }
  return { frames: kept, totalBytes: total, stop: stop };
}

// returns chronological slot + offset for a frame
function slotFor(sortedKept, sizeOf, i) {
  var offset = 0;
  for (var j = 0; j < i; j++) offset += sizeOf(sortedKept[j]);
  return {
    slot: i,
    offset: offset,
    len: sizeOf(sortedKept[i]),
    time: sortedKept[i].time
  };
}

// generate chronological order with offsets
function layoutSlots(keptPriority, sizes) {
  var sizeFn = (typeof sizes === 'function')
    ? sizes
    : function (e) { return sizes[e.time]; };
  var sorted = keptPriority.slice().sort(function (a, b) { return a.time - b.time; });
  var slots = [];
  var offset = 0;
  var liveSlot = -1;
  for (var i = 0; i < sorted.length; i++) {
    var len = sizeFn(sorted[i]);
    slots.push({
      slot: i,
      offset: offset,
      len: len,
      time: sorted[i].time,
      path: sorted[i].path,
      kind: sorted[i].kind
    });
    if (sorted[i].kind === 'live') liveSlot = i;
    offset += len;
  }
  return { slots: slots, liveSlot: liveSlot, totalBytes: offset, count: slots.length };
}

function writeU32LE(out, v) {
  out.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255);
}

// encode the layout blob defined in radar.h
function encodeLayout(layout) {
  var out = [1, layout.slots.length, layout.liveSlot, 0];
  for (var i = 0; i < layout.slots.length; i++) {
    writeU32LE(out, layout.slots[i].offset);
    writeU32LE(out, layout.slots[i].len);
    writeU32LE(out, layout.slots[i].time >>> 0);
  }
  return out;
}

function decodeLayout(bytes) {
  var n = bytes[1];
  var slots = [];
  for (var i = 0; i < n; i++) {
    var base = 4 + i * 12;
    var off = bytes[base] | (bytes[base + 1] << 8) |
      (bytes[base + 2] << 16) | (bytes[base + 3] << 24);
    var len = bytes[base + 4] | (bytes[base + 5] << 8) |
      (bytes[base + 6] << 16) | (bytes[base + 7] << 24);
    var time = (bytes[base + 8] | (bytes[base + 9] << 8) |
      (bytes[base + 10] << 16) | (bytes[base + 11] << 24)) >>> 0;
    slots.push({ slot: i, offset: off >>> 0, len: len >>> 0, time: time });
  }
  return { version: bytes[0], count: n, liveSlot: bytes[2], slots: slots };
}

module.exports = {
  COLOR_PALETTES: COLOR_PALETTES,
  ACTIVE_PALETTE: ACTIVE_PALETTE,
  setPalette: setPalette,
  BW_COVERAGE: BW_COVERAGE,
  BAYER_2X2: BAYER_2X2,
  BAYER_4X4: BAYER_4X4,
  DITHER_MATRICES: DITHER_MATRICES,
  ACTIVE_DITHER: ACTIVE_DITHER,
  setDither: setDither,
  decodePixel: decodePixel,
  bandIndex: bandIndex,
  ditherBand: ditherBand,
  bwCoverage: bwCoverage,
  bwOpaque: bwOpaque,
  classify: classify,
  ditherToMask: ditherToMask,
  fetchMeta: fetchMeta,
  tileUrl: tileUrl,
  metaChanged: metaChanged,
  buildRadarImage: buildRadarImage,
  PAST_MAX: PAST_MAX,
  NOWCAST_MAX: NOWCAST_MAX,
  MAX_FRAMES: MAX_FRAMES,
  priorityOrder: priorityOrder,
  orderFrames: orderFrames,
  slotFor: slotFor,
  layoutSlots: layoutSlots,
  encodeLayout: encodeLayout,
  decodeLayout: decodeLayout
};
