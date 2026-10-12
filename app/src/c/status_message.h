#pragma once

#include <pebble.h>

void status_message_set_layer(Layer *layer);
// update message bar after map layer update
// (only needed if animation disabled)
void status_message_draw(Layer *layer, GContext *ctx);
// check map/radar readiness and update visibility
void status_message_refresh(void);
// override the loading message with custom text
// cleared by NULL or empty string
void status_message_set_custom(const char *text);
