// LRU cache of raw tile data, keyed by tile URL
var MAX_ENTRIES = 1024;

function TileCache(limit) {
  this.limit = (typeof limit === 'number' && limit > 0) ? limit : MAX_ENTRIES;
  this.entries = {};
  this.order = [];
}

TileCache.prototype.get = function (url) {
  if (!Object.prototype.hasOwnProperty.call(this.entries, url)) return null;
  return this.entries[url];
};

TileCache.prototype.set = function (url, bytes) {
  if (Object.prototype.hasOwnProperty.call(this.entries, url)) return;
  this.entries[url] = bytes;
  this.order.push(url);
  while (this.order.length > this.limit) {
    var oldest = this.order.shift();
    delete this.entries[oldest];
  }
};

TileCache.prototype.size = function () {
  return this.order.length;
};

TileCache.prototype.clear = function () {
  this.entries = {};
  this.order = [];
};

// wrap a (url, callback) tile fetcher with cache lookup
function cachedFetch(cache, fetch, url, callback) {
  var hit = cache.get(url);
  if (hit) {
    callback(null, hit);
    return;
  }
  fetch(url, function (err, bytes) {
    if (!err) cache.set(url, bytes);
    callback(err, bytes);
  });
}

module.exports = {
  MAX_ENTRIES: MAX_ENTRIES,
  TileCache: TileCache,
  cachedFetch: cachedFetch
};
