var map = require('./map.js');

function currentFix(useChicago, callback) {
  if (useChicago || typeof navigator === 'undefined' ||
      !navigator.geolocation) {
    callback(null, { lat: map.CHICAGO_LAT, lon: map.CHICAGO_LON, test: true });
    return;
  }
  navigator.geolocation.getCurrentPosition(
    function (pos) {
      callback(null, { lat: pos.coords.latitude, lon: pos.coords.longitude, test: false });
    },
    function (err) {
      console.log('geolocation failed (' + err.message + '), using Chicago test fix');
      callback(null, { lat: map.CHICAGO_LAT, lon: map.CHICAGO_LON, test: true });
    },
    { timeout: 10000, maximumAge: 600000 }
  );
}

Pebble.addEventListener('ready', function () {
  console.log('doppler pkjs ready');
  var screen = map.screenFor('flint');
  if (typeof Pebble.getActiveWatchInfo === 'function') {
    try {
      var info = Pebble.getActiveWatchInfo();
      if (info && info.platform) screen = map.screenFor(info.platform);
      console.log('watch platform: ' + (info && info.platform));
    } catch (e) {
      console.log('getActiveWatchInfo failed, using flint: ' + e.message);
    }
  } else {
    console.log('getActiveWatchInfo unavailable, using flint test screen');
  }
  currentFix(map.USE_CHICAGO, function (err, fix) {
    function fetcher(z, x, y, cb) {
      map.fetchArrayBuffer(map.tileUrl(z, x, y), cb);
    }
    map.buildMapImage(fetcher, fix.lat, fix.lon, map.ZOOM, screen.w, screen.h,
      function (buildErr, res) {
        if (buildErr) {
          console.log('map build failed: ' + buildErr.message);
          return;
        }
        console.log('map ' + res.width + 'x' + res.height +
          ' tiles=' + res.tiles +
          ' bytes=' + res.packed.length +
          (fix.test ? ' (test fix)' : ''));
      });
  });
});
