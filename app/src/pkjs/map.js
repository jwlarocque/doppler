var tiles = require('./tiles.js');
var config = require('./config.js');
var png = require('./png.js');

function tileUrl(z, x, y, base) {
  return (base || config.mapTileBase) + '/' + z + '/' + x + '/' + y + '.png';
}

function decodeTile(bytes) {
  return { data: png.decodeGray2Png(bytes).pixels, bytesPerPixel: 1 };
}

function buildMapImage(fetcher, viewport, screen, callback) {
  tiles.fetchViewport(fetcher, viewport, decodeTile, function (err, res) {
    if (err) {
      callback(err);
      return;
    }
    var gray2 = res.stitched;
    if (screen.round) tiles.clearCorners(gray2, viewport.screenW, viewport.screenH);
    var packed = screen.bw
      ? tiles.packTo1bpp(gray2, viewport.screenW, viewport.screenH, 2)
      : tiles.packIndices(gray2, viewport.screenW, viewport.screenH, 2);
    callback(null, {
      packed: packed,
      gray2: gray2,
      width: viewport.screenW,
      height: viewport.screenH,
      tiles: res.tiles,
      center: res.center
    });
  });
}

module.exports = {
  tileUrl: tileUrl,
  buildMapImage: buildMapImage
};
