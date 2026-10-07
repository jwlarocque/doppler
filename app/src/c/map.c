#include <pebble.h>
#include <string.h>

#include "map.h"

static uint8_t *s_raw;
static int32_t s_total;
static int32_t s_received;
static bool s_ready;
static Layer *s_layer;

void map_begin(int32_t total) {
  free(s_raw);
  s_raw = NULL;
  s_total = 0;
  s_received = 0;
  s_ready = false;
  if (total != MAP_RAW_BYTES) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "map rejected, length %d", (int)total);
    return;
  }
  s_raw = malloc(MAP_RAW_BYTES);
  if (!s_raw) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "map malloc failed, length %d", (int)total);
    return;
  }
  memset(s_raw, 0, MAP_RAW_BYTES);
  s_total = total;
  APP_LOG(APP_LOG_LEVEL_INFO, "map begin, length %d", (int)total);
}

void map_chunk(const uint8_t *data, uint16_t length, int32_t index) {
  if (!s_raw) {
    return;
  }
  if (index < 0 || length > s_total - index) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "map chunk out of bounds, index %d length %d",
            (int)index, (int)length);
    return;
  }
  memcpy(s_raw + index, data, length);
  s_received += length;
}

void map_complete(int32_t uncompressed_length) {
  if (!s_raw || s_received != s_total || uncompressed_length != MAP_RAW_BYTES) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "map incomplete, received %d of %d raw %d",
            (int)s_received, (int)s_total, (int)uncompressed_length);
    return;
  }
  s_ready = true;
  APP_LOG(APP_LOG_LEVEL_INFO, "map ready, heap free %d", (int)heap_bytes_free());
  if (s_layer) {
    layer_mark_dirty(s_layer);
  }
}

void map_set_layer(Layer *layer) {
  s_layer = layer;
}

void map_invalidate(void) {
  s_ready = false;
}

bool map_is_ready(void) {
  return s_ready;
}

const uint8_t *map_raw(void) {
  return s_raw;
}
