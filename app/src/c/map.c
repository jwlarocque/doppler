#include <pebble.h>

#include "lz4.h"
#include "map.h"

static uint8_t *s_data;
static int32_t s_total;
static int32_t s_received;
static uint8_t *s_raw;
static bool s_ready;
static Layer *s_layer;

void map_begin(int32_t total) {
  free(s_data);
  s_data = NULL;
  s_total = 0;
  s_received = 0;
  free(s_raw);
  s_raw = NULL;
  s_ready = false;
  if (total <= 0 || total > MAP_COMPRESSED_MAX) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "map rejected, length %d", (int)total);
    return;
  }
  s_data = malloc(total);
  if (!s_data) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "map malloc failed, length %d", (int)total);
    return;
  }
  s_total = total;
  APP_LOG(APP_LOG_LEVEL_INFO, "map begin, length %d", (int)total);
}

void map_chunk(const uint8_t *data, uint16_t length, int32_t index) {
  if (!s_data) {
    return;
  }
  if (index < 0 || length > s_total - index) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "map chunk out of bounds, index %d length %d",
            (int)index, (int)length);
    return;
  }
  memcpy(s_data + index, data, length);
  s_received += length;
}

void map_complete(int32_t uncompressed_length) {
  if (!s_data || s_received != s_total || uncompressed_length != MAP_RAW_BYTES) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "map incomplete, received %d of %d raw %d",
            (int)s_received, (int)s_total, (int)uncompressed_length);
    return;
  }
  s_raw = malloc(MAP_RAW_BYTES);
  if (!s_raw) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "map raw malloc failed");
    return;
  }
  int decoded = lz4_decompress(s_data, s_total, s_raw, MAP_RAW_BYTES);
  if (decoded != MAP_RAW_BYTES) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "map decode failed, got %d", decoded);
    free(s_raw);
    s_raw = NULL;
    return;
  }
  free(s_data);
  s_data = NULL;
  s_ready = true;
  APP_LOG(APP_LOG_LEVEL_INFO, "map ready, heap free %d", (int)heap_bytes_free());
  if (s_layer) {
    layer_mark_dirty(s_layer);
  }
}

void map_set_layer(Layer *layer) {
  s_layer = layer;
}

bool map_is_ready(void) {
  return s_ready;
}

const uint8_t *map_raw(void) {
  return s_raw;
}
