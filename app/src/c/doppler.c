#include <pebble.h>

#include "comm.h"
#include "config.h"
#include "controls.h"
#include "frame_strip.h"
#include "lz4.h"
#include "map.h"
#include "platform.h"
#include "radar.h"
#include "status_message.h"
#include "ui.h"

static Window *s_window;
static Layer *s_map_layer;
#if !defined(DOPPLER_LOW_MEMORY)
static Layer *s_status_layer;
static Layer *s_strip_layer;
#endif
static Layer *s_ui_layer;
static AppTimer *s_play_timer;
static int s_play_index;
// overwritten from persisted config in prv_init
static bool s_playing = true;

// must match ZOOM_DEFAULT in index.js, since zoom is not communicated before
// initial load
#define ZOOM_MIN 3
#define ZOOM_MAX 8
#define ZOOM_DEFAULT 6
static int s_zoom = ZOOM_DEFAULT;

static void prv_play_tick(void *context) {
  s_play_index++;
  // DOPPLER_LOG(APP_LOG_LEVEL_DEBUG, "radar tick %d", s_play_index);
  s_play_timer = app_timer_register((uint32_t)config_get_radar_interval(),
                                    prv_play_tick, NULL);
  if (s_map_layer) {
    layer_mark_dirty(s_map_layer);
  }
  frame_strip_refresh_current_frame();
}

