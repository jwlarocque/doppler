var lz4js = require('lz4js');

var HASH_SIZE = 1 << 16;

function compressBound(length) {
  return lz4js.compressBound(length);
}

// if compressor found no matches, send all-literals
function literalsOnly(data, dst) {
  var dIndex = 0;
  if (data.length < 15) {
    dst[dIndex++] = data.length << 4;
  } else {
    dst[dIndex++] = 0xf0;
    var remaining = data.length - 15;
    while (remaining >= 0xff) {
      dst[dIndex++] = 0xff;
      remaining -= 0xff;
    }
    dst[dIndex++] = remaining;
  }
  dst.set(data, dIndex);
  return dIndex + data.length;
}

function compress(raw) {
  var data = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  var table = new Uint32Array(HASH_SIZE);
  var dst = new Uint8Array(compressBound(data.length));
  var size = lz4js.compressBlock(data, dst, 0, data.length, table);
  if (size === 0) size = literalsOnly(data, dst);
  return dst.slice(0, size);
}

function decompress(block, uncompressedLength) {
  var data = block instanceof Uint8Array ? block : new Uint8Array(block);
  var dst = new Uint8Array(uncompressedLength);
  var size = lz4js.decompressBlock(data, dst, 0, data.length, 0);
  if (size !== uncompressedLength) {
    throw new Error('lz4 length mismatch: got ' + size + ', want ' + uncompressedLength);
  }
  return dst;
}

module.exports = {
  compressBound: compressBound,
  compress: compress,
  decompress: decompress
};
