#include <pebble.h>
#include <string.h>

#include "config.h"

#define PERSIST_KEY_AUTOPLAY 1

static bool s_autoplay = AUTOPLAY_DEFAULT;

void config_load(void) {
  if (persist_exists(PERSIST_KEY_AUTOPLAY)) {
    s_autoplay = persist_read_bool(PERSIST_KEY_AUTOPLAY);
  } else {
    s_autoplay = AUTOPLAY_DEFAULT;
  }
}

bool config_handle_inbox(DictionaryIterator *iter) {
  Tuple *tuple = dict_find(iter, MESSAGE_KEY_Autoplay);
  if (!tuple) {
    return false;
  }
  bool autoplay = tuple->value->int32 != 0;
  if (autoplay == s_autoplay) {
    return false;
  }
  s_autoplay = autoplay;
  persist_write_bool(PERSIST_KEY_AUTOPLAY, s_autoplay);
  return true;
}

bool config_get_autoplay(void) {
  return s_autoplay;
}
