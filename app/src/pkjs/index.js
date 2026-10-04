var tiles = require('./tiles.js');
var config = require('./config.js');
var map = require('./map.js');
var radar = require('./radar.js');
var lz4 = require('./lz4.js');
var send = require('./send.js');

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
  var packet = lz4.compress(res.packed);
  var ratio = (100 * packet.length / res.packed.length).toFixed(1);
  console.log(kind + ' ' + res.width + 'x' + res.height +
    ' tiles=' + res.tiles +
    (detail ? ' ' + detail : '') +
    ' raw=' + res.packed.length +
    ' tx=' + packet.length + ' (lz4-block, ' + ratio + '%)' +
    (fix.test ? ' (test fix)' : ''));
  var sender = kind === 'radar' ? send.sendRadar : send.sendMap;
  sender(packet, res.packed.length,
    function () { console.log(kind + ' sent'); },
    function () { console.log(kind + ' send failed'); },
    screen.chunk);
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

function sendRadarForFix(fix, screen, viewport, hostOverride) {
  radar.fetchMeta(hostOverride, function (metaErr, frame) {
    if (metaErr) {
      console.log('radar meta failed: ' + metaErr.message);
      return;
    }
    function fetcher(z, x, y, cb) {
      tiles.fetchArrayBuffer(radar.tileUrl(frame.host, frame.path, z, x, y), cb);
    }
    radar.buildRadarImage(fetcher, viewport, screen, frame,
      function (buildErr, res) {
        if (buildErr) {
          console.log('radar build failed: ' + buildErr.message);
          return;
        }
        compressAndSend('radar', res, fix, screen, 'frame=' + frame.time);
      });
  });
}

Pebble.addEventListener('ready', function () {
  console.log('doppler pkjs ready');
  var screen = tiles.screenFor('flint');
  if (typeof Pebble.getActiveWatchInfo === 'function') {
    try {
      var info = Pebble.getActiveWatchInfo();
      if (info && info.platform) screen = tiles.screenFor(info.platform);
      console.log('watch platform: ' + (info && info.platform));
    } catch (e) {
      console.log('getActiveWatchInfo failed, using flint: ' + e.message);
    }
  } else {
    console.log('getActiveWatchInfo unavailable, using flint test screen');
  }
  currentFix(function (err, fix) {
    var viewport = tiles.viewportFor(fix.lat, fix.lon, config.zoom, screen);
    sendMapForFix(fix, screen, viewport);
    sendRadarForFix(fix, screen, viewport);
  });
});
