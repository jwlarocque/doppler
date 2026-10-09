#include <pebble.h>

#include "frame_strip.h"
#include "radar.h"

#if PBL_DISPLAY_WIDTH >= 200
  #define STRIP_HEIGHT 8
  #define STRIP_GAP 3
  #define STRIP_MARGIN 3
  #define STRIP_BOTTOM 3
#else
  #define STRIP_HEIGHT 6
  #define STRIP_GAP 2
  #define STRIP_MARGIN 2
  #define STRIP_BOTTOM 2
#endif

#ifdef PBL_ROUND
  #if PBL_DISPLAY_WIDTH >= 200
    #define ROUND_EDGE 3
    #define ROUND_SECTION_PX 10
  #else
    #define ROUND_EDGE 2
    #define ROUND_SECTION_PX 8
  #endif
#endif

static Layer *s_layer;

// strip position to layout slot
static int prv_slot_at_pos(int pos, int live_slot) {
  int live_pos = RADAR_PAST_MAX - 1;
  return pos - (live_pos - live_slot);
}

static GColor prv_fill_for_slot(int slot, int live_slot, int num_frames) {
  if (slot < 0 || slot >= num_frames) {
#ifdef PBL_COLOR
    return GColorDarkGray;
#else
    return GColorBlack;
#endif
  }
  if (!radar_slot_resident(slot)) {
#ifdef PBL_COLOR
    return GColorLightGray;
#else
    return GColorDarkGray;
#endif
  }
  if (slot == live_slot) {
#ifdef PBL_COLOR
    return GColorRed;
#else
    return GColorDarkGray;
#endif
  }
  if (slot > live_slot) {
#ifdef PBL_COLOR
    return GColorCeleste;
#else
    return GColorWhite;
#endif
  }
  return GColorWhite;
}

#ifndef PBL_ROUND
static void prv_draw_rect(GContext *ctx, int width, int height, int num_frames,
                          int live_slot) {
  int count = RADAR_MAX_FRAMES;
  int rect_w = (width - 2 * STRIP_MARGIN - (count - 1) * STRIP_GAP) / count;
  if (rect_w < 3) {
    return;
  }
  int total = count * rect_w + (count - 1) * STRIP_GAP;
  int x0 = (width - total) / 2;
  int y0 = height - STRIP_BOTTOM - STRIP_HEIGHT;
  for (int pos = 0; pos < count; pos++) {
    int slot = prv_slot_at_pos(pos, live_slot);
    int x = x0 + pos * (rect_w + STRIP_GAP);
    graphics_context_set_fill_color(ctx, GColorBlack);
    graphics_fill_rect(ctx, GRect(x, y0, rect_w, STRIP_HEIGHT), 0, GCornerNone);
    graphics_context_set_fill_color(ctx, prv_fill_for_slot(slot, live_slot, num_frames));
    graphics_fill_rect(ctx, GRect(x + 1, y0 + 1, rect_w - 2, STRIP_HEIGHT - 2),
                       0, GCornerNone);
  }
}
#else
// arc length in px at the given radius to trig angle units
static int32_t prv_px_to_trig(int px, int radius) {
  int32_t circ = (radius * 62832 + 5000) / 10000;
  if (circ <= 0) {
    return 0;
  }
  return (px * TRIG_MAX_ANGLE + circ / 2) / circ;
}

static void prv_segment_angles(int pos, int32_t start, int32_t section,
                               int32_t gap, int32_t *a0_out, int32_t *a1_out) {
  int32_t a1 = start - pos * (section + gap);
  *a0_out = a1 - section;
  *a1_out = a1;
}

static void prv_draw_round(GContext *ctx, int width, int height, int num_frames,
                           int live_slot) {
  int count = RADAR_MAX_FRAMES;
  int radius_out = (width < height ? width : height) / 2 - ROUND_EDGE;
  int radius_mid = radius_out - STRIP_HEIGHT / 2;
  if (radius_mid <= 0) {
    return;
  }
  int32_t section = prv_px_to_trig(ROUND_SECTION_PX, radius_mid);
  int32_t gap = prv_px_to_trig(STRIP_GAP, radius_mid);
  int32_t border = prv_px_to_trig(1, radius_mid);
  if (section <= 2 * border) {
    return;
  }
  int32_t total = count * section + (count - 1) * gap;
  int32_t start = TRIG_MAX_ANGLE / 2 + total / 2;
  int16_t cx = width / 2;
  int16_t cy = height / 2;
  GRect outer = GRect(cx - radius_out, cy - radius_out,
                      2 * radius_out, 2 * radius_out);
  int radius_in = radius_out - 1;
  GRect inner = GRect(cx - radius_in, cy - radius_in,
                      2 * radius_in, 2 * radius_in);
  for (int pos = 0; pos < count; pos++) {
    int slot = prv_slot_at_pos(pos, live_slot);
    int32_t a0, a1;
    prv_segment_angles(pos, start, section, gap, &a0, &a1);
    graphics_context_set_fill_color(ctx, GColorBlack);
    graphics_fill_radial(ctx, outer, GOvalScaleModeFitCircle, STRIP_HEIGHT,
                         a0, a1);
    graphics_context_set_fill_color(ctx, prv_fill_for_slot(slot, live_slot, num_frames));
    graphics_fill_radial(ctx, inner, GOvalScaleModeFitCircle, STRIP_HEIGHT - 2,
                         a0 + border, a1 - border);
  }
}
#endif

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
#ifdef PBL_ROUND
  prv_draw_round(ctx, bounds.size.w, bounds.size.h, num_frames, live_slot);
#else
  prv_draw_rect(ctx, bounds.size.w, bounds.size.h, num_frames, live_slot);
#endif
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
