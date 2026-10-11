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
#define STRIP_MAX_WIDTH 32

#ifdef PBL_ROUND
  #if PBL_DISPLAY_WIDTH >= 200
    #define ROUND_EDGE 3
    #define ROUND_SECTION_PX 10
  #else
    #define ROUND_EDGE 2
    #define ROUND_SECTION_PX 8
  #endif
#endif

#define STRIP_TRAVEL (STRIP_HEIGHT + STRIP_BOTTOM)
#define STRIP_EXIT_MS 200
#define STRIP_ENTER_MS 250
#define STRIP_SLIDE_MS 100

// indicator position in 256ths of a segment
#define SLIDE_UNIT 256

// ease-out-back curve constants scaled by 65535
#define EASE_C1 131070 // 2
#define EASE_C3 196605 // 3

enum StripState {
  StripHidden,
  StripEntering,
  StripShown,
  StripExiting
};

static Layer *s_layer;
static enum StripState s_state = StripHidden;
static bool s_exiting;
static PropertyAnimation *s_anim;

static FrameStripCurrentFrameProvider s_provider;
static int s_target = -1;
static int16_t s_pos = 0;
static int16_t s_slide_from;
static int16_t s_slide_to;
static Animation *s_slide_anim;
// cache last layout, for use in the strip exit animation
static int s_cached_num = 0;
static int s_cached_live = 0;
static bool s_cached_resident[RADAR_MAX_FRAMES];

static int prv_clamped_count(int num_frames) {
  if (num_frames < 1) {
    return 1;
  }
  if (num_frames > RADAR_MAX_FRAMES) {
    return RADAR_MAX_FRAMES;
  }
  return num_frames;
}

