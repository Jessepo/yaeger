#pragma once

#include "esp_err.h"

/** Join the configured Wi-Fi network and keep rejoining. Returns immediately;
 *  the link comes up in the background. Also starts mDNS so the roaster's
 *  ".local" name resolves. */
esp_err_t net_start(void);
