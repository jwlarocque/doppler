#include <pebble.h>
#include <string.h>

#include "config.h"

#define PERSIST_KEY_AUTOPLAY 1
#define PERSIST_KEY_PALETTE 2

static bool s_autoplay = AUTOPLAY_DEFAULT;
static Palette s_palette = PALETTE_DEFAULT;

void config_load(void) {
  if (persist_exists(PERSIST_KEY_AUTOPLAY)) {
    s_autoplay = persist_read_bool(PERSIST_KEY_AUTOPLAY);
  } else {
    s_autoplay = AUTOPLAY_DEFAULT;
  }
  if (persist_exists(PERSIST_KEY_PALETTE)) {
    int palette = (int)persist_read_int(PERSIST_KEY_PALETTE);
    s_palette = (palette == PALETTE_NEXRAD) ? PALETTE_NEXRAD : PALETTE_DARKSKY;
  } else {
    s_palette = PALETTE_DEFAULT;
  }
}

// Clay select with string values
static bool prv_parse_palette(Tuple *tuple, Palette *out) {
  if (!tuple || !out) {
    return false;
  }
  if (tuple->type == TUPLE_CSTRING) {
    const char *value = tuple->value->cstring;
    if (strcmp(value, "nexrad") == 0) {
      *out = PALETTE_NEXRAD;
    } else if (strcmp(value, "darksky") == 0) {
      *out = PALETTE_DARKSKY;
    } else {
      return false;
    }
    return true;
  }
  int raw = (int)tuple->value->int32;
  if (raw != PALETTE_DARKSKY && raw != PALETTE_NEXRAD) {
    return false;
  }
  *out = (Palette)raw;
  return true;
}

uint32_t config_handle_inbox(DictionaryIterator *iter) {
  uint32_t changed = CONFIG_CHANGED_NONE;
  Tuple *autoplay_tuple = dict_find(iter, MESSAGE_KEY_Autoplay);
  if (autoplay_tuple) {
    bool autoplay = autoplay_tuple->value->int32 != 0;
    if (autoplay != s_autoplay) {
      s_autoplay = autoplay;
      persist_write_bool(PERSIST_KEY_AUTOPLAY, s_autoplay);
      changed |= CONFIG_CHANGED_AUTOPLAY;
    }
  }
  Tuple *palette_tuple = dict_find(iter, MESSAGE_KEY_Palette);
  if (palette_tuple) {
    Palette palette;
    if (prv_parse_palette(palette_tuple, &palette) && palette != s_palette) {
      s_palette = palette;
      persist_write_int(PERSIST_KEY_PALETTE, (int)s_palette);
      changed |= CONFIG_CHANGED_PALETTE;
    }
  }
  return changed;
}

bool config_get_autoplay(void) {
  return s_autoplay;
}

Palette config_get_palette(void) {
  return s_palette;
}
