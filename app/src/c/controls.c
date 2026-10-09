#include "controls.h"

#include <string.h>

// playback and zoom action bar
// layer 1 (frame mode):
//   - UP/DOWN steps back and forth through radar frames
//   - SELECT enters layer 2 (zoom mode)
// layer 2
//   - UP/DOWN zooms in and out
//   - SELECT toggles playback
// 
// Layer 2 reverts to layer 1 after (2s) delay.
// A long press in layer 1 "pushes through" to layer 2, temporarily entering
// layer 2 and performing the action assigned to the same button.
// Modeled after the stock music app.
enum ActionBarState {
  ActionBarStateFrame,
  ActionBarStateZoom,
  ActionBarStateLongPress,
};

#define ACTION_BAR_TIMEOUT_MS 2000

// short vibe confirmation on push-through
static const uint32_t FEEDBACK_SEGMENTS[] = { 30 };

static ActionBarLayer *s_action_bar;
static enum ActionBarState s_action_bar_state;
static AppTimer *s_action_bar_revert_timer;

static GBitmap *s_icon_left;
static GBitmap *s_icon_right;
static GBitmap *s_icon_ellipsis;
static GBitmap *s_icon_plus;
static GBitmap *s_icon_minus;
static GBitmap *s_icon_play;
static GBitmap *s_icon_pause;

static struct DopplerControlsCallbacks s_callbacks;

static void prv_frame_click_config_provider(void *context);
static void prv_zoom_click_config_provider(void *context);
static void prv_set_action_bar_state(enum ActionBarState state);

static void prv_feedback(void) {
  VibePattern pat = {
    .durations = FEEDBACK_SEGMENTS,
    .num_segments = sizeof(FEEDBACK_SEGMENTS) / sizeof(FEEDBACK_SEGMENTS[0]),
  };
  vibes_enqueue_custom_pattern(pat);
}

static const GBitmap *prv_select_icon(void) {
  if (s_callbacks.is_playing && !s_callbacks.is_playing()) {
    return s_icon_play;
  }
  return s_icon_pause;
}

static void prv_reset_action_bar_revert_timer(void) {
  if (s_action_bar_revert_timer) {
    app_timer_reschedule(s_action_bar_revert_timer, ACTION_BAR_TIMEOUT_MS);
  }
}

static void prv_action_bar_revert(void *context) {
  (void)context;
  s_action_bar_revert_timer = NULL;
  prv_set_action_bar_state(ActionBarStateFrame);
}

static void prv_update_ui_state_frame(bool animated) {
  action_bar_layer_set_click_config_provider(s_action_bar, prv_frame_click_config_provider);
  if (animated) {
    action_bar_layer_set_icon_animated(s_action_bar, BUTTON_ID_UP, s_icon_left, true);
    action_bar_layer_set_icon_animated(s_action_bar, BUTTON_ID_SELECT, s_icon_ellipsis, true);
    action_bar_layer_set_icon_animated(s_action_bar, BUTTON_ID_DOWN, s_icon_right, true);
  } else {
    action_bar_layer_set_icon(s_action_bar, BUTTON_ID_UP, s_icon_left);
    action_bar_layer_set_icon(s_action_bar, BUTTON_ID_SELECT, s_icon_ellipsis);
    action_bar_layer_set_icon(s_action_bar, BUTTON_ID_DOWN, s_icon_right);
  }
}

