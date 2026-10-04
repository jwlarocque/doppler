#include <pebble.h>

#include "comm.h"
#include "map.h"
#include "radar.h"

static Window *s_window;
static Layer *s_map_layer;

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
  const uint8_t *radar = radar_is_ready() ? radar_raw() : NULL;
  GRect bounds = layer_get_bounds(layer);
  int16_t height = bounds.size.h;
  if (height > MAP_HEIGHT) {
    height = MAP_HEIGHT;
  }
#ifdef PBL_COLOR
  const uint8_t shades[4] = {
    GColorBlack.argb, GColorDarkGray.argb, GColorLightGray.argb, GColorWhite.argb
  };
#endif
  for (int16_t y = 0; y < height; y++) {
    GBitmapDataRowInfo info = gbitmap_get_data_row_info(framebuffer, (uint16_t)y);
#ifdef PBL_COLOR
    for (int16_t x = info.min_x; x <= info.max_x; x++) {
      uint8_t packed = raw[y * MAP_STRIDE + (x >> 2)];
      uint8_t gray = (packed >> (6 - 2 * (x & 3))) & 3;
      info.data[x] = shades[gray];
    }
    if (radar) {
      for (int16_t x = info.min_x; x <= info.max_x; x++) {
        uint8_t packed = radar[y * RADAR_STRIDE + (x >> 1)];
        uint8_t idx = (x & 1) ? (packed & 15) : (packed >> 4);
        if (idx) {
          info.data[x] = DARK_SKY_GCOLOR[idx];
        }
      }
    }
#else
    // bw watches are rectangular, and our 1bpp data is already in the
    // framebuffer format, so we can just copy whole rows
    int16_t first = info.min_x >> 3;
    int16_t last = info.max_x >> 3;
    memcpy(&info.data[first], &raw[y * MAP_STRIDE + first],
           (size_t)(last - first + 1));
    if (radar) {
      // radar is black-on-transparent
      for (int16_t bx = first; bx <= last; bx++) {
        uint8_t bits = radar[y * RADAR_STRIDE + bx];
        info.data[bx] &= ~bits;
      }
    }
#endif
  }
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
  map_set_layer(NULL);
  radar_set_layer(NULL);
  layer_destroy(s_map_layer);
}

static void prv_init(void) {
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
