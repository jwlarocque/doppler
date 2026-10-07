#include <pebble.h>
#include <stdlib.h>
#include <string.h>

#include "radar.h"

#ifdef RADAR_ARENA_MALLOC
static uint8_t *s_arena;
#else
static uint8_t s_arena[RADAR_ARENA_BYTES];
#endif

static uint32_t s_offset[RADAR_MAX_FRAMES];
static uint32_t s_len[RADAR_MAX_FRAMES];
static uint32_t s_time[RADAR_MAX_FRAMES];
static bool s_resident[RADAR_MAX_FRAMES];

static int s_num_frames;
static int s_live_slot;
static bool s_has_layout;
static bool s_session_done;

static int32_t s_live_total;
static int32_t s_live_received;
static bool s_live_ready;

static int32_t s_recv_slot;
static int32_t s_recv_total;
static int32_t s_recv_received;

static Layer *s_layer;

static uint32_t prv_read_u32(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) |
         ((uint32_t)p[3] << 24);
}

static void prv_reset_session(void) {
  s_num_frames = 0;
  s_live_slot = -1;
  s_has_layout = false;
  s_session_done = false;
  s_recv_slot = -1;
  s_recv_total = 0;
  s_recv_received = 0;
  for (int i = 0; i < RADAR_MAX_FRAMES; i++) {
    s_offset[i] = 0;
    s_len[i] = 0;
    s_time[i] = 0;
    s_resident[i] = false;
  }
}

void radar_init(void) {
#ifdef RADAR_ARENA_MALLOC
  if (!s_arena) {
    s_arena = malloc(RADAR_ARENA_BYTES);
    APP_LOG(APP_LOG_LEVEL_INFO, "radar arena %s, heap free %d",
            s_arena ? "ok" : "MALLOC FAILED", (int)heap_bytes_free());
  }
#endif
}

void radar_invalidate(void) {
  prv_reset_session();
  s_live_total = 0;
  s_live_received = 0;
  s_live_ready = false;
}

void radar_live_begin(int32_t total) {
  prv_reset_session();
  s_live_total = 0;
  s_live_received = 0;
  s_live_ready = false;
#ifdef RADAR_ARENA_MALLOC
  if (!s_arena) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "radar arena missing, length %d", (int)total);
    return;
  }
#endif
  if (total <= 0 || total > (int32_t)RADAR_ARENA_BYTES) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "radar live rejected, length %d", (int)total);
    return;
  }
  s_live_total = total;
  APP_LOG(APP_LOG_LEVEL_INFO, "radar live begin, length %d", (int)total);
}

void radar_live_chunk(const uint8_t *data, uint16_t length, int32_t index) {
  if (s_live_total <= 0) {
    return;
  }
  if (index < 0 || length > (uint16_t)(s_live_total - index)) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "radar live chunk out of bounds, index %d length %d",
            (int)index, (int)length);
    return;
  }
  memcpy(s_arena + index, data, length);
  s_live_received += length;
}

void radar_live_complete(int32_t uncompressed_length) {
  if (s_live_total <= 0) {
    // no live transfer in progress (e.g. a stale session-teardown
    // count arriving after the session was discarded); ignore it
    return;
  }
  if (s_live_received != s_live_total ||
      uncompressed_length != RADAR_RAW_BYTES) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "radar live incomplete, received %d of %d raw %d",
            (int)s_live_received, (int)s_live_total, (int)uncompressed_length);
    return;
  }
  s_live_ready = true;
  APP_LOG(APP_LOG_LEVEL_INFO, "radar live ready, heap free %d", (int)heap_bytes_free());
  if (s_layer) {
    layer_mark_dirty(s_layer);
  }
}

bool radar_apply_layout(const uint8_t *blob, uint16_t blob_len) {
  if (!s_live_ready) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "radar layout before live ready");
    return false;
  }
#ifdef RADAR_ARENA_MALLOC
  if (!s_arena) {
    return false;
  }