static void prv_update_ui_state_zoom(bool animated, bool swap_provider) {
  // long press push-through keeps the frame provider armed so the
  // long click end handler still fires on release; only SELECT-entered
  // zoom swaps the provider. Similar to music's volume/long-press UI.
  if (swap_provider) {
    action_bar_layer_set_click_config_provider(s_action_bar, prv_zoom_click_config_provider);
  }
  const GBitmap *select = prv_select_icon();
  if (animated) {
    action_bar_layer_set_icon_animated(s_action_bar, BUTTON_ID_UP, s_icon_minus, true);
    action_bar_layer_set_icon_animated(s_action_bar, BUTTON_ID_SELECT, select, true);
    action_bar_layer_set_icon_animated(s_action_bar, BUTTON_ID_DOWN, s_icon_plus, true);
  } else {
    action_bar_layer_set_icon(s_action_bar, BUTTON_ID_UP, s_icon_minus);
    action_bar_layer_set_icon(s_action_bar, BUTTON_ID_SELECT, select);
    action_bar_layer_set_icon(s_action_bar, BUTTON_ID_DOWN, s_icon_plus);
  }
}

static void prv_set_action_bar_state(enum ActionBarState state) {
  s_action_bar_state = state;
  if (state == ActionBarStateFrame) {
    prv_update_ui_state_frame(true);
  } else if (state == ActionBarStateZoom) {
    prv_update_ui_state_zoom(true, true);
  } else {
    prv_update_ui_state_zoom(true, false);
  }
}

static void prv_frame_prev_handler(ClickRecognizerRef recognizer, void *context) {
  (void)recognizer;
  (void)context;
  if (s_callbacks.frame_step) {
    s_callbacks.frame_step(-1);
  }
}

static void prv_frame_next_handler(ClickRecognizerRef recognizer, void *context) {
  (void)recognizer;
  (void)context;
  if (s_callbacks.frame_step) {
    s_callbacks.frame_step(1);
  }
}

static void prv_enter_zoom_handler(ClickRecognizerRef recognizer, void *context) {
  (void)recognizer;
  (void)context;
  if (s_action_bar_revert_timer) {
    app_timer_cancel(s_action_bar_revert_timer);
  }
  s_action_bar_revert_timer = app_timer_register(ACTION_BAR_TIMEOUT_MS, prv_action_bar_revert, NULL);
  prv_set_action_bar_state(ActionBarStateZoom);
}

static void prv_zoom_out_handler(ClickRecognizerRef recognizer, void *context) {
  (void)recognizer;
  (void)context;
  prv_reset_action_bar_revert_timer();
  if (s_callbacks.zoom) {
    s_callbacks.zoom(-1);
  }
}

static void prv_zoom_in_handler(ClickRecognizerRef recognizer, void *context) {
  (void)recognizer;
  (void)context;
  prv_reset_action_bar_revert_timer();
  if (s_callbacks.zoom) {
    s_callbacks.zoom(1);
  }
}

static void prv_zoom_long_start_handler(ClickRecognizerRef recognizer, void *context) {
  (void)context;
  int delta = (click_recognizer_get_button_id(recognizer) == BUTTON_ID_UP) ? -1 : 1;
  if (s_callbacks.zoom) {
    s_callbacks.zoom(delta);
  }
  prv_set_action_bar_state(ActionBarStateLongPress);
  prv_feedback();
}

static void prv_zoom_long_end_handler(ClickRecognizerRef recognizer, void *context) {
  (void)recognizer;
  (void)context;
  prv_set_action_bar_state(ActionBarStateFrame);
}

static void prv_play_pause_handler(ClickRecognizerRef recognizer, void *context) {
  (void)recognizer;
  (void)context;
  prv_reset_action_bar_revert_timer();
  if (s_callbacks.toggle_play) {
    s_callbacks.toggle_play();
  }
}

static void prv_play_pause_long_start_handler(ClickRecognizerRef recognizer, void *context) {
  (void)recognizer;
  (void)context;
  if (s_callbacks.toggle_play) {
    s_callbacks.toggle_play();
  }
  prv_set_action_bar_state(ActionBarStateLongPress);
  prv_feedback();
}

static void prv_play_pause_long_end_handler(ClickRecognizerRef recognizer, void *context) {
  (void)recognizer;
  (void)context;
  prv_set_action_bar_state(ActionBarStateFrame);
}

