var tiles = require('./tiles.js');
var config = require('./config.js');
var map = require('./map.js');
var radar = require('./radar.js');
var lz4 = require('./lz4.js');
var send = require('./send.js');
var queue = require('./queue.js');

var activeSession = null;
var activeCtx = null;

function currentFix(callback) {
  if (config.useTestFix || typeof navigator === 'undefined' ||
      !navigator.geolocation) {
    callback(null, { lat: config.testLat, lon: config.testLon, test: true });
    return;
  }
  navigator.geolocation.getCurrentPosition(
    function (pos) {
      callback(null, { lat: pos.coords.latitude, lon: pos.coords.longitude, test: false });
    },
    function (err) {
      console.log('geolocation failed (' + err.message + '), using test fix');
      callback(null, { lat: config.testLat, lon: config.testLon, test: true });
    },
    { timeout: 10000, maximumAge: 600000 }
  );
}

function compressAndSend(kind, res, fix, screen, detail) {
  // map is sent uncompressed for now and stored in a dedicated buffer
  // radar is compressed and packed into the arena
  var compressed = kind !== 'map';
  var packet = compressed ? lz4.compress(res.packed) : res.packed;
  var ratio = (100 * packet.length / res.packed.length).toFixed(1);
  console.log(kind + ' ' + res.width + 'x' + res.height +
    ' tiles=' + res.tiles +
    (detail ? ' ' + detail : '') +
    ' raw=' + res.packed.length +
    ' tx=' + packet.length +
    (compressed ? ' (lz4-block, ' + ratio + '%)' : ' (uncompressed)') +
    (fix.test ? ' (test fix)' : ''));
  var sender = kind === 'radar' ? send.sendRadar : send.sendMap;
  sender(packet, res.packed.length,
    function () { console.log(kind + ' sent'); },
    function () { console.log(kind + ' send failed'); },
    screen.chunk);
  return packet;
}

function sendMapForFix(fix, screen, viewport) {
  function fetcher(z, x, y, cb) {
    tiles.fetchArrayBuffer(map.tileUrl(z, x, y), cb);
  }
  map.buildMapImage(fetcher, viewport, screen, function (buildErr, res) {
    if (buildErr) {
      console.log('map build failed: ' + buildErr.message);
      return;
    }
    compressAndSend('map', res, fix, screen);
  });
}

function buildOneFrame(host, entry, viewport, screen, callback) {
  function fetcher(z, x, y, cb) {
    tiles.fetchArrayBuffer(radar.tileUrl(host, entry.path, z, x, y), cb);
  }
  radar.buildRadarImage(fetcher, viewport, screen, entry, callback);
}

function sendTerminal(session) {
  var count = queue.terminalCount(session);
  console.log('radar session terminal, count=' + count);
  send.sendRadarDoneCount(count,
    function () { console.log('radar done sent'); },
    function () { console.log('radar done send failed'); });
  if (activeSession === session) {
    activeSession = null;
    activeCtx = null;
  }
}

function streamEntry(session, ctx, entry) {
  var packet = session.packets[entry.time];
  if (!packet) {
    console.log('radar missing packet for slot ' + entry.slot);
    sendTerminal(session);
    return;
  }
  console.log('radar stream slot=' + entry.slot + ' tx=' + packet.length);
  send.sendRadarHeader(entry.slot, packet.length, function () {
    send.sendRadarChunks(packet, function () {
      console.log('radar slot ' + entry.slot + ' delivered, waiting for ack');
    }, function () {
      console.log('radar slot ' + entry.slot + ' chunk send failed');
      sendTerminal(session);
    }, ctx.screen.chunk);
  }, function () {
    console.log('radar slot ' + entry.slot + ' header send failed');
    sendTerminal(session);
  });
}

function sendLayoutAndWait(session, ctx) {
  if (!session.kept.length) {
    console.log('radar live exceeds arena, no layout sent');
    activeSession = null;
    activeCtx = null;
    return;
  }
  var layout = queue.finishFetch(session);
  var bytes = radar.encodeLayout(layout);
  console.log('radar layout n=' + layout.count + ' live=' + layout.liveSlot +
    ' bytes=' + layout.totalBytes);
  send.sendRadarLayout(bytes,
    function () { console.log('radar layout delivered, waiting for ack'); },
    function () { console.log('radar layout send failed'); });
}

