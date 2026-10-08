var tiles = require('./tiles.js');
var config = require('./config.js');
var map = require('./map.js');
var radar = require('./radar.js');
var lz4 = require('./lz4.js');
var send = require('./send.js');
var queue = require('./queue.js');
var tilecache = require('./tilecache.js');

// must match doppler.c (ZOOM_MIN/MAX/DEFAULT)
var ZOOM_MIN = 3;
var ZOOM_MAX = 7;
var ZOOM_DEFAULT = 6;

var activeSession = null;
var activeCtx = null;

// last known location/screen (reused on zoom change)
var lastFix = null;
var lastScreen = null;
var lastPlatform = 'aplite';
var currentZoom = ZOOM_DEFAULT;

// last radar metadata (baseline for refreshes)
var lastMeta = null;
var pollTimer = null;
var POLL_MS = 5 * 60 * 1000;

// location re-centering is triggered by distance in pixels exceeding this
// fraction of screen width at this zoom
var LOCATION_CHECK_ZOOM = 7;
var LOCATION_FRACTION = 0.2;

// tracks data stalesness so it can be dropped (after zoom change)
var generation = 0;
function alive(gen) {
  return gen === generation;
}
function abortIfStale(gen) {
  return function () { return gen !== generation; };
}

// map and past tiles are not expected to change, so are retained
var mapCache = new tilecache.TileCache(tilecache.MAX_ENTRIES);
var pastCache = new tilecache.TileCache(tilecache.MAX_ENTRIES);
// nowcast cache is cleared on refresh
var nowcastCache = new tilecache.TileCache(tilecache.MAX_ENTRIES);
function cachedTileFetcher(cache, urlFor) {
  return function (z, x, y, cb) {
    var url = urlFor(z, x, y);
    tilecache.cachedFetch(cache, tiles.fetchArrayBuffer, url, cb);
  };
}

function currentFix(callback, allowFallback) {
  var fallback = allowFallback !== false;
  if (config.useTestFix || typeof navigator === 'undefined' ||
      !navigator.geolocation) {
    if (fallback) {
      callback(null, { lat: config.testLat, lon: config.testLon, test: true });
    } else {
      callback(new Error('no geolocation'));
    }
    return;
  }
  navigator.geolocation.getCurrentPosition(
    function (pos) {
      callback(null, { lat: pos.coords.latitude, lon: pos.coords.longitude, test: false });
    },
    function (err) {
      if (fallback) {
        console.log('geolocation failed (' + err.message + '), using test fix');
        callback(null, { lat: config.testLat, lon: config.testLon, test: true });
      } else {
        callback(new Error('geolocation failed (' + err.message + ')'));
      }
    },
    { timeout: 10000, maximumAge: fallback ? 600000 : 60000 }
  );
}

function needsRelocation(oldFix, newFix, screen) {
  if (!oldFix || !newFix || !screen) return false;
  var distance = tiles.worldPixelDistanceAtZoom(
    oldFix.lat, oldFix.lon, newFix.lat, newFix.lon, LOCATION_CHECK_ZOOM);
  return distance > LOCATION_FRACTION * screen.w;
}

function compressAndSend(kind, res, fix, screen, detail, gen, onSettled) {
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
  function settled() {
    if (onSettled) onSettled();
  }
  sender(packet, res.packed.length,
    function () { console.log(kind + ' sent'); settled(); },
    function () { console.log(kind + ' send failed'); settled(); },
    screen.chunk, abortIfStale(gen));
  return packet;
}

function sendMapForFix(fix, screen, viewport, gen, next) {
  function urlFor(z, x, y) {
    return map.tileUrl(z, x, y);
  }
  map.buildMapImage(cachedTileFetcher(mapCache, urlFor), viewport, screen, function (buildErr, res) {
    if (!alive(gen)) return;
    if (buildErr) {
      console.log('map build failed: ' + buildErr.message);
      if (next) next();
      return;
    }
    compressAndSend('map', res, fix, screen, null, gen, next);
  });
}

function buildOneFrame(host, entry, viewport, screen, callback) {
  function urlFor(z, x, y) {
    return radar.tileUrl(host, entry.path, z, x, y);
  }
  var cache = entry.kind === 'nowcast' ? nowcastCache : pastCache;
  radar.buildRadarImage(cachedTileFetcher(cache, urlFor), viewport, screen, entry, callback);
}

