#include <pebble.h>

#include "lz4.h"

int lz4_decompress(const uint8_t *src, int src_length, uint8_t *dst, int dst_capacity) {
  const uint8_t *s = src;
  const uint8_t *s_end = src + src_length;
  uint8_t *d = dst;
  uint8_t *d_end = dst + dst_capacity;

  while (s < s_end) {
    uint8_t token = *s++;
    int literals = token >> 4;
    if (literals == 15) {
      uint8_t b;
      do {
        if (s >= s_end) {
          return -1;
        }
        b = *s++;
        literals += b;
      } while (b == 255);
    }
    if (literals > d_end - d || literals > s_end - s) {
      return -1;
    }
    while (literals--) {
      *d++ = *s++;
    }
    if (s >= s_end) {
      break;
    }
    int offset = s[0] | (s[1] << 8);
    s += 2;
    int match = (token & 15) + 4;
    if ((token & 15) == 15) {
      uint8_t b;
      do {
        if (s >= s_end) {
          return -1;
        }
        b = *s++;
        match += b;
      } while (b == 255);
    }
    if (offset <= 0 || offset > d - dst || match > d_end - d) {
      return -1;
    }
    const uint8_t *ref = d - offset;
    while (match--) {
      *d++ = *ref++;
    }
  }
  return (int)(d - dst);
}
