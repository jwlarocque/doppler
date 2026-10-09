#pragma once

#include <pebble.h>

// domain actions from doppler.c
struct DopplerControlsCallbacks {
  void (*frame_step)(int delta);
  void (*zoom)(int delta);
  void (*toggle_play)(void);
  bool (*is_playing)(void);
};

void controls_init(Window *window, const struct DopplerControlsCallbacks *callbacks);
void controls_deinit(void);
// refresh the SELECT icon when playback state changes
void controls_refresh_play_icon(void);
