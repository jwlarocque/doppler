var png = require('./png.js');

var TILE_SIZE = 256;
var ZOOM = 7;
var TILE_URL = 'http://localhost:8001';
var CHICAGO_LAT = 41.8818;
var CHICAGO_LON = -87.6231;
var USE_CHICAGO = true;

var SCREENS = {
  aplite: { w: 144, h: 168, bw: true },
  basalt: { w: 144, h: 168, bw: false },
  chalk: { w: 180, h: 180, bw: false },
  diorite: { w: 144, h: 168, bw: true },
  flint: { w: 144, h: 168, bw: true },
  emery: { w: 200, h: 228, bw: false },
  gabbro: { w: 260, h: 260, bw: false }
};

function screenFor(platform) {
  if (SCREENS[platform]) return SCREENS[platform];
  return SCREENS.flint;
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

function stitchAndCrop(decoded, tileX0, tileY0, offsetX, offsetY, screenW, screenH) {
  var out = new Uint8Array(screenW * screenH);
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
      out[y * screenW + x] = tile.pixels[ly * TILE_SIZE + lx];
    }
  }
  return out;
}

// Pack 2bpp grays to 1bpp rows matching GBitmapFormat1Bit:
// byte = x/8, bit = x%8
function crushTo1bpp(gray2, screenW, screenH) {
  var stride = Math.ceil(screenW / 8);
  var out = new Uint8Array(stride * screenH);
  for (var y = 0; y < screenH; y++) {
    for (var x = 0; x < screenW; x++) {
      if (gray2[y * screenW + x] >= 2) {
        out[y * stride + (x >> 3)] |= (1 << (x & 7));
      }
    }
  }
  return out;
}

function fetchArrayBuffer(url, callback) {
  if (typeof XMLHttpRequest !== 'undefined') {
    var req = new XMLHttpRequest();
    req.open('GET', url, true);
    req.responseType = 'arraybuffer';
    req.onload = function () {
      if (req.status === 200) callback(null, new Uint8Array(req.response));
      else callback(new Error('HTTP ' + req.status + ' for ' + url));
    };
    req.onerror = function () { callback(new Error('network error for ' + url)); };
    req.send();
    return;
  }
  var http = require('http');
  http.get(url, function (res) {
    if (res.statusCode !== 200) {
      callback(new Error('HTTP ' + res.statusCode + ' for ' + url));
      res.resume();
      return;
    }
    var parts = [];
    res.on('data', function (c) { parts.push(c); });
    res.on('end', function () { callback(null, new Uint8Array(Buffer.concat(parts))); });
  }).on('error', callback);
}

function tileUrl(z, x, y) {
  return TILE_URL + '/' + z + '/' + x + '/' + y + '.png';
}

function buildMapImage(fetcher, lat, lon, zoom, screenW, screenH, callback) {
  var center = latLonToWorldPixel(lat, lon, zoom);
  var view = tilesForViewport(center.x, center.y, screenW, screenH);
  var tileX0 = Math.floor(view.left / TILE_SIZE);
  var tileY0 = Math.floor(view.top / TILE_SIZE);
  var pending = view.tiles.length;
  var decoded = {};
  var failed = null;
  view.tiles.forEach(function (t) {
    fetcher(zoom, t.x, t.y, function (err, bytes) {
      if (!err) {
        try {
          decoded[t.x + '/' + t.y] = png.decodeGray2Png(bytes);
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
        var gray2 = stitchAndCrop(decoded, tileX0, tileY0, view.offsetX, view.offsetY,
          screenW, screenH);
        var packed = crushTo1bpp(gray2, screenW, screenH);
        callback(null, {
          packed: packed,
          gray2: gray2,
          width: screenW,
          height: screenH,
          tiles: view.tiles.length,
          center: center
        });
      }
    });
  });
}

module.exports = {
  TILE_SIZE: TILE_SIZE,
  ZOOM: ZOOM,
  TILE_URL: TILE_URL,
  CHICAGO_LAT: CHICAGO_LAT,
  CHICAGO_LON: CHICAGO_LON,
  USE_CHICAGO: USE_CHICAGO,
  screenFor: screenFor,
  latLonToWorldPixel: latLonToWorldPixel,
  tilesForViewport: tilesForViewport,
  stitchAndCrop: stitchAndCrop,
  crushTo1bpp: crushTo1bpp,
  fetchArrayBuffer: fetchArrayBuffer,
  tileUrl: tileUrl,
  buildMapImage: buildMapImage
};
