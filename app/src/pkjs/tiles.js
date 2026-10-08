var TILE_SIZE = 256;

var SCREENS = {
  // aplite uses small chunks to save memory.
  aplite: { w: 144, h: 168, bw: true, round: false, chunk: 250 },
  basalt: { w: 144, h: 168, bw: false, round: false, chunk: 1500 },
  chalk: { w: 180, h: 180, bw: false, round: true, chunk: 1500 },
  diorite: { w: 144, h: 168, bw: true, round: false, chunk: 1500 },
  flint: { w: 144, h: 168, bw: true, round: false, chunk: 1500 },
  emery: { w: 200, h: 228, bw: false, round: false, chunk: 1500 },
  gabbro: { w: 260, h: 260, bw: false, round: true, chunk: 1500 }
};

function screenFor(platform) {
  if (SCREENS[platform]) return SCREENS[platform];
  return SCREENS.flint;
}

// Must match RADAR_ARENA_BYTES in c/radar.h exactly
var RADAR_ARENA_BYTES = {
  aplite: 10219,
  basalt: 43851,
  chalk: 42551,
  diorite: 49131,
  flint: 49131,
  emery: 102400,
  gabbro: 98549
};

function radarArenaFor(platform) {
  if (RADAR_ARENA_BYTES[platform]) return RADAR_ARENA_BYTES[platform];
  return RADAR_ARENA_BYTES.aplite;
}

function latLonToWorldPixel(lat, lon, zoom) {
  var world = TILE_SIZE * Math.pow(2, zoom);
  var x = (lon + 180) / 360 * world;
  var latRad = lat * Math.PI / 180;
  var merc = Math.log(Math.tan(latRad) + 1 / Math.cos(latRad));
  var y = (1 - merc / Math.PI) / 2 * world;
  return { x: x, y: y };
}

function tilesForViewport(centerX, centerY, screenW, screenH) {
  var left = centerX - screenW / 2;
  var top = centerY - screenH / 2;
  var tileX0 = Math.floor(left / TILE_SIZE);
  var tileY0 = Math.floor(top / TILE_SIZE);
  var tileX1 = Math.floor((left + screenW - 1) / TILE_SIZE);
  var tileY1 = Math.floor((top + screenH - 1) / TILE_SIZE);
  var tiles = [];
  for (var ty = tileY0; ty <= tileY1; ty++) {
    for (var tx = tileX0; tx <= tileX1; tx++) {
      tiles.push({ x: tx, y: ty });
    }
  }
  return {
    tiles: tiles,
    offsetX: Math.round(left - tileX0 * TILE_SIZE),
    offsetY: Math.round(top - tileY0 * TILE_SIZE),
    left: left,
    top: top
  };
}

function viewportFor(lat, lon, zoom, screen) {
  var center = latLonToWorldPixel(lat, lon, zoom);
  var view = tilesForViewport(center.x, center.y, screen.w, screen.h);
  return { center: center, view: view, zoom: zoom, screenW: screen.w, screenH: screen.h };
}

