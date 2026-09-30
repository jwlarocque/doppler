#pragma once

#include <pebble.h>

// LZ4 block decompressor
// Returns decompressed length, or a negative number on corrupt input.
int lz4_decompress(const uint8_t *src, int src_length, uint8_t *dst, int dst_capacity);

// write to a table of row start address instead of a flat buffer
// row_base[pos / stride][pos % stride]
// to allow for decompression directly to framebuffer
int lz4_decompress_to_rows(const uint8_t *src, int src_length, uint8_t **row_base,
                           int stride, int rows);
