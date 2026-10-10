#pragma once

#include <pebble.h>

void frame_strip_set_layer(Layer *layer);
void frame_strip_mark_dirty(void);
// layout slot to highlight, or -1 to hide
typedef int (*FrameStripCurrentFrameProvider)(void);
void frame_strip_set_provider(FrameStripCurrentFrameProvider provider);
// re-read the provider, slide the indicator if it moved, repaint
void frame_strip_refresh_current_frame(void);
// layout went away: fall off screen, then hide
void frame_strip_layout_obsolete(void);
// layout arrived: rise from off screen
void frame_strip_layout_ready(void);
