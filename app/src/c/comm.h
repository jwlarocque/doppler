#pragma once

#include <pebble.h>

void comm_init(void);
void comm_send_ack(int32_t slot);
void comm_send_full(int32_t slot);
void comm_send_zoom(int32_t zoom);
// register to apply Clay setting changes
void comm_set_config_handler(void (*handler)(uint32_t changed));