function fillAfterLive(session, ctx, startIndex) {
  var idx = startIndex;
  function next() {
    if (idx >= session.priority.length) {
      sendLayoutAndWait(session, ctx);
      return;
    }
    var entry = session.priority[idx++];
    buildOneFrame(ctx.host, entry, ctx.viewport, ctx.screen,
      function (buildErr, res) {
        if (buildErr) {
          console.log('radar build failed, stopping fill: ' + buildErr.message);
          sendLayoutAndWait(session, ctx);
          return;
        }
        var packet = lz4.compress(res.packed);
        if (!queue.noteFetched(session, entry, packet.length, packet)) {
          console.log('radar greedy-stop at ' + entry.kind + ' t=' + entry.time +
            ' tx=' + packet.length);
          sendLayoutAndWait(session, ctx);
          return;
        }
        console.log('radar kept ' + entry.kind + ' t=' + entry.time +
          ' tx=' + packet.length);
        next();
      });
  }
  next();
}

function sendRadarForFix(fix, screen, platform, viewport, hostOverride) {
  radar.fetchMeta(hostOverride, function (metaErr, meta) {
    if (metaErr) {
      console.log('radar meta failed: ' + metaErr.message);
      return;
    }
    var live = { kind: 'live', time: meta.time, path: meta.path };
    buildOneFrame(meta.host, live, viewport, screen,
      function (buildErr, res) {
        if (buildErr) {
          console.log('radar build failed: ' + buildErr.message);
          return;
        }
        // send live frame for immediate display
        var packet = compressAndSend('radar', res, fix, screen, 'frame=' + live.time);
        var arena = tiles.radarArenaFor(platform);
        var session = queue.createSession(meta, arena);
        activeSession = session;
        activeCtx = { screen: screen, viewport: viewport, fix: fix, host: meta.host, meta: meta };
        if (!queue.noteFetched(session, live, packet.length, packet)) {
          console.log('radar live exceeds arena, aborting fill');
          activeSession = null;
          activeCtx = null;
          return;
        }
        console.log('radar fill start, candidates=' + session.priority.length +
          ' arena=' + arena);
        fillAfterLive(session, activeCtx, 1);
      });
  });
}

Pebble.addEventListener('appmessage', function (e) {
  var payload = (e && e.payload) || {};
  if (!activeSession) return;
  if (payload.RadarFull !== undefined && payload.RadarFull !== null) {
    console.log('radar full from watch, slot=' + payload.RadarFull);
    var fullCount = queue.onFull(activeSession);
    var session = activeSession;
    void fullCount;
    sendTerminal(session);
    return;
  }
  if (payload.RadarAck !== undefined && payload.RadarAck !== null) {
    var ack = payload.RadarAck;
    if (ack === queue.LAYOUT_ACK) {
      console.log('radar layout acked');
      var first = queue.onLayoutAck(activeSession);
      if (!first) {
        sendTerminal(activeSession);
      } else {
        streamEntry(activeSession, activeCtx, first);
      }
      return;
    }
    var next = queue.onFrameAck(activeSession, ack);
    console.log('radar ack slot=' + ack);
    if (!next) {
      sendTerminal(activeSession);
    } else {
      streamEntry(activeSession, activeCtx, next);
    }
  }
});

Pebble.addEventListener('ready', function () {
  console.log('doppler pkjs ready');
  var platform = 'aplite';
  var screen = tiles.screenFor(platform);
  if (typeof Pebble.getActiveWatchInfo === 'function') {
    try {
      var info = Pebble.getActiveWatchInfo();
      if (info && info.platform) {
        platform = info.platform;
        screen = tiles.screenFor(info.platform);
      }
      console.log('watch platform: ' + (info && info.platform));
    } catch (e) {
      console.log('getActiveWatchInfo failed, using aplite: ' + e.message);
    }
  } else {
    console.log('getActiveWatchInfo unavailable, using aplite test screen');
  }
  currentFix(function (err, fix) {
    var viewport = tiles.viewportFor(fix.lat, fix.lon, config.zoom, screen);
    sendMapForFix(fix, screen, viewport);
    sendRadarForFix(fix, screen, platform, viewport);
  });
});
