#include <pebble.h>

#include "comm.h"
#include "lz4.h"
#include "map.h"
#include "radar.h"

static Window *s_window;
static Layer *s_map_layer;
static AppTimer *s_play_timer;
static int s_play_index;

#define RADAR_PLAY_MS 500

static void prv_play_tick(void *context) {
  s_play_index++;
  APP_LOG(APP_LOG_LEVEL_DEBUG, "radar tick %d", s_play_index);
  s_play_timer = app_timer_register(RADAR_PLAY_MS, prv_play_tick, NULL);
  if (s_map_layer) {
    layer_mark_dirty(s_map_layer);
  }
}

#ifdef PBL_COLOR
// NOAA NEXRAD palette (0 is transparent)
static const uint8_t NEXRAD_GCOLOR[16] __attribute__((unused)) = {
  0x00,
  0xCB, 0xC3, 0xCC, 0xC8, 0xC4, 0xFC,
  0xE8, 0xF8, 0xF0, 0xE0, 0xE0, 0xF3,
  0xEF, 0xDB, 0xC7
};
// Dark Sky palette
static const uint8_t DARK_SKY_GCOLOR[16] = {
  0x00,
  0xC1, 0xC2, 0xD2, 0xE2, 0xF0, 0xF4, 0xF8, 0xFC, 0xFE,
  0xDF, 0xDF, 0xDB, 0xCB, 0xD7, 0xC7
};
#endif

