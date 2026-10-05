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

int lz4_decompress_to_rows(const uint8_t *src, int src_length, uint8_t *dst_base,
                           int dst_pitch, int stride, int rows) {
  const int capacity = stride * rows;
  const uint8_t *s = src;
  const uint8_t *s_end = src + src_length;
  int pos = 0;
  int d_row = 0, d_col = 0;

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
      int chunk = stride - d_col;
      if (chunk > literals) {
        chunk = literals;
      }
      memcpy(dst_base + d_row * dst_pitch + d_col, s, chunk);
      s += chunk;
      pos += chunk;
      d_col += chunk;
      if (d_col == stride) {
        d_col = 0;
        d_row++;
      }
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
    // matches can overlap (output just written can itself be part of the
    // match), so output byte i must read the already-written byte i - offset.
    // use a byte loop in this case, otherwise memmove
    int ref = pos - offset;
    int r_row = ref / stride, r_col = ref % stride;
    while (match > 0) {
      int chunk = match;
      if (chunk > offset) {
        chunk = offset;
      }
      if (chunk > stride - d_col) {
        chunk = stride - d_col;
      }
      if (chunk > stride - r_col) {
        chunk = stride - r_col;
      }
      if (chunk >= 8) {
        memmove(dst_base + d_row * dst_pitch + d_col,
                dst_base + r_row * dst_pitch + r_col, chunk);
        d_col += chunk;
        if (d_col == stride) {
          d_col = 0;
          d_row++;
        }
        r_col += chunk;
        if (r_col == stride) {
          r_col = 0;
          r_row++;
        }
      } else {
        uint8_t *d = dst_base + d_row * dst_pitch + d_col;
        uint8_t *r = dst_base + r_row * dst_pitch + r_col;
        int n = chunk;
        while (n--) {
          *d++ = *r++;
          if (++d_col == stride) {
            d_col = 0;
            d_row++;
            d = dst_base + d_row * dst_pitch;
          }
          if (++r_col == stride) {
            r_col = 0;
            r_row++;
            r = dst_base + r_row * dst_pitch;
          }
        }
      }
      pos += chunk;
      match -= chunk;
    }
  }
  return pos;
}

int lz4_decompress_expand_to_rows(const uint8_t *src, int src_length,
                                  uint8_t *dst_base, int dst_pitch, int stride,
                                  int rows, const uint8_t *palette) {
  const int capacity = stride * rows;
  const int out_stride = stride * 2;
  const uint8_t *s = src;
  const uint8_t *s_end = src + src_length;
  int pos = 0;
  int d_row = 0, d_col = 0;

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
    while (literals--) {
      uint8_t b = *s++;
      uint8_t *d = dst_base + d_row * dst_pitch + d_col;
      d[0] = palette[b >> 4];
      d[1] = palette[b & 15];
      d_col += 2;
      if (d_col == out_stride) {
        d_col = 0;
        d_row++;
      }
      pos++;
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
    int ref = pos - offset;
    int r_row = ref / stride, r_col = (ref % stride) * 2;
    int back = offset * 2;
    int expanded = match * 2;
    while (expanded > 0) {
      int chunk = expanded;
      if (chunk > back) {
        chunk = back;
      }
      if (chunk > out_stride - d_col) {
        chunk = out_stride - d_col;
      }
      if (chunk > out_stride - r_col) {
        chunk = out_stride - r_col;
      }
      if (chunk >= 8) {
        memmove(dst_base + d_row * dst_pitch + d_col,
                dst_base + r_row * dst_pitch + r_col, chunk);
        d_col += chunk;
        if (d_col == out_stride) {
          d_col = 0;
          d_row++;
        }
        r_col += chunk;
        if (r_col == out_stride) {
          r_col = 0;
          r_row++;
        }
      } else {
        uint8_t *d = dst_base + d_row * dst_pitch + d_col;
        uint8_t *r = dst_base + r_row * dst_pitch + r_col;
        int n = chunk;
        while (n--) {
          *d++ = *r++;
          if (++d_col == out_stride) {
            d_col = 0;
            d_row++;
            d = dst_base + d_row * dst_pitch;
          }
          if (++r_col == out_stride) {
            r_col = 0;
            r_row++;
            r = dst_base + r_row * dst_pitch;
          }
        }
      }
      expanded -= chunk;
    }
    pos += match;
  }
  return pos * 2;
}
