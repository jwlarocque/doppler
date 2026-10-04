#include <pebble.h>

#include "comm.h"
#include "map.h"
#include "radar.h"

#define OUTBOX_SIZE 128

#if defined(PBL_PLATFORM_APLITE)
#define INBOX_SIZE 512
#else
#define INBOX_SIZE 2048
#endif

static void prv_inbox_received(DictionaryIterator *iter, void *context) {
  Tuple *length_tuple = dict_find(iter, MESSAGE_KEY_MapLength);
  if (length_tuple) {
    map_begin(length_tuple->value->int32);
    return;
  }
  Tuple *chunk_tuple = dict_find(iter, MESSAGE_KEY_MapChunk);
  if (chunk_tuple) {
    Tuple *index_tuple = dict_find(iter, MESSAGE_KEY_MapIndex);
    int32_t index = index_tuple ? index_tuple->value->int32 : 0;
    map_chunk(chunk_tuple->value->data, chunk_tuple->length, index);
    return;
  }
  Tuple *done_tuple = dict_find(iter, MESSAGE_KEY_MapDone);
  if (done_tuple) {
    map_complete(done_tuple->value->int32);
    return;
  }
  Tuple *radar_length_tuple = dict_find(iter, MESSAGE_KEY_RadarLength);
  if (radar_length_tuple) {
    radar_begin(radar_length_tuple->value->int32);
    return;
  }
  Tuple *radar_chunk_tuple = dict_find(iter, MESSAGE_KEY_RadarChunk);
  if (radar_chunk_tuple) {
    Tuple *index_tuple = dict_find(iter, MESSAGE_KEY_RadarIndex);
    int32_t index = index_tuple ? index_tuple->value->int32 : 0;
    radar_chunk(radar_chunk_tuple->value->data, radar_chunk_tuple->length, index);
    return;
  }
  Tuple *radar_done_tuple = dict_find(iter, MESSAGE_KEY_RadarDone);
  if (radar_done_tuple) {
    radar_complete(radar_done_tuple->value->int32);
  }
}

static void prv_inbox_dropped(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_ERROR, "inbox dropped, reason %d", (int)reason);
}

void comm_init(void) {
  app_message_register_inbox_received(prv_inbox_received);
  app_message_register_inbox_dropped(prv_inbox_dropped);
  app_message_open(INBOX_SIZE, OUTBOX_SIZE);
}
