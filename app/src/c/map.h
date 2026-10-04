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

// these maximums come from sampling about 50M viewports in high-entropy areas
// of the map, plus 5%
// if zoom levels beyond 7 or new map styles are added, these may need to be
// re-evaluated
#if PBL_DISPLAY_WIDTH == 144
#ifdef PBL_COLOR
#define MAP_COMPRESSED_MAX 5963
#else
#define MAP_COMPRESSED_MAX 3051
#endif
#elif PBL_DISPLAY_WIDTH == 180
#define MAP_COMPRESSED_MAX 6711
#elif PBL_DISPLAY_WIDTH == 200
#define MAP_COMPRESSED_MAX 10240
#elif PBL_DISPLAY_WIDTH == 260
#define MAP_COMPRESSED_MAX 12533
#else
// lz4 worst case
#define MAP_COMPRESSED_MAX (MAP_RAW_BYTES + MAP_RAW_BYTES / 255 + 16)
#endif

// Compressed map packet store. Holds one LZ4 raw block until decompressed.
void map_begin(int32_t total);
void map_chunk(const uint8_t *data, uint16_t length, int32_t index);
void map_complete(int32_t uncompressed_length);

void map_set_layer(Layer *layer);
bool map_is_ready(void);
const uint8_t *map_raw(void);