static void prv_frame_click_config_provider(void *context) {
  (void)context;
  window_single_click_subscribe(BUTTON_ID_UP, prv_frame_prev_handler);
  window_single_click_subscribe(BUTTON_ID_DOWN, prv_frame_next_handler);
  window_single_click_subscribe(BUTTON_ID_SELECT, prv_enter_zoom_handler);
  // delay 0 defaults to 500ms
  window_long_click_subscribe(BUTTON_ID_UP, 0, prv_zoom_long_start_handler,
                              prv_zoom_long_end_handler);
  window_long_click_subscribe(BUTTON_ID_DOWN, 0, prv_zoom_long_start_handler,
                              prv_zoom_long_end_handler);
  window_long_click_subscribe(BUTTON_ID_SELECT, 0, prv_play_pause_long_start_handler,
                              prv_play_pause_long_end_handler);
}

static void prv_zoom_click_config_provider(void *context) {
  (void)context;
  window_single_click_subscribe(BUTTON_ID_UP, prv_zoom_out_handler);
  window_single_click_subscribe(BUTTON_ID_DOWN, prv_zoom_in_handler);
  window_single_click_subscribe(BUTTON_ID_SELECT, prv_play_pause_handler);
}

static void prv_destroy_action_bar_icons(void) {
  gbitmap_destroy(s_icon_left);
  gbitmap_destroy(s_icon_right);
  gbitmap_destroy(s_icon_ellipsis);
  gbitmap_destroy(s_icon_plus);
  gbitmap_destroy(s_icon_minus);
  gbitmap_destroy(s_icon_play);
  gbitmap_destroy(s_icon_pause);
  s_icon_left = NULL;
  s_icon_right = NULL;
  s_icon_ellipsis = NULL;
  s_icon_plus = NULL;
  s_icon_minus = NULL;
  s_icon_play = NULL;
  s_icon_pause = NULL;
}

void controls_init(Window *window, const struct DopplerControlsCallbacks *callbacks) {
  if (callbacks) {
    s_callbacks = *callbacks;
  } else {
    memset(&s_callbacks, 0, sizeof(s_callbacks));
  }
  s_icon_left = gbitmap_create_with_resource(RESOURCE_ID_ICON_LEFT);
  s_icon_right = gbitmap_create_with_resource(RESOURCE_ID_ICON_RIGHT);
  s_icon_ellipsis = gbitmap_create_with_resource(RESOURCE_ID_ICON_ELLIPSIS);
  s_icon_plus = gbitmap_create_with_resource(RESOURCE_ID_ICON_PLUS);
  s_icon_minus = gbitmap_create_with_resource(RESOURCE_ID_ICON_MINUS);
  s_icon_play = gbitmap_create_with_resource(RESOURCE_ID_ICON_PLAY);
  s_icon_pause = gbitmap_create_with_resource(RESOURCE_ID_ICON_PAUSE);

  s_action_bar_state = ActionBarStateFrame;
  s_action_bar = action_bar_layer_create();
  action_bar_layer_add_to_window(s_action_bar, window);
  action_bar_layer_set_background_color(s_action_bar, GColorClear);
  prv_update_ui_state_frame(false);
}

void controls_deinit(void) {
  if (s_action_bar_revert_timer) {
    app_timer_cancel(s_action_bar_revert_timer);
    s_action_bar_revert_timer = NULL;
  }
  if (s_action_bar) {
    action_bar_layer_remove_from_window(s_action_bar);
    action_bar_layer_destroy(s_action_bar);
    s_action_bar = NULL;
  }
  prv_destroy_action_bar_icons();
  memset(&s_callbacks, 0, sizeof(s_callbacks));
}

void controls_refresh_play_icon(void) {
  if (!s_action_bar) {
    return;
  }
  if (s_action_bar_state == ActionBarStateFrame) {
    return;
  }
  action_bar_layer_set_icon_animated(s_action_bar, BUTTON_ID_SELECT, prv_select_icon(), true);
}
