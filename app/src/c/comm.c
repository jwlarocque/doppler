#include <pebble.h>

#include "comm.h"
#include "map.h"
#include "radar.h"
#include "ui.h"

#define OUTBOX_SIZE 128

#if defined(PBL_PLATFORM_APLITE)
#define INBOX_SIZE 512
#else
#define INBOX_SIZE 2048
#endif

// current incoming streamed frame slot
// -1 when idle (or when receiving the live frame)
static int32_t s_incoming_slot = -1;

static void prv_send_int(uint32_t key, int32_t value) {
  DictionaryIterator *iter = NULL;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK || !iter) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "outbox begin failed");
    return;
  }
  dict_write_int32(iter, key, value);
  AppMessageResult rc = app_message_outbox_send();
  if (rc != APP_MSG_OK) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "outbox send failed %d", (int)rc);
  }
}

void comm_send_ack(int32_t slot) {
  prv_send_int(MESSAGE_KEY_RadarAck, slot);
}

void comm_send_full(int32_t slot) {
  prv_send_int(MESSAGE_KEY_RadarFull, slot);
}

void comm_send_zoom(int32_t zoom) {
  prv_send_int(MESSAGE_KEY_ZoomLevel, zoom);
}

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
  Tuple *marker_x_tuple = dict_find(iter, MESSAGE_KEY_MarkerX);
  if (marker_x_tuple) {
    Tuple *marker_y_tuple = dict_find(iter, MESSAGE_KEY_MarkerY);
    int32_t y = marker_y_tuple ? marker_y_tuple->value->int32 : 0;
    ui_set_marker((int16_t)marker_x_tuple->value->int32, (int16_t)y);
    return;
  }
  Tuple *layout_tuple = dict_find(iter, MESSAGE_KEY_RadarLayout);
  if (layout_tuple) {
    bool ok = radar_apply_layout(layout_tuple->value->data, layout_tuple->length);
    if (ok) {
      comm_send_ack(RADAR_ACK_LAYOUT);
    } else {
      comm_send_full(RADAR_ACK_LAYOUT);
    }
    return;
  }
  Tuple *radar_length_tuple = dict_find(iter, MESSAGE_KEY_RadarLength);
  if (radar_length_tuple) {
    Tuple *frame_tuple = dict_find(iter, MESSAGE_KEY_RadarFrame);
    if (frame_tuple) {
      int32_t slot = frame_tuple->value->int32;
      if (radar_frame_begin(slot, radar_length_tuple->value->int32)) {
        s_incoming_slot = slot;
      } else {
        s_incoming_slot = -1;
        comm_send_full(slot);
      }
    } else {
      s_incoming_slot = -1;
      radar_live_begin(radar_length_tuple->value->int32);
    }
    return;
  }
  Tuple *radar_chunk_tuple = dict_find(iter, MESSAGE_KEY_RadarChunk);
  if (radar_chunk_tuple) {
    Tuple *index_tuple = dict_find(iter, MESSAGE_KEY_RadarIndex);
    int32_t index = index_tuple ? index_tuple->value->int32 : 0;
    if (radar_has_layout()) {
      if (radar_frame_chunk(radar_chunk_tuple->value->data,
                            radar_chunk_tuple->length, index)) {
        int32_t acked = s_incoming_slot;
        s_incoming_slot = -1;
        comm_send_ack(acked);
      }
    } else {
      radar_live_chunk(radar_chunk_tuple->value->data, radar_chunk_tuple->length,
                       index);
    }
    return;
  }
  Tuple *radar_done_tuple = dict_find(iter, MESSAGE_KEY_RadarDone);
  if (radar_done_tuple) {
    if (radar_has_layout() && !radar_is_session_done()) {
      radar_set_terminal_count(radar_done_tuple->value->int32);
    } else {
      radar_live_complete(radar_done_tuple->value->int32);
    }
  }
}

static void prv_inbox_dropped(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_ERROR, "inbox dropped, reason %d", (int)reason);
}

static void prv_outbox_failed(DictionaryIterator *iter, AppMessageResult reason,
                              void *context) {
  APP_LOG(APP_LOG_LEVEL_ERROR, "outbox failed, reason %d", (int)reason);
}

void comm_init(void) {
  app_message_register_inbox_received(prv_inbox_received);
  app_message_register_inbox_dropped(prv_inbox_dropped);
  app_message_register_outbox_failed(prv_outbox_failed);
  app_message_open(INBOX_SIZE, OUTBOX_SIZE);
}
