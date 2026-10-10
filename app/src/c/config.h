#pragma once

#include <pebble.h>

// persisted settings from Clay + inbox parsing

typedef enum {
  CONFIG_CHANGED_NONE = 0,
  CONFIG_CHANGED_AUTOPLAY = 1 << 0,
  CONFIG_CHANGED_PALETTE = 1 << 1,
} ConfigChanged;

typedef enum {
  PALETTE_DARKSKY,
  PALETTE_NEXRAD,
} Palette;

#define AUTOPLAY_DEFAULT true
#define PALETTE_DEFAULT PALETTE_DARKSKY

// load persisted settings (or defaults)
void config_load(void);

// parse an inbox message, updating and persisting settings
// returns ConfigChanged bitmask
uint32_t config_handle_inbox(DictionaryIterator *iter);

bool config_get_autoplay(void);
Palette config_get_palette(void);
