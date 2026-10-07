#pragma once

#include <pebble.h>

#include "map.h"

#define RADAR_WIDTH (MAP_WIDTH)
#define RADAR_HEIGHT (MAP_HEIGHT)

#ifdef PBL_COLOR
// 4bpp packed rows, high first
#define RADAR_STRIDE ((MAP_WIDTH + 1) / 2)
// direct-to-framebuffer decompressor assumes rows are RADAR_STRIDE * 2
#if (MAP_WIDTH % 2) != 0
#error "radar expand path needs an even display width"
#endif
#else
// 1bpp
#define RADAR_STRIDE ((MAP_WIDTH + 7) / 8)
#endif
// decompressed image size in bytes
#define RADAR_RAW_BYTES (RADAR_STRIDE * MAP_HEIGHT)
// lz4 worst case
#define RADAR_COMPRESSED_MAX (RADAR_RAW_BYTES + RADAR_RAW_BYTES / 255 + 16)

// giant (occupy ~all available memory) arena for radar frames
// static memory is limited to 64K, so emery and gabbro use malloc instead
// sizes must match tiles.js
#if defined(PBL_PLATFORM_APLITE)
#define RADAR_ARENA_BYTES 10219
#elif defined(PBL_PLATFORM_BASALT)
#define RADAR_ARENA_BYTES 43851
#elif defined(PBL_PLATFORM_CHALK)
#define RADAR_ARENA_BYTES 42551
#elif defined(PBL_PLATFORM_DIORITE)
#define RADAR_ARENA_BYTES 49131
#elif defined(PBL_PLATFORM_FLINT)
#define RADAR_ARENA_BYTES 49131
#elif defined(PBL_PLATFORM_EMERY)
#define RADAR_ARENA_BYTES 102400
#define RADAR_ARENA_MALLOC 1
#elif defined(PBL_PLATFORM_GABBRO)
#define RADAR_ARENA_BYTES 98549
#define RADAR_ARENA_MALLOC 1
#else
#define RADAR_ARENA_BYTES 7168
#endif

#define RADAR_MAX_FRAMES 18
#define RADAR_PAST_MAX 12
#define RADAR_NOWCAST_MAX 6

// layout blob
// byte 0: version (1), byte 1: N (1..18), byte 2: live_slot, byte 3: reserved
// then N entries of 12 bytes: offset u32, len u32, time u32
#define RADAR_LAYOUT_VERSION 1
#define RADAR_LAYOUT_HEADER 4
#define RADAR_LAYOUT_ENTRY 12

// RadarAck values sent back to pkjs
// Layout accepted: -1
// each frame: the slot (>= 0)
#define RADAR_ACK_LAYOUT ((int32_t)-1)

// live frame received to arena offset 0 and immediately displayed
void radar_init(void);

// discard all frames so no radar data is displayed until new data is available
void radar_invalidate(void);
void radar_live_begin(int32_t total);
void radar_live_chunk(const uint8_t *data, uint16_t length, int32_t index);
void radar_live_complete(int32_t uncompressed_length);

// check that offset+len fits in arena, memmove live bytes from
// offset 0 to the computed live offset, and inform pkjs that the arena is
// ready for more frames
// returns true on success
bool radar_apply_layout(const uint8_t *blob, uint16_t blob_len);

bool radar_frame_begin(int32_t slot, int32_t total);
// returns true when frame is completed
bool radar_frame_chunk(const uint8_t *data, uint16_t length, int32_t index);

bool radar_has_layout(void);
bool radar_is_session_done(void);
void radar_set_terminal_count(int32_t count);

// information for playback (count frames are available starting from base)
int radar_count(void);
int radar_base(void);
int radar_num_frames(void);
int radar_live_slot(void);
int radar_resident_count(void);
const uint8_t *radar_frame_at(int32_t slot, int32_t *len_out, int32_t *time_out);

void radar_set_layer(Layer *layer);
// true when live frame is available
bool radar_is_ready(void);
// live frame pointer (arena offset 0 before layout move, then actual offset)
const uint8_t *radar_compressed(void);
int32_t radar_compressed_length(void);