#ifdef PBL_COLOR
// NOAA NEXRAD palette (0 is transparent)
static const uint8_t NEXRAD_GCOLOR[16] = {
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

static const uint8_t *prv_palette_table(void) {
  return config_get_palette() == PALETTE_NEXRAD ? NEXRAD_GCOLOR : DARK_SKY_GCOLOR;
}
#endif

static void prv_map_update(Layer *layer, GContext *ctx) {
  if (!map_is_ready()) {
    // clear stale data
    graphics_context_set_fill_color(ctx, GColorWhite);
    graphics_fill_rect(ctx, layer_get_bounds(layer), 0, GCornerNone);
    status_message_draw(layer, ctx);
#ifdef DOPPLER_LOW_MEMORY
    frame_strip_draw(layer, ctx);
#endif
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
  if (radar_is_session_done() && play_count >= 2) {
    int slot = s_play_index % play_count;
    radar = radar_frame_at(slot, &radar_len, NULL);
    if (s_playing && !s_play_timer) {
      DOPPLER_LOG(APP_LOG_LEVEL_INFO, "radar playback start, frames %d", play_count);
      s_play_timer = app_timer_register((uint32_t)config_get_radar_interval(),
                                        prv_play_tick, NULL);
    }
  } else {
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
  // only round platforms have circular framebuffers, so pick the
  // decompressor at compile time
  bool radar_ok = false;
#ifdef PBL_ROUND
  // circular variant skips the corners
  if (radar) {
    int got = lz4_decompress_expand_to_circular(
        radar, radar_len, framebuffer, RADAR_STRIDE,
        MAP_HEIGHT, prv_palette_table());
    radar_ok = (got == 2 * RADAR_STRIDE * MAP_HEIGHT);
    if (!radar_ok) {
      DOPPLER_LOG(APP_LOG_LEVEL_ERROR, "radar circular expand failed");
    }
  }
#else
  if (radar) {
    GBitmapDataRowInfo row0 = gbitmap_get_data_row_info(framebuffer, 0);
    GBitmapDataRowInfo row1 = gbitmap_get_data_row_info(framebuffer, 1);
    int pitch = (int)(row1.data - row0.data);
    if (pitch >= MAP_WIDTH) {
      int got = lz4_decompress_expand_to_rows(
          radar, radar_len, row0.data, pitch, RADAR_STRIDE,
          MAP_HEIGHT, prv_palette_table());
      radar_ok = (got == 2 * RADAR_STRIDE * MAP_HEIGHT);
    }
    if (!radar_ok) {
      DOPPLER_LOG(APP_LOG_LEVEL_ERROR, "radar expand failed");
    }
  }
#endif
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
      DOPPLER_LOG(APP_LOG_LEVEL_ERROR, "radar decode failed");
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
  status_message_draw(layer, ctx);
#ifdef DOPPLER_LOW_MEMORY
  frame_strip_draw(layer, ctx);
#endif
}

static void prv_stop_playback(void) {
  if (s_play_timer) {
    app_timer_cancel(s_play_timer);
    s_play_timer = NULL;
  }
  s_play_index = 0;
  s_playing = false;
}

static void prv_try_zoom(int delta) {
  int next = s_zoom + delta;
  if (next < ZOOM_MIN || next > ZOOM_MAX) {
    vibes_double_pulse();
    return;
  }
  s_zoom = next;
  DOPPLER_LOG(APP_LOG_LEVEL_INFO, "zoom change to %d", s_zoom);
  // cancel the timer and restart at frame 0, but keep s_playing so
  // playback resumes via prv_map_update once the new session is done
  if (s_play_timer) {
    app_timer_cancel(s_play_timer);
    s_play_timer = NULL;
  }
  s_play_index = 0;
  map_invalidate();
  radar_invalidate();
  ui_clear_marker();
  if (s_map_layer) {
    layer_mark_dirty(s_map_layer);
  }
  comm_send_zoom(s_zoom);
  controls_refresh_play_icon();
  status_message_refresh();
}

static void prv_frame_step(int delta) {
  s_playing = false;
  if (s_play_timer) {
    app_timer_cancel(s_play_timer);
    s_play_timer = NULL;
  }
  int count = radar_count();
  if (radar_is_session_done() && count >= 2) {
    s_play_index = (s_play_index + delta) % count;
    if (s_play_index < 0) {
      s_play_index += count;
    }
  }
  if (s_map_layer) {
    layer_mark_dirty(s_map_layer);
  }
  frame_strip_refresh_current_frame();
  controls_refresh_play_icon();
}

static void prv_toggle_play(void) {
  if (s_playing) {
    s_playing = false;
    if (s_play_timer) {
      app_timer_cancel(s_play_timer);
      s_play_timer = NULL;
    }
  } else {
    s_playing = true;
    if (!s_play_timer && radar_is_ready()) {
      s_play_timer = app_timer_register((uint32_t)config_get_radar_interval(),
                                        prv_play_tick, NULL);
    }
  }
  if (s_map_layer) {
    layer_mark_dirty(s_map_layer);
  }
  controls_refresh_play_icon();
}

static bool prv_is_playing(void) {
  return s_playing;
}

// Clay settings changed
// apply autoplay immediately
// drop stale radar frames on palette change (pkjs will resend)
static void prv_config_changed(uint32_t changed) {
  if (changed & CONFIG_CHANGED_AUTOPLAY) {
    s_playing = config_get_autoplay();
    if (!s_playing && s_play_timer) {
      app_timer_cancel(s_play_timer);
      s_play_timer = NULL;
    }
    controls_refresh_play_icon();
  }
  if (changed & CONFIG_CHANGED_PALETTE) {
    radar_invalidate();
    DOPPLER_LOG(APP_LOG_LEVEL_INFO, "palette changed to %d", (int)config_get_palette());
  }
  if (changed & CONFIG_CHANGED_RADAR_INTERVAL) {
    if (s_playing && s_play_timer) {
      app_timer_cancel(s_play_timer);
      s_play_timer =
          app_timer_register((uint32_t)config_get_radar_interval(), prv_play_tick, NULL);
    }
    DOPPLER_LOG(APP_LOG_LEVEL_INFO, "radar interval changed to %d",
                config_get_radar_interval());
  }
  if (s_map_layer) {
    layer_mark_dirty(s_map_layer);
  }
  status_message_refresh();
}

// layout slot shown on the map, matching prv_map_update
static int prv_current_frame_slot(void) {
  if (!radar_has_layout()) {
    return -1;
  }
  if (radar_is_session_done()) {
    int count = radar_count();
    if (count <= 0) {
      return -1;
    }
    return s_play_index % count;
  }
  return radar_live_slot();
}

static const struct DopplerControlsCallbacks s_controls_callbacks = {
  .frame_step = prv_frame_step,
  .zoom = prv_try_zoom,
  .toggle_play = prv_toggle_play,
  .is_playing = prv_is_playing,
};

static void prv_window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);

  s_map_layer = layer_create(bounds);
  layer_set_update_proc(s_map_layer, prv_map_update);
  layer_add_child(window_layer, s_map_layer);
  map_set_layer(s_map_layer);
  radar_set_layer(s_map_layer);
#if defined(DOPPLER_LOW_MEMORY)
  status_message_set_layer(s_map_layer);
#else
  s_status_layer = layer_create(bounds);
  status_message_set_layer(s_status_layer);
  layer_add_child(window_layer, s_status_layer);
#endif
#if defined(DOPPLER_LOW_MEMORY)
  frame_strip_set_layer(s_map_layer);
#else
  s_strip_layer = layer_create(bounds);
  frame_strip_set_layer(s_strip_layer);
  layer_add_child(window_layer, s_strip_layer);
#endif
  frame_strip_set_provider(prv_current_frame_slot);
  s_ui_layer = layer_create(bounds);
  ui_set_layer(s_ui_layer);
  layer_add_child(window_layer, s_ui_layer);
  controls_init(window, &s_controls_callbacks);
}

static void prv_window_unload(Window *window) {
  (void)window;
  prv_stop_playback();
  controls_deinit();
  map_set_layer(NULL);
  radar_set_layer(NULL);
  frame_strip_set_provider(NULL);
  frame_strip_set_layer(NULL);
  status_message_set_layer(NULL);
  ui_set_layer(NULL);
  layer_destroy(s_ui_layer);
  s_ui_layer = NULL;
#if !defined(DOPPLER_LOW_MEMORY)
  layer_destroy(s_strip_layer);
  s_strip_layer = NULL;
  layer_destroy(s_status_layer);
  s_status_layer = NULL;
#endif
  layer_destroy(s_map_layer);
  s_map_layer = NULL;
}

static void prv_init(void) {
  config_load();
  s_playing = config_get_autoplay();
  radar_init();
  comm_init();
  comm_set_config_handler(prv_config_changed);
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

  DOPPLER_LOG(APP_LOG_LEVEL_DEBUG, "Done initializing, pushed window: %p", s_window);

  app_event_loop();
  prv_deinit();
}
