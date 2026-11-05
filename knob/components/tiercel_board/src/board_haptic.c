/*
 * DRV2605 haptic driver, internal trigger, ROM effect library.
 *
 * The motor nets are labelled LRA_P/LRA_N on the schematic, and the motor is
 * a linear resonant actuator. Waveshare's Demo 03 drives it as an ERM in open
 * loop, which "works" only in the sense that a long buzz is felt: an LRA
 * barely moves on the DC pulses an ERM waveform is made of, and every click
 * is lost through the glass. So bring-up runs the DRV2605's auto-calibration
 * in LRA mode, which finds the motor's resonance and back-EMF gain, then
 * plays effects closed loop from the LRA library (6) -- the strongest drive
 * the chip has. If calibration fails (the chip flags it), the motor is not
 * an LRA and we fall back to the demo's ERM open loop. Kconfig
 * TIERCEL_HAPTIC_FORCE_ERM skips the attempt.
 *
 * Calibration makes the motor hum for about a second at power-up.
 *
 * An effect is "write its id into waveform slot 1, zero slot 2, set GO". The
 * driver plays it from its own ROM and the I2C bus is free again in well
 * under a millisecond, so this runs inline on the caller's task.
 */

#include "esp_check.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include "board_internal.h"
#include "board_pins.h"
#include "tiercel_board.h"

static const char *TAG = "board.haptic";

#define REG_STATUS     0x00
#define REG_MODE       0x01
#define REG_RTP        0x02
#define REG_LIBRARY    0x03
#define REG_WAVESEQ1   0x04
#define REG_WAVESEQ2   0x05
#define REG_GO         0x0C
#define REG_OVERDRIVE  0x0D
#define REG_SUSTAINPOS 0x0E
#define REG_SUSTAINNEG 0x0F
#define REG_BREAK      0x10
#define REG_AUDIOMAX   0x13
#define REG_RATED      0x16
#define REG_ODCLAMP    0x17
#define REG_FEEDBACK   0x1A
#define REG_CONTROL1   0x1B
#define REG_CONTROL3   0x1D
#define REG_CONTROL4   0x1E

#define MODE_AUTOCAL   0x07
#define STATUS_DIAG    0x08    /* DIAG_RESULT: 1 = auto-calibration failed */
#define LRA_LIBRARY    6

static i2c_master_dev_handle_t s_dev;
/* Effects come from the LVGL task and the knob poll (board_knob.c). */
static SemaphoreHandle_t s_lock;
static bool    s_present;
static bool    s_enabled = true;
static int64_t s_last_us;      /* when the last effect started */
static int     s_last_kind = -1;

/*
 * Effect ids from the DRV2605 ROM library table (datasheet section 11.2),
 * which is the same across libraries 1-7. Kconfig overrides let a unit with a
 * different motor be tuned without touching code.
 *
 * min_gap_ms is roughly the effect's own length: a repeat of the same kind
 * inside it is dropped, and a lighter kind inside it is dropped too. weight
 * orders the kinds -- see tiercel_board.h.
 */
static const struct {
    uint8_t  effect;
    uint32_t min_gap_ms;
    uint8_t  weight;
} s_kinds[] = {
    [TIERCEL_HAPTIC_DETENT]  = { CONFIG_TIERCEL_HAPTIC_DETENT_EFFECT,  30,  0 },
    [TIERCEL_HAPTIC_TAP]     = { CONFIG_TIERCEL_HAPTIC_TAP_EFFECT,     150, 1 },
    [TIERCEL_HAPTIC_CONFIRM] = { CONFIG_TIERCEL_HAPTIC_CONFIRM_EFFECT, 220, 2 },
    [TIERCEL_HAPTIC_BACK]    = { CONFIG_TIERCEL_HAPTIC_BACK_EFFECT,    250, 3 },
    [TIERCEL_HAPTIC_LIMIT]   = { CONFIG_TIERCEL_HAPTIC_LIMIT_EFFECT,   150, 4 },
    [TIERCEL_HAPTIC_ALERT]   = { CONFIG_TIERCEL_HAPTIC_ALERT_EFFECT,   400, 5 },
};

static esp_err_t wr(uint8_t reg, uint8_t val)
{
    const uint8_t buf[2] = { reg, val };
    return i2c_master_transmit(s_dev, buf, sizeof(buf), 50);
}

static esp_err_t rd(uint8_t reg, uint8_t *val)
{
    return i2c_master_transmit_receive(s_dev, &reg, 1, val, 1, 50);
}

/*
 * LRA auto-calibration (datasheet 8.5.6). Rated voltage and clamp are for a
 * typical coin LRA (~2 V rms, ~200 Hz); the calibration measures the rest.
 * Returns true if the chip reports success, leaving it in LRA closed loop.
 */
