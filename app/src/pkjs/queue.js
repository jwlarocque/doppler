// multi-frame radar transmission state machine
// yeesh

var radar = require('./radar.js');

var LAYOUT_ACK = -1;

function createSession(meta, arenaBytes) {
  var priority = radar.priorityOrder(meta.past, meta.nowcast);
  return {
    priority: priority,
    arena: arenaBytes,
    kept: [],
    lens: {},
    packets: {},
    total: 0,
    stopped: null,
    layout: null,
    queue: [],
    waiting: null,
    acked: [],
    phase: 'fetch'
  };
}

// record a fetched and compressed frame
// returns true when kept, false on stop (overflow)
function noteFetched(session, entry, packetLength, packet) {
  if (session.stopped) return false;
  if (typeof packetLength !== 'number') return false;
  if (session.total + packetLength > session.arena) {
    session.stopped = 'greedy';
    return false;
  }
  session.kept.push({ kind: entry.kind, time: entry.time, path: entry.path });
  session.lens[entry.time] = packetLength;
  if (packet) session.packets[entry.time] = packet;
  session.total += packetLength;
  return true;
}

function finishFetch(session) {
  function sizeOf(e) { return session.lens[e.time]; }
  var layout = radar.layoutSlots(session.kept, sizeOf);
  session.layout = layout;
  var byTime = {};
  for (var i = 0; i < layout.slots.length; i++) byTime[layout.slots[i].time] = layout.slots[i].slot;
  var queue = [];
  for (var p = 0; p < session.priority.length; p++) {
    var entry = session.priority[p];
    if (entry.kind === 'live') continue;
    if (!(entry.time in session.lens)) continue;
    if (!(entry.time in byTime)) continue;
    queue.push({ slot: byTime[entry.time], time: entry.time, kind: entry.kind });
  }
  session.queue = queue;
  session.phase = 'layout';
  return layout;
}

function onLayoutAck(session) {
  session.phase = 'stream';
  if (!session.queue.length) {
    session.phase = 'done';
    return null;
  }
  session.waiting = session.queue[0];
  return session.waiting;
}

function onFrameAck(session, slot) {
  if (!session.waiting || session.waiting.slot !== slot) return session.waiting;
  session.acked.push(slot);
  session.queue.shift();
  if (!session.queue.length) {
    session.waiting = null;
    session.phase = 'done';
    return null;
  }
  session.waiting = session.queue[0];
  return session.waiting;
}

function onFull(session) {
  session.stopped = session.stopped || 'full';
  session.phase = 'done';
  session.waiting = null;
  return terminalCount(session);
}

function terminalCount(session) {
  return 1 + session.acked.length;
}

module.exports = {
  LAYOUT_ACK: LAYOUT_ACK,
  createSession: createSession,
  noteFetched: noteFetched,
  finishFetch: finishFetch,
  onLayoutAck: onLayoutAck,
  onFrameAck: onFrameAck,
  onFull: onFull,
  terminalCount: terminalCount
};
