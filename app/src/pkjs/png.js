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

function checkMagic(data) {
  var pngMagic = [137, 80, 78, 71, 13, 10, 26, 10];
  for (var i = 0; i < 8; i++) {
    if (data[i] !== pngMagic[i]) throw new Error('not a PNG');
  }
}

function readChunks(data) {
  var pos = 8;
  var width = 0;
  var height = 0;
  var bitDepth = 0;
  var colorType = 0;
  var idatParts = [];
  var plte = null;
  var trns = null;
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
    } else if (type === 'PLTE') {
      plte = chunk;
    } else if (type === 'tRNS') {
      trns = chunk;
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + length;
  }
  return {
    width: width,
    height: height,
    bitDepth: bitDepth,
    colorType: colorType,
    idatParts: idatParts,
    plte: plte,
    trns: trns
  };
}

function inflateIdat(idatParts) {
  var total = 0;
  for (var k = 0; k < idatParts.length; k++) total += idatParts[k].length;
  var idat = new Uint8Array(total);
  var off = 0;
  for (var m = 0; m < idatParts.length; m++) {
    idat.set(idatParts[m], off);
    off += idatParts[m].length;
  }
  return pako.inflate(idat);
}

// undo per-row PNG filtering
// returns an array of reconstructed row buffers
function unfilterRows(raw, height, rowBytes, bytesPerUnit) {
  var rows = [];
  var prev = new Uint8Array(rowBytes);
  var p = 0;
  for (var y = 0; y < height; y++) {
    var filter = raw[p++];
    var cur = raw.subarray(p, p + rowBytes);
    p += rowBytes;
    var recon = new Uint8Array(rowBytes);
    for (var x = 0; x < rowBytes; x++) {
      var a = x >= bytesPerUnit ? recon[x - bytesPerUnit] : 0;
      var b = prev[x];
      var c = x >= bytesPerUnit ? prev[x - bytesPerUnit] : 0;
      var f = cur[x];
      if (filter === 1) recon[x] = (f + a) & 0xff;
      else if (filter === 2) recon[x] = (f + b) & 0xff;
      else if (filter === 3) recon[x] = (f + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) recon[x] = (f + paeth(a, b, c)) & 0xff;
      else recon[x] = f;
    }
    rows.push(recon);
    prev = recon;
  }
  return rows;
}

// expand unfiltered paletted rows to RGBA
function expandPaletted(rows, width, height, bitDepth, plte, trns) {
  var entries = plte.length / 3;
  var rgba = new Uint8Array(width * height * 4);
  var pxPerByte = 8 / bitDepth;
  var mask = (1 << bitDepth) - 1;
  for (var y = 0; y < height; y++) {
    var recon = rows[y];
    for (var px = 0; px < width; px++) {
      var byte = recon[(px / pxPerByte) | 0];
      var shift = 8 - bitDepth * ((px % pxPerByte) + 1);
      var idx = (byte >> shift) & mask;
      var dst = (y * width + px) * 4;
      if (idx >= entries) idx = entries - 1;
      rgba[dst] = plte[idx * 3];
      rgba[dst + 1] = plte[idx * 3 + 1];
      rgba[dst + 2] = plte[idx * 3 + 2];
      rgba[dst + 3] = idx < trns.length ? trns[idx] : 255;
    }
  }
  return { width: width, height: height, rgba: rgba };
}

function decodeGray2Png(bytes) {
  var data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  checkMagic(data);
  var hdr = readChunks(data);
  if (hdr.colorType !== 0 || hdr.bitDepth !== 2) {
    throw new Error('expected 2-bit grayscale PNG, got depth=' + hdr.bitDepth + ' type=' + hdr.colorType);
  }
  var rowBytes = Math.ceil(hdr.width * 2 / 8);
  var rows = unfilterRows(inflateIdat(hdr.idatParts), hdr.height, rowBytes, 1);
  var pixels = new Uint8Array(hdr.width * hdr.height);
  for (var y = 0; y < hdr.height; y++) {
    var recon = rows[y];
    for (var px = 0; px < hdr.width; px++) {
      var byte = recon[px >> 2];
      var shift = 6 - 2 * (px & 3);
      pixels[y * hdr.width + px] = (byte >> shift) & 3;
    }
  }
  return { width: hdr.width, height: hdr.height, pixels: pixels };
}

// decode 8-bit RGB/RGBA (and 8-bit gray, expanded) PNGs to flat RGBA
// returns { width, height, rgba } with rgba a Uint8Array of w * h * 4
function decodeRgbaPng(bytes) {
  var data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  checkMagic(data);
  var hdr = readChunks(data);
  var channels;
  if (hdr.colorType === 6) channels = 4;
  else if (hdr.colorType === 2) channels = 3;
  else if (hdr.colorType === 0) channels = 1;
  else if (hdr.colorType === 3) channels = 0; // paletted, handled below
  else throw new Error('unsupported PNG color type ' + hdr.colorType);
  if (hdr.colorType === 3) {
    // LibreWXR scheme 0 (grayscale) tiles are paletted for some reason
    if (hdr.bitDepth !== 1 && hdr.bitDepth !== 2 && hdr.bitDepth !== 4 && hdr.bitDepth !== 8) {
      throw new Error('expected 1/2/4/8-bit paletted PNG, got depth=' + hdr.bitDepth);
    }
    if (!hdr.plte || hdr.plte.length % 3 !== 0) {
      throw new Error('paletted PNG missing PLTE');
    }
    var rowBytes = Math.ceil(hdr.width * hdr.bitDepth / 8);
    var rows = unfilterRows(inflateIdat(hdr.idatParts), hdr.height, rowBytes, 1);
    return expandPaletted(rows, hdr.width, hdr.height, hdr.bitDepth,
      hdr.plte, hdr.trns || new Uint8Array(0));
  }
  if (hdr.bitDepth !== 8) {
    throw new Error('expected 8-bit PNG, got depth=' + hdr.bitDepth + ' type=' + hdr.colorType);
  }
  var raw = inflateIdat(hdr.idatParts);
  var fullRowBytes = hdr.width * channels;
  var fullRows = unfilterRows(raw, hdr.height, fullRowBytes, channels);
  var rgba = new Uint8Array(hdr.width * hdr.height * 4);
  for (var y = 0; y < hdr.height; y++) {
    var recon = fullRows[y];
    for (var px = 0; px < hdr.width; px++) {
      var dst = (y * hdr.width + px) * 4;
      if (channels === 4) {
        rgba[dst] = recon[px * 4];
        rgba[dst + 1] = recon[px * 4 + 1];
        rgba[dst + 2] = recon[px * 4 + 2];
        rgba[dst + 3] = recon[px * 4 + 3];
      } else if (channels === 3) {
        rgba[dst] = recon[px * 3];
        rgba[dst + 1] = recon[px * 3 + 1];
        rgba[dst + 2] = recon[px * 3 + 2];
        rgba[dst + 3] = 255;
      } else {
        rgba[dst] = recon[px];
        rgba[dst + 1] = recon[px];
        rgba[dst + 2] = recon[px];
        rgba[dst + 3] = 255;
      }
    }
  }
  return { width: hdr.width, height: hdr.height, rgba: rgba };
}

module.exports = {
  decodeGray2Png: decodeGray2Png,
  decodeRgbaPng: decodeRgbaPng
};
