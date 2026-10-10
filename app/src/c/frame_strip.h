#pragma once

#include <pebble.h>

void frame_strip_set_layer(Layer *layer);
void frame_strip_mark_dirty(void);
// layout went away: fall off screen, then hide
void frame_strip_layout_obsolete(void);
// layout arrived: rise from off screen
void frame_strip_layout_ready(void);