static void prv_map_update(Layer *layer, GContext *ctx) {
  if (!map_is_ready()) {
    return;
  }
  GBitmap *framebuffer = graphics_capture_frame_buffer(ctx);
  if (!framebuffer) {
    return;
  }
  const uint8_t *raw = map_raw();
  int play_count = radar_count();
  const uint8_t *radar = NULL;
  int32_t radar_len = 0;
  if (play_count >= 2) {
    int slot = radar_base() + (s_play_index % play_count);
    radar = radar_frame_at(slot, &radar_len, NULL);
    if (!radar) {
      radar = radar_compressed();
      radar_len = radar_compressed_length();
    }
    if (!s_play_timer) {
      APP_LOG(APP_LOG_LEVEL_INFO, "radar playback start, frames %d", play_count);
      s_play_timer = app_timer_register(RADAR_PLAY_MS, prv_play_tick, NULL);
    }
  } else {
    if (s_play_timer) {
      app_timer_cancel(s_play_timer);
      s_play_timer = NULL;
      s_play_index = 0;
    }
    if (radar_is_ready()) {
      radar = radar_compressed();
      radar_len = radar_compressed_length();
    }
  }
  GRect bounds = layer_get_bounds(layer);
  int16_t height = bounds.size.h;
  if (height > MAP_HEIGHT) {
    height = MAP_HEIGHT;
  }
#ifdef PBL_COLOR
  // decompress radar first so we can copy matches directly from the
  // framebuffer (note: compressed data is 4bpp, so double the offset and
  // length of matches)
  // then copy map "underneath", treating 0x00 as transparent
  // chalk's circular framebuffer needs a special variant that skips the
  // corners
  bool radar_ok = false;
  bool circular = (gbitmap_get_format(framebuffer) == GBitmapFormat8BitCircular);
  if (radar && circular) {
    int got = lz4_decompress_expand_to_circular(
        radar, radar_len, framebuffer, RADAR_STRIDE,
        MAP_HEIGHT, DARK_SKY_GCOLOR);
    radar_ok = (got == 2 * RADAR_STRIDE * MAP_HEIGHT);
    if (!radar_ok) {
      APP_LOG(APP_LOG_LEVEL_ERROR, "radar circular expand failed");
    }
  }
  if (radar && !circular) {
    GBitmapDataRowInfo row0 = gbitmap_get_data_row_info(framebuffer, 0);
    GBitmapDataRowInfo row1 = gbitmap_get_data_row_info(framebuffer, 1);
    int pitch = (int)(row1.data - row0.data);
    if (pitch >= MAP_WIDTH) {
      int got = lz4_decompress_expand_to_rows(
          radar, radar_len, row0.data, pitch, RADAR_STRIDE,
          MAP_HEIGHT, DARK_SKY_GCOLOR);
      radar_ok = (got == 2 * RADAR_STRIDE * MAP_HEIGHT);
    }
    if (!radar_ok) {
      APP_LOG(APP_LOG_LEVEL_ERROR, "radar expand failed");
    }
  }
  const uint8_t shades[4] = {
    GColorBlack.argb, GColorDarkGray.argb, GColorLightGray.argb, GColorWhite.argb
  };
  for (int16_t y = 0; y < height; y++) {
    GBitmapDataRowInfo info = gbitmap_get_data_row_info(framebuffer, (uint16_t)y);
    for (int16_t x = info.min_x; x <= info.max_x; x++) {
      if (radar_ok && info.data[x]) {
        continue;
      }
      uint8_t packed = raw[y * MAP_STRIDE + (x >> 2)];
      uint8_t gray = (packed >> (6 - 2 * (x & 3))) & 3;
      info.data[x] = shades[gray];
    }
  }
#else
  bool radar_ok = false;
  if (radar) {
    GBitmapDataRowInfo row0 = gbitmap_get_data_row_info(framebuffer, 0);
    GBitmapDataRowInfo row1 = gbitmap_get_data_row_info(framebuffer, 1);
    int pitch = (int)(row1.data - row0.data);
    if (pitch >= RADAR_STRIDE) {
      int got = lz4_decompress_to_rows(radar, radar_len,
                                       row0.data, pitch, RADAR_STRIDE,
                                       MAP_HEIGHT);
      radar_ok = (got == RADAR_RAW_BYTES);
    }
    if (!radar_ok) {
      APP_LOG(APP_LOG_LEVEL_ERROR, "radar decode failed");
    }
  }
  // bw watches are rectangular, and our 1bpp data is already in the
  // framebuffer format, so we can just copy whole rows
  for (int16_t y = 0; y < height; y++) {
    GBitmapDataRowInfo info = gbitmap_get_data_row_info(framebuffer, (uint16_t)y);
    int16_t first = info.min_x >> 3;
    int16_t last = info.max_x >> 3;
    if (radar_ok) {
      // radar is black-on-transparent
      for (int16_t bx = first; bx <= last; bx++) {
        uint8_t bits = info.data[bx];
        info.data[bx] = raw[y * MAP_STRIDE + bx] & ~bits;
      }
    } else {
      memcpy(&info.data[first], &raw[y * MAP_STRIDE + first],
             (size_t)(last - first + 1));
    }
  }
#endif
  graphics_release_frame_buffer(ctx, framebuffer);
}

static void prv_window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);

  s_map_layer = layer_create(bounds);
  layer_set_update_proc(s_map_layer, prv_map_update);
  layer_add_child(window_layer, s_map_layer);
  map_set_layer(s_map_layer);
  radar_set_layer(s_map_layer);
}

static void prv_window_unload(Window *window) {
  if (s_play_timer) {
    app_timer_cancel(s_play_timer);
    s_play_timer = NULL;
  }
  s_play_index = 0;
  map_set_layer(NULL);
  radar_set_layer(NULL);
  layer_destroy(s_map_layer);
}

static void prv_init(void) {
  radar_init();
  comm_init();
  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = prv_window_load,
    .unload = prv_window_unload,
  });
  const bool animated = true;
  window_stack_push(s_window, animated);
}

static void prv_deinit(void) {
  window_destroy(s_window);
}

int main(void) {
  prv_init();

  APP_LOG(APP_LOG_LEVEL_DEBUG, "Done initializing, pushed window: %p", s_window);

  app_event_loop();
  prv_deinit();
}
