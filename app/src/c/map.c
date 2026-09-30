#include <pebble.h>

#include "map.h"

// worst case (flint) uncompressable map data plus lz4 overhead
// (length + length / 255 + 16) plus some extra
#define MAP_COMPRESSED_MAX 3072

static uint8_t *s_data;
static int32_t s_total;
static int32_t s_received;
static bool s_complete;

void map_begin(int32_t total) {
  free(s_data);
  s_data = NULL;
  s_total = 0;
  s_received = 0;
  s_complete = false;
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
  s_complete = s_data && s_received == s_total;
  APP_LOG(APP_LOG_LEVEL_INFO, "map done, received %d of %d raw %d complete %d heap free %d",
          (int)s_received, (int)s_total, (int)uncompressed_length, (int)s_complete,
          (int)heap_bytes_free());
}
