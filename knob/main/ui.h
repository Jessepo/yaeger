#pragma once

/** Build the screen and start its timers. Call after tiercel_board_init() and
 *  roaster_link_start(). Turns the backlight on once the screen is drawn. */
void ui_start(void);
