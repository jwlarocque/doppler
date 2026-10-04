#pragma once

#include <pebble.h>

#include "map.h"

#define RADAR_WIDTH (MAP_WIDTH)
#define RADAR_HEIGHT (MAP_HEIGHT)

#ifdef PBL_COLOR
// 4bpp packed rows, high first
#define RADAR_STRIDE ((MAP_WIDTH + 1) / 2)
#else
// 1bpp
#define RADAR_STRIDE ((MAP_WIDTH + 7) / 8)
#endif
// decompressed image size in bytes
#define RADAR_RAW_BYTES (RADAR_STRIDE * MAP_HEIGHT)
// lz4 worst case
#define RADAR_COMPRESSED_MAX (RADAR_RAW_BYTES + RADAR_RAW_BYTES / 255 + 16)

// Compressed radar packet buffer
void radar_begin(int32_t total);
void radar_chunk(const uint8_t *data, uint16_t length, int32_t index);
void radar_complete(int32_t uncompressed_length);

void radar_set_layer(Layer *layer);
bool radar_is_ready(void);
const uint8_t *radar_raw(void);
