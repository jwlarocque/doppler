#pragma once

#include <pebble.h>

// stores one lz4 block (map packet) before decompression
void map_begin(int32_t total);
void map_chunk(const uint8_t *data, uint16_t length, int32_t index);
void map_complete(int32_t uncompressed_length);
