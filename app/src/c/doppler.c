#include <pebble.h>

#include "comm.h"
#include "map.h"

static Window *s_window;
static Layer *s_map_layer;


static void prv_map_update(Layer *layer, GContext *ctx) {
  if (!map_is_ready()) {
    return;
  }
  GBitmap *framebuffer = graphics_capture_frame_buffer(ctx);
  GRect bounds = layer_get_bounds(layer);
  for (int y = 0; y < bounds.size.h; y++) {
    GBitmapDataRowInfo info = gbitmap_get_data_row_info(framebuffer, y);
    memcpy(&info.data[info.min_x / 8], map_raw() + y * MAP_STRIDE, MAP_STRIDE);
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
}

static void prv_window_unload(Window *window) {
  map_set_layer(NULL);
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
