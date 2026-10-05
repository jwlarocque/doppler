#pragma once

#include <pebble.h>

// LZ4 block decompressor
// Returns decompressed length, or a negative number on corrupt input.
int lz4_decompress(const uint8_t *src, int src_length, uint8_t *dst, int dst_capacity);

// write to rows with a caller-provided pitch instead of a flat buffer,
// to allow for decompression directly to the framebuffer.
// dst row y starts at dst_base + y * dst_pitch; each row takes stride
// bytes of decompressed data (dst_pitch may be larger, e.g. padded
// framebuffer rows)
// returns decompressed length, or negative on corrupt input
int lz4_decompress_to_rows(const uint8_t *src, int src_length, uint8_t *dst_base,
                           int dst_pitch, int stride, int rows);

// same, but for color - compressed data has 4bpp indices (high, low), which
// are expanded to GColor values from the palette, so each row is 2 * stride
// bytes and lz4 matches are copied with doubled offsets and lengths
// return expanded length, or negative on corrupt input
int lz4_decompress_expand_to_rows(const uint8_t *src, int src_length,
                                  uint8_t *dst_base, int dst_pitch, int stride,
                                  int rows, const uint8_t *palette);
