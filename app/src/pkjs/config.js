var settings = {
  zoom: 6,
  testLat: 16.7735,
  testLon: -3.0074,
  useTestFix: false,
  mapTileBase: 'http://192.168.1.24:8001',
  librewxrHost: 'https://api.librewxr.net'
};

try {
  // local overrides
  var local = require('./config.local.js');
  for (var key in local) settings[key] = local[key];
} catch (e) {
  // keep defaults
}

module.exports = settings;
