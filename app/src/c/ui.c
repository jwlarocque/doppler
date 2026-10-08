#include <pebble.h>

#include "ui.h"

// current location marker dimensions in pixels
#define MARKER_ARM 14
#define MARKER_STROKE 2

static Layer *s_layer;
static int16_t s_marker_x;
static int16_t s_marker_y;
static bool s_marker_visible;

static void prv_ui_update(Layer *layer, GContext *ctx) {
  if (!s_marker_visible) {
    return;
  }
#ifdef PBL_COLOR
  graphics_context_set_fill_color(ctx, GColorRed);
#else
  graphics_context_set_fill_color(ctx, GColorBlack);
#endif
  graphics_fill_rect(ctx,
    GRect(s_marker_x - MARKER_ARM / 2, s_marker_y - MARKER_STROKE / 2,
      MARKER_ARM, MARKER_STROKE), 0, GCornerNone);
  graphics_fill_rect(ctx,
    GRect(s_marker_x - MARKER_STROKE / 2, s_marker_y - MARKER_ARM / 2,
      MARKER_STROKE, MARKER_ARM), 0, GCornerNone);
}

void ui_set_layer(Layer *layer) {
  s_layer = layer;
  if (s_layer) {
    layer_set_update_proc(s_layer, prv_ui_update);
  }
}

void ui_set_marker(int16_t x, int16_t y) {
  s_marker_x = x;
  s_marker_y = y;
  s_marker_visible = true;
  if (s_layer) {
    layer_mark_dirty(s_layer);
  }
}

void ui_clear_marker(void) {
  s_marker_visible = false;
  if (s_layer) {
    layer_mark_dirty(s_layer);
  }
}
