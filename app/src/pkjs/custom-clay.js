module.exports = function () {
  var clayConfig = this;

  clayConfig.on(clayConfig.EVENTS.AFTER_BUILD, function () {
    var mode = clayConfig.getItemByMessageKey('Location');
    var lat = clayConfig.getItemByMessageKey('CustomLat');
    var lon = clayConfig.getItemByMessageKey('CustomLon');
    if (!mode || !lat || !lon) return;

    function syncVisibility() {
      if (mode.get() === 'custom') {
        lat.show();
        lon.show();
      } else {
        lat.hide();
        lon.hide();
      }
    }

    syncVisibility();
    mode.on('change', syncVisibility);
  });
};
