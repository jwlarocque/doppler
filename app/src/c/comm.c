#include <pebble.h>

#include "comm.h"
#include "map.h"

#define INBOX_SIZE 2048
#define OUTBOX_SIZE 128

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