// strip position is the layout slot
static GColor prv_fill_for_slot(int slot, int live_slot, int num_frames,
                                bool resident) {
  if (slot < 0 || slot >= num_frames) {
#ifdef PBL_COLOR
    return GColorDarkGray;
#else
    return GColorBlack;
#endif
  }
  if (!resident) {
    return GColorLightGray;
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
static bool prv_rect_geometry(int width, int height, int count,
                              int *x0, int *pitch, int *rect_w, int *y0) {
  count = prv_clamped_count(count);
  int w = (width - 2 * STRIP_MARGIN - (count - 1) * STRIP_GAP) / count;
  if (w < 3) {
    return false;
  }
  if (w > STRIP_MAX_WIDTH) {
    w = STRIP_MAX_WIDTH;
  }
  int total = count * w + (count - 1) * STRIP_GAP;
  *x0 = (width - total) / 2;
  *pitch = w + STRIP_GAP;
  *rect_w = w;
  *y0 = height - STRIP_BOTTOM - STRIP_HEIGHT;
  return true;
}

static void prv_draw_rect(GContext *ctx, int width, int height, int num_frames,
                          int live_slot, bool use_cache) {
  int x0, pitch, rect_w, y0;
  if (!prv_rect_geometry(width, height, num_frames, &x0, &pitch,
                         &rect_w, &y0)) {
    return;
  }
  int count = prv_clamped_count(num_frames);
  for (int pos = 0; pos < count; pos++) {
    int x = x0 + pos * pitch;
    bool resident = use_cache ? s_cached_resident[pos]
                              : radar_slot_resident(pos);
    GColor fill = prv_fill_for_slot(pos, live_slot, num_frames, resident);
    graphics_context_set_fill_color(ctx, GColorBlack);
    graphics_fill_rect(ctx, GRect(x, y0, rect_w, STRIP_HEIGHT), 0, GCornerNone);
    graphics_context_set_fill_color(ctx, fill);
    graphics_fill_rect(ctx, GRect(x + 1, y0 + 1, rect_w - 2, STRIP_HEIGHT - 2),
                       0, GCornerNone);
  }
}

static void prv_draw_rect_indicator(GContext *ctx, int width, int height,
                                     int num_frames) {
  int x0, pitch, rect_w, y0;
  if (!prv_rect_geometry(width, height, num_frames, &x0, &pitch,
                         &rect_w, &y0)) {
    return;
  }
  int x = x0 + (s_pos * pitch + SLIDE_UNIT / 2) / SLIDE_UNIT;
  graphics_context_set_fill_color(ctx, GColorBlack);
  graphics_fill_rect(ctx, GRect(x - 1, y0 - 1, rect_w + 2, STRIP_HEIGHT + 2),
                     0, GCornerNone);
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

static bool prv_round_geometry(int width, int height, int count, int *cx,
                               int *cy, int *radius_out, int32_t *start,
                               int32_t *section, int32_t *gap,
                               int32_t *border) {
  count = prv_clamped_count(count);
  int radius = (width < height ? width : height) / 2 - ROUND_EDGE;
  int mid = radius - STRIP_HEIGHT / 2;
  if (mid <= 0) {
    return false;
  }
  int32_t sec = prv_px_to_trig(ROUND_SECTION_PX, mid);
  int32_t bdr = prv_px_to_trig(1, mid);
  if (sec <= 2 * bdr) {
    return false;
  }
  int32_t gp = prv_px_to_trig(STRIP_GAP, mid);
  *cx = width / 2;
  *cy = height / 2;
  *radius_out = radius;
  *section = sec;
  *gap = gp;
  *border = bdr;
  *start = TRIG_MAX_ANGLE / 2 +
      (count * sec + (count - 1) * gp) / 2;
  return true;
}

static void prv_draw_round(GContext *ctx, int width, int height, int num_frames,
                           int live_slot, bool use_cache) {
  int cx, cy, radius_out;
  int32_t start, section, gap, border;
  if (!prv_round_geometry(width, height, num_frames, &cx, &cy,
                           &radius_out, &start, &section, &gap, &border)) {
    return;
  }
  int count = prv_clamped_count(num_frames);
  GRect outer = GRect(cx - radius_out, cy - radius_out,
                      2 * radius_out, 2 * radius_out);
  int radius_in = radius_out - 1;
  GRect inner = GRect(cx - radius_in, cy - radius_in,
                      2 * radius_in, 2 * radius_in);
  for (int pos = 0; pos < count; pos++) {
    int32_t a0, a1;
    prv_segment_angles(pos, start, section, gap, &a0, &a1);
    bool resident = use_cache ? s_cached_resident[pos]
                              : radar_slot_resident(pos);
    GColor fill = prv_fill_for_slot(pos, live_slot, num_frames, resident);
    graphics_context_set_fill_color(ctx, GColorBlack);
    graphics_fill_radial(ctx, outer, GOvalScaleModeFitCircle, STRIP_HEIGHT,
                         a0, a1);
    graphics_context_set_fill_color(ctx, fill);
    graphics_fill_radial(ctx, inner, GOvalScaleModeFitCircle, STRIP_HEIGHT - 2,
                         a0 + border, a1 - border);
  }
}

static void prv_draw_round_indicator(GContext *ctx, int width, int height,
                                     int num_frames) {
  int cx, cy, radius_out;
  int32_t start, section, gap, border;
  if (!prv_round_geometry(width, height, num_frames, &cx, &cy,
                          &radius_out, &start, &section, &gap, &border)) {
    return;
  }
  int32_t center = start -
      (int32_t)((s_pos * (section + gap) + SLIDE_UNIT / 2) / SLIDE_UNIT) -
      section / 2;
  int32_t half = section / 2 + border;
  int r = radius_out + 1;
  graphics_context_set_fill_color(ctx, GColorBlack);
  graphics_fill_radial(ctx, GRect(cx - r, cy - r, 2 * r, 2 * r),
                       GOvalScaleModeFitCircle, STRIP_HEIGHT + 2,
                       center - half, center + half);
}
#endif

static void prv_draw(GContext *ctx, int width, int height, int num_frames,
                     int live_slot, bool use_cache) {
#ifdef PBL_ROUND
  prv_draw_round(ctx, width, height, num_frames, live_slot, use_cache);
#else
  prv_draw_rect(ctx, width, height, num_frames, live_slot, use_cache);
#endif
}

static void prv_draw_indicator(GContext *ctx, int width, int height,
                               int num_frames) {
#ifdef PBL_ROUND
  prv_draw_round_indicator(ctx, width, height, num_frames);
#else
  prv_draw_rect_indicator(ctx, width, height, num_frames);
#endif
}

static void prv_frame_strip_update(Layer *layer, GContext *ctx) {
  if (s_state == StripHidden) {
    return;
  }
  GRect bounds = layer_get_bounds(layer);
  if (s_state == StripExiting) {
    if (s_cached_num <= 0) {
      return;
    }
    prv_draw(ctx, bounds.size.w, bounds.size.h, s_cached_num, s_cached_live,
             true);
    return;
  }
  if (!radar_has_layout()) {
    return;
  }
  int num_frames = radar_num_frames();
  int live_slot = radar_live_slot();
  if (num_frames <= 0 || live_slot < 0 || live_slot >= num_frames) {
    return;
  }
  s_cached_num = num_frames;
  s_cached_live = live_slot;
  for (int i = 0; i < num_frames; i++) {
    s_cached_resident[i] = radar_slot_resident(i);
  }
  if (s_state == StripShown && s_target >= 0) {
    prv_draw_indicator(ctx, bounds.size.w, bounds.size.h, num_frames);
  }
  prv_draw(ctx, bounds.size.w, bounds.size.h, num_frames, live_slot, false);
}

static void prv_anim_stopped(Animation *animation, bool finished,
                             void *context) {
  (void)animation;
  (void)context;
  if (finished) {
    s_state = s_exiting ? StripHidden : StripShown;
  }
  if (s_state == StripHidden && s_layer) {
    layer_set_hidden(s_layer, true);
  }
  if (s_anim) {
    property_animation_destroy(s_anim);
    s_anim = NULL;
  }
  frame_strip_mark_dirty();
}

static void prv_start_anim(bool exiting) {
  if (!s_layer) {
    s_state = exiting ? StripHidden : StripShown;
    return;
  }
  if (s_anim) {
    animation_unschedule(property_animation_get_animation(s_anim));
  }
  s_exiting = exiting;
  s_state = exiting ? StripExiting : StripEntering;
  if (!exiting) {
    layer_set_hidden(s_layer, false);
  }
  GRect frame = layer_get_frame(s_layer);
  GRect to = frame;
  to.origin.y = exiting ? STRIP_TRAVEL : 0;
  if (frame.origin.y == to.origin.y) {
    s_state = exiting ? StripHidden : StripShown;
    if (exiting) {
      layer_set_hidden(s_layer, true);
    }
    frame_strip_mark_dirty();
    return;
  }
  PropertyAnimation *prop =
      property_animation_create_layer_frame(s_layer, NULL, &to);
  if (!prop) {
    layer_set_frame(s_layer, to);
    s_state = exiting ? StripHidden : StripShown;
    if (exiting) {
      layer_set_hidden(s_layer, true);
    }
    frame_strip_mark_dirty();
    return;
  }
  Animation *inner = property_animation_get_animation(prop);
  animation_set_duration(inner, exiting ? STRIP_EXIT_MS : STRIP_ENTER_MS);
  animation_set_curve(inner,
                      exiting ? AnimationCurveEaseIn : AnimationCurveEaseOut);
  animation_set_handlers(inner,
                         (AnimationHandlers){ .started = NULL,
                                              .stopped = prv_anim_stopped },
                         NULL);
  s_anim = prop;
  if (!animation_schedule(inner)) {
    property_animation_destroy(prop);
    s_anim = NULL;
    layer_set_frame(s_layer, to);
    s_state = exiting ? StripHidden : StripShown;
    if (exiting) {
      layer_set_hidden(s_layer, true);
    }
    frame_strip_mark_dirty();
  }
}

// ease-out-back with ~20% overshoot
static AnimationProgress prv_ease_out_back(AnimationProgress progress) {
  if (progress == 0) {
    return 0;
  }
  int32_t u = (int32_t)progress - ANIMATION_NORMALIZED_MAX;
  int64_t u2 = (int64_t)u * u / ANIMATION_NORMALIZED_MAX;
  int64_t u3 = u2 * u / ANIMATION_NORMALIZED_MAX;
  int64_t eased = (int64_t)ANIMATION_NORMALIZED_MAX +
      (EASE_C3 * u3 + EASE_C1 * u2) / ANIMATION_NORMALIZED_MAX;
  if (eased < 0) {
    eased = 0;
  }
  return (AnimationProgress)eased;
}

static void prv_slide_update(Animation *animation, AnimationProgress progress) {
  (void)animation;
  s_pos = s_slide_from + (int16_t)(((int32_t)(s_slide_to - s_slide_from) *
      (int32_t)progress) / ANIMATION_NORMALIZED_MAX);
  frame_strip_mark_dirty();
}

static void prv_slide_stopped(Animation *animation, bool finished,
                              void *context) {
  (void)context;
  if (finished) {
    s_pos = s_slide_to;
  }
  animation_destroy(animation);
  s_slide_anim = NULL;
  frame_strip_mark_dirty();
}

static void prv_start_slide(int16_t from, int16_t to) {
  if (s_slide_anim) {
    animation_unschedule(s_slide_anim);
  }
  s_slide_from = from;
  s_slide_to = to;
  s_pos = from;
  Animation *animation = animation_create();
  if (!animation) {
    s_pos = to;
    frame_strip_mark_dirty();
    return;
  }
  static const AnimationImplementation impl = {
    .setup = NULL,
    .update = prv_slide_update,
    .teardown = NULL,
  };
  animation_set_duration(animation, STRIP_SLIDE_MS);
  if (!animation_set_custom_curve(animation, prv_ease_out_back)) {
    animation_set_curve(animation, AnimationCurveEaseOut);
  }
  animation_set_implementation(animation, &impl);
  animation_set_handlers(animation,
                         (AnimationHandlers){ .started = NULL,
                                              .stopped = prv_slide_stopped },
                         NULL);
  s_slide_anim = animation;
  if (!animation_schedule(animation)) {
    animation_destroy(animation);
    s_slide_anim = NULL;
    s_pos = to;
    frame_strip_mark_dirty();
  }
}

static void prv_stop_slide(void) {
  if (s_slide_anim) {
    animation_unschedule(s_slide_anim);
  }
}

void frame_strip_set_layer(Layer *layer) {
  if (!layer) {
    if (s_anim) {
      animation_unschedule(property_animation_get_animation(s_anim));
    }
    prv_stop_slide();
    s_layer = NULL;
    s_target = -1;
    s_cached_num = 0;
    s_cached_live = 0;
    s_state = StripHidden;
    return;
  }
  s_layer = layer;
  layer_set_update_proc(s_layer, prv_frame_strip_update);
  GRect frame = layer_get_frame(s_layer);
  frame.origin.y = STRIP_TRAVEL;
  layer_set_frame(s_layer, frame);
  layer_set_hidden(s_layer, true);
}

void frame_strip_set_provider(FrameStripCurrentFrameProvider provider) {
  s_provider = provider;
}

void frame_strip_mark_dirty(void) {
  if (s_layer) {
    layer_mark_dirty(s_layer);
  }
}

void frame_strip_refresh_current_frame(void) {
  int target = s_provider ? s_provider() : -1;
  if (target < 0) {
    prv_stop_slide();
    s_target = -1;
  } else if (s_target < 0) {
    prv_stop_slide();
    s_target = target;
    s_pos = (int16_t)(target * SLIDE_UNIT);
  } else if (target != s_target) {
    bool adjacent = (target == s_target + 1) || (target == s_target - 1);
    s_target = target;
    if (adjacent) {
      prv_start_slide(s_pos, (int16_t)(target * SLIDE_UNIT));
    } else {
      prv_stop_slide();
      s_pos = (int16_t)(target * SLIDE_UNIT);
    }
  }
  frame_strip_mark_dirty();
}

void frame_strip_layout_obsolete(void) {
  prv_stop_slide();
  s_target = -1;
  prv_start_anim(true);
}

void frame_strip_layout_ready(void) {
  frame_strip_refresh_current_frame();
  prv_start_anim(false);
}
