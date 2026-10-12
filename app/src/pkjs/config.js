var settings = {
  testLat: 16.7735,
  testLon: -3.0074,
  useTestFix: false,
  mapTileHost: 'http://192.168.1.24:8001',
  mapStyle: 'simple',
  librewxrHost: 'https://api.librewxr.net'
};

function setMapStyle(style) {
  if (["simple", "dither"].indexOf(style) === -1) {
    return false;
  }
  if (settings.mapStyle === style) {
    return false;
  }
  settings.mapStyle = style;
  return true;
}

function mapTileBase() {
  return settings.mapTileHost.replace(/\/$/, '') + '/tiles_' + settings.mapStyle;
}

try {
  // local overrides
  var local = require('./config.local.js');
  for (var key in local) settings[key] = local[key];
} catch (e) {
  // keep defaults
}

module.exports = {
  settings: settings,
  setMapStyle: setMapStyle,
  mapTileBase: mapTileBase
};