static bool lra_calibrate(void)
{
    uint8_t c4 = 0;
    esp_err_t err = ESP_OK;
    /* N_ERM_LRA=1, brake factor 4x, loop gain medium, BEMF gain 15x. */
    err |= wr(REG_FEEDBACK, 0xB6);
    err |= wr(REG_RATED, CONFIG_TIERCEL_HAPTIC_LRA_RATED);
    err |= wr(REG_CONTROL1, 0x93);    /* startup boost, drive time ~2.4 ms */
    err |= rd(REG_CONTROL4, &c4);
    err |= wr(REG_CONTROL4, c4 | 0x30); /* longest auto-cal time: reliable */
    uint8_t c3 = 0;
    err |= rd(REG_CONTROL3, &c3);
    err |= wr(REG_CONTROL3, c3 & ~0x01); /* LRA closed loop */
    err |= wr(REG_MODE, MODE_AUTOCAL);
    err |= wr(REG_GO, 1);
    if (err != ESP_OK) {
        return false;
    }
    uint8_t go = 1;
    for (int i = 0; i < 40 && go; i++) {     /* up to 2 s; ~1.2 s typical */
        vTaskDelay(pdMS_TO_TICKS(50));
        if (rd(REG_GO, &go) != ESP_OK) {
            return false;
        }
    }
    uint8_t status = 0xFF, comp = 0, bemf = 0, fb = 0;
    rd(REG_STATUS, &status);
    rd(0x18, &comp);
    rd(0x19, &bemf);
    rd(REG_FEEDBACK, &fb);
    if (go || (status & STATUS_DIAG)) {
        ESP_LOGW(TAG, "LRA auto-calibration failed (status 0x%02X) -- ERM",
                 status);
        return false;
    }
    ESP_LOGI(TAG, "LRA calibrated: comp 0x%02X, bemf 0x%02X, feedback 0x%02X",
             comp, bemf, fb);
    return true;
}

/* What Waveshare's demo does: ERM, open loop. */
static esp_err_t erm_setup(void)
{
    uint8_t fb = 0, c3 = 0;
    esp_err_t err = ESP_OK;
    err |= rd(REG_FEEDBACK, &fb);
    err |= rd(REG_CONTROL3, &c3);
    err |= wr(REG_FEEDBACK, fb & 0x7F);       /* N_ERM_LRA = ERM */
    err |= wr(REG_CONTROL3, c3 | 0x20);       /* ERM open loop */
    return err;
}

esp_err_t board_haptic_init(i2c_master_bus_handle_t bus, bool *present)
{
    *present = false;
    const i2c_device_config_t cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address  = BOARD_HAPTIC_ADDR,
        .scl_speed_hz    = BOARD_I2C_HZ,
    };
    ESP_RETURN_ON_ERROR(i2c_master_bus_add_device(bus, &cfg, &s_dev), TAG,
                        "add device");

    uint8_t status = 0;
    if (rd(REG_STATUS, &status) != ESP_OK) {
        /* Not fatal: everything else on the board works without it, and the
         * haptic calls become no-ops. */
        ESP_LOGW(TAG, "DRV2605 did not answer at 0x%02X -- haptics off",
                 BOARD_HAPTIC_ADDR);
        return ESP_OK;
    }
    const uint8_t id = status >> 5;   /* 3 = DRV2605, 7 = DRV2605L */

    esp_err_t err = ESP_OK;
    err |= wr(REG_MODE, 0x00);          /* out of standby, internal trigger */
    err |= wr(REG_RTP, 0x00);
    err |= wr(REG_WAVESEQ1, 1);
    err |= wr(REG_WAVESEQ2, 0);
    err |= wr(REG_OVERDRIVE, 0);
    err |= wr(REG_SUSTAINPOS, 0);
    err |= wr(REG_SUSTAINNEG, 0);
    err |= wr(REG_BREAK, 0);
    err |= wr(REG_AUDIOMAX, 0x64);
    /* Full scale for every effect. The power-on value leaves even the
     * strongest click too faint to feel through the glass. */

    err |= wr(REG_ODCLAMP, CONFIG_TIERCEL_HAPTIC_OD_CLAMP);
    ESP_RETURN_ON_ERROR(err, TAG, "DRV2605 setup failed");

#ifdef CONFIG_TIERCEL_HAPTIC_FORCE_ERM
    const bool lra = false;
#else
    const bool lra = lra_calibrate();
#endif
    err = lra ? ESP_OK : erm_setup();
    err |= wr(REG_LIBRARY, lra ? LRA_LIBRARY : CONFIG_TIERCEL_HAPTIC_LIBRARY);
    err |= wr(REG_MODE, 0x00);
    ESP_RETURN_ON_ERROR(err, TAG, "DRV2605 mode setup failed");

    s_lock = xSemaphoreCreateMutex();
    if (!s_lock) {
        return ESP_ERR_NO_MEM;
    }
    s_present = true;
    *present = true;
    ESP_LOGI(TAG, "DRV2605%s (id %u) ready, clamp %d, %s",
             id == 7 ? "L" : "", (unsigned)id, CONFIG_TIERCEL_HAPTIC_OD_CLAMP,
             lra ? "LRA closed loop, library 6" : "ERM open loop");
    return ESP_OK;
}

void tiercel_board_haptics_enable(bool enabled)
{
    s_enabled = enabled;
}

void tiercel_board_haptic(tiercel_haptic_t kind)
{
    if (!s_present || !s_enabled ||
        kind < 0 || kind >= (int)(sizeof(s_kinds) / sizeof(s_kinds[0]))) {
        return;
    }
    xSemaphoreTake(s_lock, portMAX_DELAY);
    const int64_t now = esp_timer_get_time();
    if (s_last_kind >= 0 &&
        now - s_last_us < (int64_t)s_kinds[s_last_kind].min_gap_ms * 1000 &&
        (kind == s_last_kind ||
         s_kinds[kind].weight < s_kinds[s_last_kind].weight)) {
        xSemaphoreGive(s_lock);
        return;
    }
    s_last_us = now;
    s_last_kind = kind;

    /* GO=0 first: a heavier effect replacing one still playing must restart
     * the sequencer, not be appended to it. */
    if (wr(REG_GO, 0) != ESP_OK ||
        wr(REG_WAVESEQ1, s_kinds[kind].effect) != ESP_OK ||
        wr(REG_WAVESEQ2, 0) != ESP_OK ||
        wr(REG_GO, 1) != ESP_OK) {
        ESP_LOGD(TAG, "effect %u not sent", (unsigned)s_kinds[kind].effect);
    }
    xSemaphoreGive(s_lock);
}
