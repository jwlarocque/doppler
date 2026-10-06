#pragma once

#include <pebble.h>

#define MAP_WIDTH (PBL_DISPLAY_WIDTH)
#define MAP_HEIGHT (PBL_DISPLAY_HEIGHT)

#ifdef PBL_COLOR
// 2bpp packed rows
#define MAP_STRIDE ((PBL_DISPLAY_WIDTH + 3) / 4)
#else
// 1bpp rows matching GBitmapFormat1Bit
#define MAP_STRIDE ((PBL_DISPLAY_WIDTH + 7) / 8)
#endif
// decompressed image size in bytes
#define MAP_RAW_BYTES (MAP_STRIDE * PBL_DISPLAY_HEIGHT)

// uncompressed map image store
void map_begin(int32_t total);
void map_chunk(const uint8_t *data, uint16_t length, int32_t index);
void map_complete(int32_t uncompressed_length);

void map_set_layer(Layer *layer);
bool map_is_ready(void);
const uint8_t *map_raw(void);
