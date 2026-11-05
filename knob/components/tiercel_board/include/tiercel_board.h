/*
 * tiercel_board -- the only board-aware code in the firmware.
 *
 * One board sits behind this header: the Waveshare ESP32-S3-Knob-Touch-LCD-1.8
 * (360x360 ST77916 on QSPI, CST816 touch, a detent knob with no push, and a
 * DRV2605 haptic driver). Everything above it -- the UI, the data model,
 * MQTT, Peregrine -- is board-agnostic and should stay that way.
 *
 * The shape follows Capstan's capstan_board.h so the navigation layer reads
 * the same on both products. What differs is the input model: Capstan is
 * ring-only with touch off; Tiercel is touch-first, and the knob only ever
 * turns -- there is no press, so "press" is a tap on the glass.
 */
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "driver/i2c_master.h"
#include "esp_err.h"
#include "lvgl.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    const char *name;      /**< "knob18" */
    uint16_t    h_res;
    uint16_t    v_res;
    bool        round;
    bool        has_haptics;   /**< false if the DRV2605 did not answer */
} tiercel_board_info_t;

const tiercel_board_info_t *tiercel_board_info(void);

/**
 * Bring up the panel, touch, knob, haptics and LVGL.
 *
 * On return LVGL runs on its own task and the panel is cleared but dark --
 * call tiercel_board_backlight_set() once the first screen is drawn.
 */
esp_err_t tiercel_board_init(void);

/**
 * The LVGL mutex. Wrap every lv_* call made from a task other than LVGL's.
 * LVGL's own callbacks (timers, events, the rotate callback below) already
 * hold it -- taking it again there deadlocks.
 *
 * @param timeout_ms  0 waits forever.
 */
bool tiercel_board_lock(uint32_t timeout_ms);
void tiercel_board_unlock(void);

/** Backlight 0-100, LEDC PWM. */
esp_err_t tiercel_board_backlight_set(uint8_t percent);

/** The shared I2C0 bus (touch + haptics), for anything else that lands on it. */
i2c_master_bus_handle_t tiercel_board_i2c_bus(void);

/** The touch input device. Always enabled -- Tiercel is touch-first. */
lv_indev_t *tiercel_board_touch_indev(void);

/**
 * Knob rotation, as a signed number of steps (+ is clockwise). One step is
 * tiercel_board_knob_set_ratio() physical clicks -- 1 unless the user chose
 * otherwise under Settings > Knob Ratio.
 *
 * The board plays TIERCEL_HAPTIC_DETENT itself, from the knob poll, on the
 * click that completes each step -- so the tick lands on that mechanical
 * click instead of trailing it by however long LVGL takes to get to the
 * event. The UI adds only what the board cannot know: TIERCEL_HAPTIC_LIMIT
 * when a step cannot move anything, which, being heavier, replaces the tick.
 *
 * Delivered from an lv_timer, so it runs in the LVGL task with the display
 * lock ALREADY HELD: call lv_* freely, never tiercel_board_lock() inside.
 * Steps are relative and the board keeps no running total -- see the "never
 * store the overshoot" note in main/ui_nav.c.
 */
typedef void (*tiercel_board_rotate_cb_t)(int diff, void *ctx);
void tiercel_board_set_rotate_callback(tiercel_board_rotate_cb_t cb, void *ctx);

/** Clicks per step, 1-3 (out of range is clamped). Takes effect at once and
 *  drops any half-finished step. */
void tiercel_board_knob_set_ratio(int clicks);

/** Drop a half-finished step (clicks short of a whole one). Called on a
 *  screen change, so a stray click on one screen does not count on the next. */
void tiercel_board_knob_reset(void);

/**
 * Milliseconds since the last touch or detent. The idle-clock timeout runs
 * from this rather than LVGL's inactivity timer, which any redraw resets --
 * including the clock's own second hand.
 */
uint32_t tiercel_board_ms_since_input(void);

/* ----------------------------------------------------------------------
 * Haptics (DRV2605, internal trigger, ROM waveform library).
 *
 * Fire-and-forget: each call queues one effect and returns. Repeats of one
 * kind closer together than the effect's own length are coalesced rather
 * than queued, so spinning the knob against an end stop gives a steady train
 * of bumps instead of a backlog that keeps buzzing after the hand has let go.
 *
 * The kinds are graded so the hand can tell them apart without looking, from
 * lightest to heaviest: a detent tick, a tap, a commit, back, an end stop.
 * A heavier effect cuts off a lighter one that is still playing; a lighter
 * one never cuts off a heavier one (a tap that also steps a carousel feels
 * like the tap, not the detent that follows it).
 *
 * All of them are no-ops when the user has turned haptics off
 * (tiercel_board_haptics_enable(false)) or the driver did not answer.
 * ---------------------------------------------------------------------- */
typedef enum {
    TIERCEL_HAPTIC_LIMIT = 0,  /**< a knob value is already at its min/max */
    TIERCEL_HAPTIC_TAP,        /**< a tap was accepted: a selection */
    TIERCEL_HAPTIC_CONFIRM,    /**< something committed: mode set, toggle */
    TIERCEL_HAPTIC_ALERT,      /**< an alarm overlay was raised */
    TIERCEL_HAPTIC_DETENT,     /**< a knob step (played by board_knob.c) */
    TIERCEL_HAPTIC_BACK,       /**< back was taken: swipe, hold or chip */
} tiercel_haptic_t;

void tiercel_board_haptic(tiercel_haptic_t kind);
void tiercel_board_haptics_enable(bool enabled);

#ifdef __cplusplus
}
#endif
