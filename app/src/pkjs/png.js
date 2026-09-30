var pako = require('pako');

function paeth(a, b, c) {
  var p = a + b - c;
  var pa = Math.abs(p - a);
  var pb = Math.abs(p - b);
  var pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodeGray2Png(bytes) {
  var data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  var pngMagic = [137, 80, 78, 71, 13, 10, 26, 10];
  for (var i = 0; i < 8; i++) {
    if (data[i] !== pngMagic[i]) throw new Error('not a PNG');
  }
  var pos = 8;
  var width = 0;
  var height = 0;
  var bitDepth = 0;
  var colorType = 0;
  var idatParts = [];
  while (pos + 8 <= data.length) {
    var length = (data[pos] << 24) | (data[pos + 1] << 16) |
      (data[pos + 2] << 8) | data[pos + 3];
    var type = String.fromCharCode(data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7]);
    var chunk = data.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = (chunk[0] << 24) | (chunk[1] << 16) | (chunk[2] << 8) | chunk[3];
      height = (chunk[4] << 24) | (chunk[5] << 16) | (chunk[6] << 8) | chunk[7];
      bitDepth = chunk[8];
      colorType = chunk[9];
    } else if (type === 'IDAT') {
      idatParts.push(chunk);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + length;
  }
  if (colorType !== 0 || bitDepth !== 2) {
    throw new Error('expected 2-bit grayscale PNG, got depth=' + bitDepth + ' type=' + colorType);
  }
  var total = 0;
  for (var k = 0; k < idatParts.length; k++) total += idatParts[k].length;
  var idat = new Uint8Array(total);
  var off = 0;
  for (var m = 0; m < idatParts.length; m++) {
    idat.set(idatParts[m], off);
    off += idatParts[m].length;
  }
  var raw = pako.inflate(idat);
  var rowBytes = Math.ceil(width * 2 / 8);
  var pixels = new Uint8Array(width * height);
  var prev = new Uint8Array(rowBytes);
  var p = 0;
  for (var y = 0; y < height; y++) {
    var filter = raw[p++];
    var cur = raw.subarray(p, p + rowBytes);
    p += rowBytes;
    var recon = new Uint8Array(rowBytes);
    for (var x = 0; x < rowBytes; x++) {
      var a = x > 0 ? recon[x - 1] : 0;
      var b = prev[x];
      var c = x > 0 ? prev[x - 1] : 0;
      var f = cur[x];
      if (filter === 1) recon[x] = (f + a) & 0xff;
      else if (filter === 2) recon[x] = (f + b) & 0xff;
      else if (filter === 3) recon[x] = (f + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) recon[x] = (f + paeth(a, b, c)) & 0xff;
      else recon[x] = f;
    }
    for (var px = 0; px < width; px++) {
      var byte = recon[px >> 2];
      var shift = 6 - 2 * (px & 3);
      pixels[y * width + px] = (byte >> shift) & 3;
    }
    prev = recon;
  }
  return { width: width, height: height, pixels: pixels };
}

module.exports = {
  decodeGray2Png: decodeGray2Png
};
