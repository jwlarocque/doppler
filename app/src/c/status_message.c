#include <pebble.h>
#include <string.h>

#include "map.h"
#include "radar.h"
#include "status_message.h"

// can't afford animation on aplite and color 64k platforms
#if defined(PBL_PLATFORM_APLITE) || defined(PBL_PLATFORM_BASALT) || defined(PBL_PLATFORM_CHALK)
  #define STATUS_ANIMATED 0
#else
  #define STATUS_ANIMATED 1
#endif

#if PBL_DISPLAY_WIDTH >= 200
  #define STATUS_FONT FONT_KEY_GOTHIC_24_BOLD
  #define STATUS_HEIGHT 30
  #define STATUS_TIME_HEIGHT 30
  #define STATUS_STRIP_HEIGHT 8
  #define STATUS_STRIP_BOTTOM 3
#else
  #define STATUS_FONT FONT_KEY_GOTHIC_18_BOLD
  #define STATUS_HEIGHT 24
  #define STATUS_TIME_HEIGHT 24
  #define STATUS_STRIP_HEIGHT 6
  #define STATUS_STRIP_BOTTOM 2
#endif
#ifdef PBL_ROUND
  #if PBL_DISPLAY_WIDTH >= 200
    #define STATUS_ROUND_EDGE 3
  #else
    #define STATUS_ROUND_EDGE 2
  #endif
  #define STATUS_TIME_GAP 4
#else
  #define STATUS_TIME_GAP 2
#endif
#define STATUS_GAP 2

#if STATUS_ANIMATED
#define STATUS_TRAVEL (STATUS_HEIGHT + STATUS_GAP + STATUS_TIME_HEIGHT + STATUS_TIME_GAP + STATUS_STRIP_HEIGHT + STATUS_STRIP_BOTTOM)
#define STATUS_ENTER_MS 250
#define STATUS_EXIT_MS 200
#endif

#define STATUS_MAX_TEXT 32
#define STATUS_LOADING_TEXT "Loading..."

enum StatusAnimState {
  StatusHidden,
  StatusEntering,
  StatusShown,
  StatusExiting
};

// animated: dedicated layer, prv_status_update
// non-animated: map layer, status_message_draw
static Layer *s_layer;
static GFont s_font = NULL;
// last text, cached for use during exit
static char s_shown[STATUS_MAX_TEXT];
static char s_custom[STATUS_MAX_TEXT];
static bool s_has_custom = false;
static enum StatusAnimState s_state = StatusHidden;
#if STATUS_ANIMATED
static bool s_exiting = false;
static PropertyAnimation *s_anim = NULL;
#endif

// map is missing or no terminal count from radar session
static bool prv_waiting(void) {
  return !map_is_ready() || !radar_is_session_done();
}

static const char *prv_wanted_text(void) {
  if (s_has_custom) {
    return s_custom;
  }
  if (prv_waiting()) {
    return STATUS_LOADING_TEXT;
  }
  return "";
}

static int prv_bar_y(int width, int height) {
#ifdef PBL_ROUND
  int min_dim = width < height ? width : height;
  int strip_top = height / 2 + (min_dim / 2 - STATUS_ROUND_EDGE) -
      STATUS_STRIP_HEIGHT;
#else
  int strip_top = height - STATUS_STRIP_BOTTOM - STATUS_STRIP_HEIGHT;
#endif
  int timestamp_top = strip_top - STATUS_TIME_GAP - STATUS_TIME_HEIGHT;
  return timestamp_top - STATUS_GAP - STATUS_HEIGHT;
}

static void prv_paint(GContext *ctx, int width, int height, int y) {
  GRect bar = GRect(0, y, width, STATUS_HEIGHT);
  graphics_context_set_fill_color(ctx, GColorLightGray);
  graphics_fill_rect(ctx, bar, 0, GCornerNone);
  if (!s_font) {
    return;
  }
  graphics_context_set_text_color(ctx, GColorBlack);
  graphics_draw_text(ctx, s_shown, s_font, bar, GTextOverflowModeFill,
                     GTextAlignmentCenter, NULL);
}

#if STATUS_ANIMATED
static void prv_status_update(Layer *layer, GContext *ctx) {
  if (s_state == StatusHidden || !s_shown[0]) {
    return;
  }
  GRect bounds = layer_get_bounds(layer);
  prv_paint(ctx, bounds.size.w, bounds.size.h,
            prv_bar_y(bounds.size.w, bounds.size.h));
}

static void prv_anim_stopped(Animation *animation, bool finished,
                             void *context) {
  (void)animation;
  (void)context;
  if (finished) {
    s_state = s_exiting ? StatusHidden : StatusShown;
  }
  if (s_state == StatusHidden && s_layer) {
    layer_set_hidden(s_layer, true);
  }
  if (s_anim) {
    property_animation_destroy(s_anim);
    s_anim = NULL;
  }
  if (s_layer) {
    layer_mark_dirty(s_layer);
  }
}

