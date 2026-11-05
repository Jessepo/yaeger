/*
 * The WebSocket link to the roaster firmware (src/CommandLoop.cpp).
 *
 * The firmware pushes a {"data":{"type":"status",...}} frame every 100 ms to
 * every connected client, so there is nothing to poll for. This module keeps
 * the latest frame, and sends the two commands the knob needs.
 *
 * Nothing here touches LVGL: the UI reads a snapshot from its own timer.
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

typedef struct {
    float    et;
    float    bt;
    float    fan;        /**< 0-100 */
    float    heat;       /**< 0-100 */
    bool     following;  /**< firmware is running a roast (set by startRoast) */
    uint32_t age_ms;     /**< since the frame arrived; UINT32_MAX if none yet */
} roaster_status_t;

void roaster_link_start(void);

/** Copy of the latest status. age_ms is UINT32_MAX until the first frame. */
void roaster_link_status(roaster_status_t *out);

bool roaster_link_connected(void);

/** Fire-and-forget; dropped when the link is down. Values are clamped 0-100. */
void roaster_link_set_fan(int percent);
void roaster_link_set_heat(int percent);
