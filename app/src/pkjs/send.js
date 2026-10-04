var CHUNK_SIZE = 1500;

function sendChunk(packet, index, uncompressedLength, keys, chunkSize, onDone, onFail) {
  if (index >= packet.length) {
    var done = {};
    done[keys.done] = uncompressedLength;
    Pebble.sendAppMessage(done, onDone, onFail);
    return;
  }
  var size = Math.min(chunkSize, packet.length - index);
  var dict = {};
  dict[keys.chunk] = Array.prototype.slice.call(packet, index, index + size);
  dict[keys.index] = index;
  Pebble.sendAppMessage(dict, function () {
    sendChunk(packet, index + size, uncompressedLength, keys, chunkSize, onDone, onFail);
  }, onFail);
}

function sendBlob(packet, uncompressedLength, keys, onDone, onFail, chunkSize) {
  var start = {};
  start[keys.length] = packet.length;
  Pebble.sendAppMessage(start, function () {
    sendChunk(packet, 0, uncompressedLength, keys, chunkSize || CHUNK_SIZE, onDone, onFail);
  }, onFail);
}

var MAP_KEYS = { length: 'MapLength', chunk: 'MapChunk', index: 'MapIndex', done: 'MapDone' };
var RADAR_KEYS = { length: 'RadarLength', chunk: 'RadarChunk', index: 'RadarIndex', done: 'RadarDone' };

function sendMap(packet, uncompressedLength, onDone, onFail, chunkSize) {
  sendBlob(packet, uncompressedLength, MAP_KEYS, onDone, onFail, chunkSize);
}

function sendRadar(packet, uncompressedLength, onDone, onFail, chunkSize) {
  sendBlob(packet, uncompressedLength, RADAR_KEYS, onDone, onFail, chunkSize);
}

module.exports = {
  CHUNK_SIZE: CHUNK_SIZE,
  MAP_KEYS: MAP_KEYS,
  RADAR_KEYS: RADAR_KEYS,
  sendBlob: sendBlob,
  sendMap: sendMap,
  sendRadar: sendRadar
};
