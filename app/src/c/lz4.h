#pragma once

#include <pebble.h>

// LZ4 block decompressor
// Returns decompressed length, or a negative number on corrupt input.
int lz4_decompress(const uint8_t *src, int src_length, uint8_t *dst, int dst_capacity);
