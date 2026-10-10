#pragma once

#include <pebble.h>

// persisted settings from Clay + inbox parsing

#define AUTOPLAY_DEFAULT true

// load persisted settings (or defaults)
void config_load(void);

bool config_handle_inbox(DictionaryIterator *iter);

bool config_get_autoplay(void);
