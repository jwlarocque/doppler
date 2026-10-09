#include <pebble.h>

#include "frame_strip.h"
#include "radar.h"

#define STRIP_HEIGHT 6
#define STRIP_GAP 2
#define STRIP_MARGIN 2
#define STRIP_BOTTOM 2

static Layer *s_layer;

static void prv_frame_strip_update(Layer *layer, GContext *ctx) {
  if (!radar_has_layout()) {
    return;
  }
  int num_frames = radar_num_frames();
  int live_slot = radar_live_slot();
  if (num_frames <= 0 || live_slot < 0 || live_slot >= num_frames) {
    return;
  }
  GRect bounds = layer_get_bounds(layer);
  int16_t width = bounds.size.w;
  int16_t height = bounds.size.h;
  int count = RADAR_MAX_FRAMES;
  int rect_w = (width - 2 * STRIP_MARGIN - (count - 1) * STRIP_GAP) / count;
  if (rect_w < 3) {
    return;
  }
  int total = count * rect_w + (count - 1) * STRIP_GAP;
  int x0 = (width - total) / 2;
  int y0 = height - STRIP_BOTTOM - STRIP_HEIGHT;
  // keep the live slot at a fixed index
  int live_pos = RADAR_PAST_MAX - 1;
  int slot_offset = live_pos - live_slot;
  for (int pos = 0; pos < count; pos++) {
    int slot = pos - slot_offset;
    int x = x0 + pos * (rect_w + STRIP_GAP);
    graphics_context_set_fill_color(ctx, GColorBlack);
    graphics_fill_rect(ctx, GRect(x, y0, rect_w, STRIP_HEIGHT), 0, GCornerNone);
    GColor fill;
    if (slot < 0 || slot >= num_frames) {
#ifdef PBL_COLOR
      fill = GColorDarkGray;
#else
      fill = GColorBlack;
#endif
    } else if (!radar_slot_resident(slot)) {
#ifdef PBL_COLOR
      fill = GColorLightGray;
#else
      fill = GColorDarkGray;
#endif
    } else if (slot == live_slot) {
#ifdef PBL_COLOR
      fill = GColorRed;
#else
      fill = GColorDarkGray;
#endif
    } else if (slot > live_slot) {
#ifdef PBL_COLOR
      fill = GColorCeleste;
#else
      fill = GColorWhite;
#endif
    } else {
      fill = GColorWhite;
    }
    graphics_context_set_fill_color(ctx, fill);
    graphics_fill_rect(ctx, GRect(x + 1, y0 + 1, rect_w - 2, STRIP_HEIGHT - 2),
                       0, GCornerNone);
  }
}

void frame_strip_set_layer(Layer *layer) {
  s_layer = layer;
  if (s_layer) {
    layer_set_update_proc(s_layer, prv_frame_strip_update);
  }
}

void frame_strip_mark_dirty(void) {
  if (s_layer) {
    layer_mark_dirty(s_layer);
  }
}
