#pragma once

#include <pebble.h>

// 1bpp framebuffer image
#define MAP_RAW_BYTES (PBL_DISPLAY_WIDTH * PBL_DISPLAY_HEIGHT / 8)
// row stride in bytes
#define MAP_STRIDE (PBL_DISPLAY_WIDTH / 8)

// Compressed map packet store. Holds one LZ4 raw block until decompressed.
void map_begin(int32_t total);
void map_chunk(const uint8_t *data, uint16_t length, int32_t index);
void map_complete(int32_t uncompressed_length);

void map_set_layer(Layer *layer);
bool map_is_ready(void);
const uint8_t *map_raw(void);
