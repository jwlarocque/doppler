var CHUNK_SIZE = 1500;

function sendChunk(packet, index, uncompressedLength, keys, chunkSize, onDone, onFail, shouldAbort) {
  if (shouldAbort && shouldAbort()) return;
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
    sendChunk(packet, index + size, uncompressedLength, keys, chunkSize, onDone, onFail, shouldAbort);
  }, onFail);
}

function sendBlob(packet, uncompressedLength, keys, onDone, onFail, chunkSize, shouldAbort) {
  if (shouldAbort && shouldAbort()) return;
  var start = {};
  start[keys.length] = packet.length;
  Pebble.sendAppMessage(start, function () {
    sendChunk(packet, 0, uncompressedLength, keys, chunkSize || CHUNK_SIZE, onDone, onFail, shouldAbort);
  }, onFail);
}

// chunk stream without a trailing Done (multi-frame is terminated by RadarAck
// once received bytes == header length)
function sendChunks(packet, keys, chunkSize, onDone, onFail, shouldAbort) {
  function next(index) {
    if (shouldAbort && shouldAbort()) return;
    if (index >= packet.length) {
      onDone();
      return;
    }
    var size = Math.min(chunkSize, packet.length - index);
    var dict = {};
    dict[keys.chunk] = Array.prototype.slice.call(packet, index, index + size);
    dict[keys.index] = index;
    Pebble.sendAppMessage(dict, function () { next(index + size); }, onFail);
  }
  next(0);
}

var MAP_KEYS = { length: 'MapLength', chunk: 'MapChunk', index: 'MapIndex', done: 'MapDone' };
var RADAR_KEYS = {
  length: 'RadarLength',
  chunk: 'RadarChunk',
  index: 'RadarIndex',
  done: 'RadarDone',
  frame: 'RadarFrame',
  layout: 'RadarLayout',
  ack: 'RadarAck',
  full: 'RadarFull'
};

// layout ack slot from the watch (RADAR_ACK_LAYOUT in radar.h)
var LAYOUT_ACK = -1;

function sendMap(packet, uncompressedLength, onDone, onFail, chunkSize, shouldAbort) {
  sendBlob(packet, uncompressedLength, MAP_KEYS, onDone, onFail, chunkSize, shouldAbort);
}

function sendRadar(packet, uncompressedLength, onDone, onFail, chunkSize, shouldAbort) {
  sendBlob(packet, uncompressedLength, RADAR_KEYS, onDone, onFail, chunkSize, shouldAbort);
}

function sendRadarHeader(slot, packetLength, onDone, onFail) {
  var dict = {};
  dict[RADAR_KEYS.length] = packetLength;
  dict[RADAR_KEYS.frame] = slot;
  Pebble.sendAppMessage(dict, onDone, onFail);
}

function sendRadarChunks(packet, onDone, onFail, chunkSize, shouldAbort) {
  sendChunks(packet, RADAR_KEYS, chunkSize || CHUNK_SIZE, onDone, onFail, shouldAbort);
}

function sendRadarLayout(layoutBytes, onDone, onFail) {
  var dict = {};
  dict[RADAR_KEYS.layout] = layoutBytes;
  Pebble.sendAppMessage(dict, onDone, onFail);
}

function sendRadarDoneCount(count, onDone, onFail) {
  var dict = {};
  dict[RADAR_KEYS.done] = count;
  Pebble.sendAppMessage(dict, onDone, onFail);
}

var MARKER_KEYS = { x: 'MarkerX', y: 'MarkerY' };

function sendMarker(x, y, onDone, onFail) {
  var dict = {};
  dict[MARKER_KEYS.x] = x;
  dict[MARKER_KEYS.y] = y;
  Pebble.sendAppMessage(dict, onDone, onFail);
}

module.exports = {
  CHUNK_SIZE: CHUNK_SIZE,
  MAP_KEYS: MAP_KEYS,
  RADAR_KEYS: RADAR_KEYS,
  MARKER_KEYS: MARKER_KEYS,
  LAYOUT_ACK: LAYOUT_ACK,
  sendBlob: sendBlob,
  sendMap: sendMap,
  sendRadar: sendRadar,
  sendRadarHeader: sendRadarHeader,
  sendRadarChunks: sendRadarChunks,
  sendRadarLayout: sendRadarLayout,
  sendRadarDoneCount: sendRadarDoneCount,
  sendMarker: sendMarker
};