#endif
  if (!blob || blob_len < RADAR_LAYOUT_HEADER) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "radar layout too short %d", (int)blob_len);
    return false;
  }
  if (blob[0] != RADAR_LAYOUT_VERSION) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "radar layout bad version %d", (int)blob[0]);
    return false;
  }
  int n = blob[1];
  int live = blob[2];
  if (n <= 0 || n > RADAR_MAX_FRAMES || live < 0 || live >= n) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "radar layout bad n %d live %d", n, live);
    return false;
  }
  if (blob_len != (uint16_t)(RADAR_LAYOUT_HEADER + n * RADAR_LAYOUT_ENTRY)) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "radar layout length mismatch %d n %d",
            (int)blob_len, n);
    return false;
  }
  uint32_t expect_off = 0;
  for (int i = 0; i < n; i++) {
    const uint8_t *e = blob + RADAR_LAYOUT_HEADER + i * RADAR_LAYOUT_ENTRY;
    uint32_t off = prv_read_u32(e);
    uint32_t len = prv_read_u32(e + 4);
    if (len == 0 || off != expect_off || off + len > (uint32_t)RADAR_ARENA_BYTES) {
      APP_LOG(APP_LOG_LEVEL_ERROR, "radar layout bad entry %d off %d len %d",
              i, (int)off, (int)len);
      return false;
    }
    expect_off = off + len;
  }
  const uint8_t *live_entry =
      blob + RADAR_LAYOUT_HEADER + live * RADAR_LAYOUT_ENTRY;
  uint32_t live_off = prv_read_u32(live_entry);
  uint32_t live_len = prv_read_u32(live_entry + 4);
  if (live_len != (uint32_t)s_live_total) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "radar layout live len %d != %d",
            (int)live_len, (int)s_live_total);
    return false;
  }
  // move live frame from offset 0 to final computed offset
  memmove(s_arena + live_off, s_arena, s_live_total);
  for (int i = 0; i < n; i++) {
    const uint8_t *e = blob + RADAR_LAYOUT_HEADER + i * RADAR_LAYOUT_ENTRY;
    s_offset[i] = prv_read_u32(e);
    s_len[i] = prv_read_u32(e + 4);
    s_time[i] = prv_read_u32(e + 8);
    s_resident[i] = (i == live);
  }
  s_num_frames = n;
  s_live_slot = live;
  s_has_layout = true;
  s_session_done = false;
  s_recv_slot = -1;
  APP_LOG(APP_LOG_LEVEL_INFO, "radar layout ok n %d live %d heap %d", n, live,
          (int)heap_bytes_free());
  return true;
}

bool radar_frame_begin(int32_t slot, int32_t total) {
  if (!s_has_layout || s_session_done) {
    return false;
  }
#ifdef RADAR_ARENA_MALLOC
  if (!s_arena) {
    return false;
  }
#endif
  if (slot < 0 || slot >= s_num_frames || slot == s_live_slot) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "radar frame bad slot %d", (int)slot);
    return false;
  }
  if (total <= 0 || total != (int32_t)s_len[slot] ||
      s_offset[slot] + s_len[slot] > (uint32_t)RADAR_ARENA_BYTES) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "radar frame bad length slot %d len %d",
            (int)slot, (int)total);
    return false;
  }
  if (s_resident[slot]) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "radar frame duplicate slot %d", (int)slot);
    return false;
  }
  s_recv_slot = slot;
  s_recv_total = total;
  s_recv_received = 0;
  return true;
}

bool radar_frame_chunk(const uint8_t *data, uint16_t length, int32_t index) {
  if (s_recv_slot < 0) {
    return false;
  }
  if (index < 0 || length > (uint16_t)(s_recv_total - index)) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "radar frame chunk oob slot %d index %d len %d",
            (int)s_recv_slot, (int)index, (int)length);
    return false;
  }
  memcpy(s_arena + s_offset[s_recv_slot] + index, data, length);
  s_recv_received += length;
  if (s_recv_received != s_recv_total) {
    return false;
  }
  int slot = (int)s_recv_slot;
  s_recv_slot = -1;
  s_recv_total = 0;
  s_recv_received = 0;
  s_resident[slot] = true;
  APP_LOG(APP_LOG_LEVEL_INFO, "radar frame %d resident (of %d)", slot,
          s_num_frames);
  return true;
}

bool radar_has_layout(void) {
  return s_has_layout;
}

bool radar_is_session_done(void) {
  return s_session_done;
}

void radar_set_terminal_count(int32_t count) {
  s_session_done = true;
  APP_LOG(APP_LOG_LEVEL_INFO, "radar session done, frames %d heap %d",
          (int)count, (int)heap_bytes_free());
  if (s_layer) {
    layer_mark_dirty(s_layer);
  }
}

int radar_count(void) {
  if (!s_live_ready) {
    return 0;
  }
  if (!s_has_layout || !s_session_done) {
    return 1;
  }
  return s_num_frames;
}

const uint8_t *radar_frame_at(int32_t slot, int32_t *len_out, int32_t *time_out) {
  if (!s_has_layout || slot < 0 || slot >= s_num_frames || !s_resident[slot]) {
    return NULL;
  }
  if (len_out) {
    *len_out = (int32_t)s_len[slot];
  }
  if (time_out) {
    *time_out = (int32_t)s_time[slot];
  }
  return s_arena + s_offset[slot];
}

void radar_set_layer(Layer *layer) {
  s_layer = layer;
}

bool radar_is_ready(void) {
  return s_live_ready;
}

const uint8_t *radar_compressed(void) {
  if (!s_live_ready) {
    return NULL;
  }
  if (!s_has_layout) {
    return s_arena;
  }
  return s_arena + s_offset[s_live_slot];
}

int32_t radar_compressed_length(void) {
  if (!s_live_ready) {
    return 0;
  }
  if (!s_has_layout) {
    return s_live_total;
  }
  return (int32_t)s_len[s_live_slot];
}