function sendTerminal(session) {
  if (session !== activeSession) return;
  var count = queue.terminalCount(session);
  console.log('radar session terminal, count=' + count);
  send.sendRadarDoneCount(count,
    function () { console.log('radar done sent'); },
    function () { console.log('radar done send failed'); });
  activeSession = null;
  activeCtx = null;
}

function streamEntry(session, ctx, entry, gen) {
  var packet = session.packets[entry.time];
  if (!alive(gen)) return;
  if (!packet) {
    console.log('radar missing packet for slot ' + entry.slot);
    sendTerminal(session);
    return;
  }
  console.log('radar stream slot=' + entry.slot + ' tx=' + packet.length);
  send.sendRadarHeader(entry.slot, packet.length, function () {
    if (!alive(gen)) return;
    send.sendRadarChunks(packet, function () {
      console.log('radar slot ' + entry.slot + ' delivered, waiting for ack');
    }, function () {
      if (!alive(gen)) return;
      console.log('radar slot ' + entry.slot + ' chunk send failed');
      sendTerminal(session);
    }, ctx.screen.chunk, abortIfStale(gen));
  }, function () {
    if (!alive(gen)) return;
    console.log('radar slot ' + entry.slot + ' header send failed');
    sendTerminal(session);
  });
}

function sendLayoutAndWait(session, ctx, gen) {
  if (!alive(gen)) return;
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

function fillAfterLive(session, ctx, startIndex, gen, onFillDone) {
  var idx = startIndex;
  function next() {
    if (!alive(gen)) return;
    if (idx >= session.priority.length) {
      onFillDone();
      return;
    }
    var entry = session.priority[idx++];
    buildOneFrame(ctx.host, entry, ctx.viewport, ctx.screen,
      function (buildErr, res) {
        if (!alive(gen)) return;
        if (buildErr) {
          console.log('radar build failed, stopping fill: ' + buildErr.message);
          onFillDone();
          return;
        }
        var packet = lz4.compress(res.packed);
        if (!queue.noteFetched(session, entry, packet.length, packet)) {
          console.log('radar greedy-stop at ' + entry.kind + ' t=' + entry.time +
            ' tx=' + packet.length);
          onFillDone();
          return;
        }
        console.log('radar kept ' + entry.kind + ' t=' + entry.time +
          ' tx=' + packet.length);
        next();
      });
  }
  next();
}

function sendRadarForFix(fix, screen, platform, viewport, hostOverride, gen) {
  radar.fetchMeta(hostOverride, function (metaErr, meta) {
    if (!alive(gen)) return;
    if (metaErr) {
      console.log('radar meta failed: ' + metaErr.message);
      return;
    }
    lastMeta = meta;
    var live = { kind: 'live', time: meta.time, path: meta.path };
    // radar.c cannot accept layout data until the live frame is completely
    // sent and acked
    // when data is in the cache, immediately transmitting the layout could
    // result in it arriving before the live frame and be rejected
    var gate = { liveSettled: false, fillDone: false, session: null };
    function maybeSendLayout() {
      if (!alive(gen)) return;
      if (!gate.liveSettled || !gate.fillDone || !gate.session) return;
      if (activeSession !== gate.session) return;
      sendLayoutAndWait(gate.session, activeCtx, gen);
    }
    buildOneFrame(meta.host, live, viewport, screen,
      function (buildErr, res) {
        if (!alive(gen)) return;
        if (buildErr) {
          console.log('radar build failed: ' + buildErr.message);
          return;
        }
        // send live frame for immediate display
        var packet = compressAndSend('radar', res, fix, screen, 'frame=' + live.time, gen,
          function () {
            if (!alive(gen)) return;
            gate.liveSettled = true;
            maybeSendLayout();
          });
        var arena = tiles.radarArenaFor(platform);
        var session = queue.createSession(meta, arena);
        activeSession = session;
        activeCtx = { screen: screen, viewport: viewport, fix: fix, host: meta.host, meta: meta };
        gate.session = session;
        if (!queue.noteFetched(session, live, packet.length, packet)) {
          console.log('radar live exceeds arena, aborting fill');
          activeSession = null;
          activeCtx = null;
          return;
        }
        console.log('radar fill start, candidates=' + session.priority.length +
          ' arena=' + arena);
        fillAfterLive(session, activeCtx, 1, gen, function () {
          gate.fillDone = true;
          maybeSendLayout();
        });
      });
  });
}

function loadAndSend(gen) {
  if (!lastFix || !lastScreen) return;
  // capture variables in case they change before async transmissions complete
  var fix = lastFix;
  var screen = lastScreen;
  var platform = lastPlatform;
  var viewport = tiles.viewportFor(fix.lat, fix.lon, currentZoom, screen);
  // send map, then radar layout and frames sequentially, to avoid overflowing
  // watch inbox
  sendMapForFix(fix, screen, viewport, gen, function () {
    if (!alive(gen)) return;
    sendRadarForFix(fix, screen, platform, viewport, undefined, gen);
  });
}

// poll weather-maps.json for new radar data
// on change, clear nowcast cache and then re-run sendRadarForFix
function pollForUpdate() {
  if (!lastMeta || !lastFix || !lastScreen || activeSession) return;
  var gen = generation;
  var base = lastMeta;
  radar.fetchMeta(base.host, function (metaErr, meta) {
    if (!alive(gen) || activeSession || lastMeta !== base) return;
    if (metaErr) {
      console.log('refresh meta failed: ' + metaErr.message);
      return;
    }
    if (!radar.metaChanged(base, meta)) return;
    console.log('refresh triggered, reloading radar');
    nowcastCache.clear();
    generation++;
    var viewport = tiles.viewportFor(lastFix.lat, lastFix.lon, currentZoom, lastScreen);
    sendRadarForFix(lastFix, lastScreen, lastPlatform, viewport, base.host, generation);
  });
}

// poll location then radar data for updates
function pollForLocationOrUpdate() {
  if (!lastFix || !lastScreen) return;
  var gen = generation;
  currentFix(function (fixErr, fix) {
    if (!alive(gen)) return;
    if (!fixErr && needsRelocation(lastFix, fix, lastScreen)) {
      console.log('relocating for moved user');
      lastFix = fix;
      generation++;
      activeSession = null;
      activeCtx = null;
      loadAndSend(generation);
      return;
    }
    if (fixErr) console.log('location poll failed: ' + fixErr.message);
    pollForUpdate();
  }, false);
}

function isValidZoom(zoom) {
  return typeof zoom === 'number' && zoom >= ZOOM_MIN && zoom <= ZOOM_MAX;
}

if (typeof Pebble !== 'undefined') {
Pebble.addEventListener('appmessage', function (e) {
  var payload = (e && e.payload) || {};
  if (payload.ZoomLevel !== undefined && payload.ZoomLevel !== null) {
    var zoom = payload.ZoomLevel;
    if (!isValidZoom(zoom)) {
      console.log('ignoring bad zoom ' + zoom);
      return;
    }
    if (zoom === currentZoom && activeSession) return;
    console.log('zoom request ' + currentZoom + ' -> ' + zoom);
    currentZoom = zoom;
    generation++;
    activeSession = null;
    activeCtx = null;
    loadAndSend(generation);
    return;
  }
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
        streamEntry(activeSession, activeCtx, first, generation);
      }
      return;
    }
    var next = queue.onFrameAck(activeSession, ack);
    console.log('radar ack slot=' + ack);
    if (!next) {
      sendTerminal(activeSession);
    } else {
      streamEntry(activeSession, activeCtx, next, generation);
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
    lastFix = fix;
    lastScreen = screen;
    lastPlatform = platform;
    loadAndSend(generation);
    if (typeof setInterval !== 'undefined' && pollTimer === null) {
      pollTimer = setInterval(function () {
        try {
          pollForLocationOrUpdate();
        } catch (e) {
          console.log('refresh poll failed: ' + e.message);
        }
      }, POLL_MS);
      // do not hold a node test process open for the poll timer
      if (pollTimer && typeof pollTimer.unref === 'function') pollTimer.unref();
    }
  });
});
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ZOOM_MIN: ZOOM_MIN,
    ZOOM_MAX: ZOOM_MAX,
    ZOOM_DEFAULT: ZOOM_DEFAULT,
    POLL_MS: POLL_MS,
    LOCATION_CHECK_ZOOM: LOCATION_CHECK_ZOOM,
    LOCATION_FRACTION: LOCATION_FRACTION,
    isValidZoom: isValidZoom,
    needsRelocation: needsRelocation,
    __testonly_pollForUpdate: pollForUpdate,
    __testonly_pollForLocationOrUpdate: pollForLocationOrUpdate,
    __testonly_getState: function () {
      return { lastMeta: lastMeta, lastFix: lastFix, lastScreen: lastScreen };
    }
  };
}