static void prv_start_anim(bool exiting) {
  s_exiting = exiting;
  if (!s_layer) {
    s_state = exiting ? StatusHidden : StatusShown;
    return;
  }
  if (s_anim) {
    animation_unschedule(property_animation_get_animation(s_anim));
  }
  s_state = exiting ? StatusExiting : StatusEntering;
  if (!exiting) {
    layer_set_hidden(s_layer, false);
  }
  GRect frame = layer_get_frame(s_layer);
  GRect to = frame;
  to.origin.y = exiting ? STATUS_TRAVEL : 0;
  if (frame.origin.y == to.origin.y) {
    s_state = exiting ? StatusHidden : StatusShown;
    if (exiting) {
      layer_set_hidden(s_layer, true);
    }
    layer_mark_dirty(s_layer);
    return;
  }
  PropertyAnimation *prop =
      property_animation_create_layer_frame(s_layer, NULL, &to);
  if (!prop) {
    layer_set_frame(s_layer, to);
    s_state = exiting ? StatusHidden : StatusShown;
    if (exiting) {
      layer_set_hidden(s_layer, true);
    }
    layer_mark_dirty(s_layer);
    return;
  }
  Animation *inner = property_animation_get_animation(prop);
  animation_set_duration(inner, exiting ? STATUS_EXIT_MS : STATUS_ENTER_MS);
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
    s_state = exiting ? StatusHidden : StatusShown;
    if (exiting) {
      layer_set_hidden(s_layer, true);
    }
    layer_mark_dirty(s_layer);
  }
}
#endif

void status_message_set_layer(Layer *layer) {
#if STATUS_ANIMATED
  if (s_anim) {
    animation_unschedule(property_animation_get_animation(s_anim));
  }
  s_layer = layer;
  if (!s_layer) {
    s_font = NULL;
    s_shown[0] = '\0';
    s_state = StatusHidden;
    return;
  }
  s_font = fonts_get_system_font(STATUS_FONT);
  layer_set_update_proc(s_layer, prv_status_update);
  GRect frame = layer_get_frame(s_layer);
  frame.origin.y = STATUS_TRAVEL;
  layer_set_frame(s_layer, frame);
  layer_set_hidden(s_layer, true);
  s_shown[0] = '\0';
  s_state = StatusHidden;
  status_message_refresh();
#else
  s_layer = layer;
  if (!s_layer) {
    s_font = NULL;
    s_shown[0] = '\0';
    s_state = StatusHidden;
    return;
  }
  s_font = fonts_get_system_font(STATUS_FONT);
  s_shown[0] = '\0';
  s_state = StatusHidden;
  status_message_refresh();
#endif
}

void status_message_draw(Layer *layer, GContext *ctx) {
#if STATUS_ANIMATED
  (void)layer;
  (void)ctx;
#else
  if (s_state == StatusHidden || !s_shown[0]) {
    return;
  }
  GRect bounds = layer_get_bounds(layer);
  prv_paint(ctx, bounds.size.w, bounds.size.h,
            prv_bar_y(bounds.size.w, bounds.size.h));
#endif
}

void status_message_refresh(void) {
  const char *wanted = prv_wanted_text();
  bool want = wanted[0] != '\0';
  bool onscreen = (s_state == StatusShown || s_state == StatusEntering);
  if (want && !onscreen) {
    if (strcmp(wanted, s_shown) != 0) {
      strncpy(s_shown, wanted, sizeof(s_shown) - 1);
      s_shown[sizeof(s_shown) - 1] = '\0';
    }
#if STATUS_ANIMATED
    s_state = StatusEntering;
    prv_start_anim(false);
    if (s_layer) {
      layer_mark_dirty(s_layer);
    }
#else
    s_state = StatusShown;
    if (s_layer) {
      layer_mark_dirty(s_layer);
    }
#endif
  } else if (!want && onscreen) {
#if STATUS_ANIMATED
    s_state = StatusExiting;
    prv_start_anim(true);
#else
    s_state = StatusHidden;
    if (s_layer) {
      layer_mark_dirty(s_layer);
    }
#endif
  } else if (want && strcmp(wanted, s_shown) != 0) {
    strncpy(s_shown, wanted, sizeof(s_shown) - 1);
    s_shown[sizeof(s_shown) - 1] = '\0';
    if (s_layer) {
      layer_mark_dirty(s_layer);
    }
  }
}

void status_message_set_custom(const char *text) {
  if (!text || !text[0]) {
    s_has_custom = false;
    s_custom[0] = '\0';
  } else {
    strncpy(s_custom, text, sizeof(s_custom) - 1);
    s_custom[sizeof(s_custom) - 1] = '\0';
    s_has_custom = true;
  }
  status_message_refresh();
}