// euclidean distance in pixels at the given zoom
function worldPixelDistanceAtZoom(lat1, lon1, lat2, lon2, zoom) {
  var a = latLonToWorldPixel(lat1, lon1, zoom);
  var b = latLonToWorldPixel(lat2, lon2, zoom);
  var dx = a.x - b.x;
  var dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// fetch every tile in the viewport and stitch to a screen-sized buffer
function fetchViewport(fetcher, viewport, decodeTile, callback) {
  var view = viewport.view;
  var screenW = viewport.screenW;
  var screenH = viewport.screenH;
  var tileX0 = Math.floor(view.left / TILE_SIZE);
  var tileY0 = Math.floor(view.top / TILE_SIZE);
  var pending = view.tiles.length;
  var decoded = {};
  var bytesPerPixel = 0;
  var failed = null;
  view.tiles.forEach(function (t) {
    fetcher(viewport.zoom, t.x, t.y, function (err, bytes) {
      if (!err) {
        try {
          var tile = decodeTile(bytes);
          decoded[t.x + '/' + t.y] = tile;
          bytesPerPixel = tile.bytesPerPixel;
        } catch (e) {
          err = e;
        }
      }
      if (err && !failed) failed = err;
      if (--pending === 0) {
        if (failed) {
          callback(failed);
          return;
        }
        callback(null, {
          stitched: stitchAndCrop(decoded, tileX0, tileY0,
            view.offsetX, view.offsetY, screenW, screenH, bytesPerPixel),
          tiles: view.tiles.length,
          center: viewport.center
        });
      }
    });
  });
}

// stitch per-tile pixel buffers into one screen-sized buffer
// assumes each decoded tile is { data: <flat array>, bytesPerPixel: n }
// returns a Uint8Array of screenW*screenH*bytesPerPixel
function stitchAndCrop(decoded, tileX0, tileY0, offsetX, offsetY,
    screenW, screenH, bytesPerPixel) {
  var out = new Uint8Array(screenW * screenH * bytesPerPixel);
  for (var y = 0; y < screenH; y++) {
    for (var x = 0; x < screenW; x++) {
      var srcX = offsetX + x;
      var srcY = offsetY + y;
      var tx = tileX0 + Math.floor(srcX / TILE_SIZE);
      var ty = tileY0 + Math.floor(srcY / TILE_SIZE);
      var key = tx + '/' + ty;
      var tile = decoded[key];
      var lx = srcX % TILE_SIZE;
      if (lx < 0) lx += TILE_SIZE;
      var ly = srcY % TILE_SIZE;
      if (ly < 0) ly += TILE_SIZE;
      var srcOff = (ly * TILE_SIZE + lx) * bytesPerPixel;
      var dstOff = (y * screenW + x) * bytesPerPixel;
      for (var b = 0; b < bytesPerPixel; b++) {
        out[dstOff + b] = tile.data[srcOff + b];
      }
    }
  }
  return out;
}

// zero pixels outside the inscribed circle on round screens
function clearCorners(buffer, screenW, screenH) {
  var cx = (screenW - 1) / 2;
  var cy = (screenH - 1) / 2;
  var r = screenW / 2;
  for (var y = 0; y < screenH; y++) {
    for (var x = 0; x < screenW; x++) {
      var dx = x - cx;
      var dy = y - cy;
      if (dx * dx + dy * dy > r * r) buffer[y * screenW + x] = 0;
    }
  }
  return buffer;
}

// pack values to 1bpp rows (byte = x/8, bit = x%8)
function packTo1bpp(values, screenW, screenH, threshold) {
  var stride = Math.ceil(screenW / 8);
  var out = new Uint8Array(stride * screenH);
  for (var y = 0; y < screenH; y++) {
    for (var x = 0; x < screenW; x++) {
      if (values[y * screenW + x] >= threshold) {
        out[y * stride + (x >> 3)] |= (1 << (x & 7));
      }
    }
  }
  return out;
}

// pack indices into byte array at bitsPerPixel
function packIndices(indices, screenW, screenH, bitsPerPixel) {
  var perByte = 8 / bitsPerPixel;
  var stride = Math.ceil(screenW / perByte);
  var out = new Uint8Array(stride * screenH);
  for (var y = 0; y < screenH; y++) {
    for (var x = 0; x < screenW; x++) {
      var v = indices[y * screenW + x] & ((1 << bitsPerPixel) - 1);
      out[y * stride + ((x / perByte) | 0)] |= v << (8 - bitsPerPixel * ((x % perByte) + 1));
    }
  }
  return out;
}

function getResponse(url, binary, callback) {
  if (typeof XMLHttpRequest !== 'undefined') {
    var req = new XMLHttpRequest();
    req.open('GET', url, true);
    if (binary) req.responseType = 'arraybuffer';
    req.onload = function () {
      if (req.status === 200) {
        callback(null, binary ? new Uint8Array(req.response) : req.responseText);
      } else {
        callback(new Error('HTTP ' + req.status + ' for ' + url));
      }
    };
    req.onerror = function () { callback(new Error('network error for ' + url)); };
    req.send();
    return;
  }
  var mod = /^https:/.test(url) ? require('https') : require('http');
  mod.get(url, function (res) {
    if (res.statusCode !== 200) {
      callback(new Error('HTTP ' + res.statusCode + ' for ' + url));
      res.resume();
      return;
    }
    var parts = [];
    res.on('data', function (c) { parts.push(c); });
    res.on('end', function () {
      var buf = Buffer.concat(parts);
      callback(null, binary ? new Uint8Array(buf) : buf.toString('utf8'));
    });
  }).on('error', callback);
}

function fetchArrayBuffer(url, callback) {
  getResponse(url, true, callback);
}

function fetchJson(url, callback) {
  getResponse(url, false, function (err, text) {
    if (err) {
      callback(err);
      return;
    }
    try {
      callback(null, JSON.parse(text));
    } catch (e) {
      callback(e);
    }
  });
}

module.exports = {
  TILE_SIZE: TILE_SIZE,
  SCREENS: SCREENS,
  RADAR_ARENA_BYTES: RADAR_ARENA_BYTES,
  radarArenaFor: radarArenaFor,
  screenFor: screenFor,
  latLonToWorldPixel: latLonToWorldPixel,
  tilesForViewport: tilesForViewport,
  viewportFor: viewportFor,
  worldPixelDistanceAtZoom: worldPixelDistanceAtZoom,
  fetchViewport: fetchViewport,
  stitchAndCrop: stitchAndCrop,
  clearCorners: clearCorners,
  packTo1bpp: packTo1bpp,
  packIndices: packIndices,
  fetchArrayBuffer: fetchArrayBuffer,
  fetchJson: fetchJson
};
