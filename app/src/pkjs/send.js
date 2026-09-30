var CHUNK_SIZE = 1500;

function sendChunk(packet, index, uncompressedLength, chunkSize, onDone, onFail) {
  if (index >= packet.length) {
    Pebble.sendAppMessage({ MapDone: uncompressedLength }, onDone, onFail);
    return;
  }
  var size = Math.min(chunkSize, packet.length - index);
  var dict = {
    MapChunk: Array.prototype.slice.call(packet, index, index + size),
    MapIndex: index
  };
  Pebble.sendAppMessage(dict, function () {
    sendChunk(packet, index + size, uncompressedLength, chunkSize, onDone, onFail);
  }, onFail);
}

function sendMap(packet, uncompressedLength, onDone, onFail, chunkSize) {
  Pebble.sendAppMessage({ MapLength: packet.length }, function () {
    sendChunk(packet, 0, uncompressedLength, chunkSize || CHUNK_SIZE, onDone, onFail);
  }, onFail);
}

module.exports = {
  CHUNK_SIZE: CHUNK_SIZE,
  sendMap: sendMap
};
