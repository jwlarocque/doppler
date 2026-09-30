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

int lz4_decompress_to_rows(const uint8_t *src, int src_length, uint8_t **row_base,
                           int stride, int rows) {
  const int capacity = stride * rows;
  const uint8_t *s = src;
  const uint8_t *s_end = src + src_length;
  int pos = 0;

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
    if (literals > capacity - pos || literals > s_end - s) {
      return -1;
    }
    // literals can't overlap, so copy in row-bounded chunks
    while (literals > 0) {
      int col = pos % stride;
      int chunk = stride - col;
      if (chunk > literals) {
        chunk = literals;
      }
      memcpy(row_base[pos / stride] + col, s, chunk);
      s += chunk;
      pos += chunk;
      literals -= chunk;
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
    if (offset <= 0 || offset > pos || match > capacity - pos) {
      return -1;
    }
    // lz4 matches can overlap (data just written by the match can itself be
    // part of the match), so we have to copy byte by byte when crossing
    // between rows.
    int ref = pos - offset;
    int d_row = pos / stride, d_col = pos % stride;
    int r_row = ref / stride, r_col = ref % stride;
    if (d_col + match <= stride && r_col + match <= stride) {
      // if the match is within a single row, we can memmove
      memmove(&row_base[d_row][d_col], &row_base[r_row][r_col], match);
      pos += match;
    } else {
      pos += match;
      while (match--) {
        row_base[d_row][d_col] = row_base[r_row][r_col];
        if (++d_col == stride) {
          d_col = 0;
          d_row++;
        }
        if (++r_col == stride) {
          r_col = 0;
          r_row++;
        }
      }
    }
  }
  return pos;
}
