/*
 * The round screen: a small BT/ET trend, big BT and ET readouts, and Heat and
 * Fan pills. Tap a pill to bring up an arc around the rim; drag the arc or
 * turn the knob to change that value. The arc hides itself after a few
 * seconds without input.
 *
 * Every function here runs in the LVGL task with the display lock held (event
 * callbacks, timers and the knob's rotate callback), except ui_start().
 */

#include <math.h>
#include <stdio.h>

#include "lvgl.h"

#include "roaster_link.h"
#include "tiercel_board.h"
#include "ui.h"

#define COL_BT      0xfe8443
#define COL_ET      0xfbbf24
#define COL_HEAT    0xec4899
#define COL_FAN     0x93c5fd
#define COL_TEXT    0xd8d3cc
#define COL_DIM     0xa8a39c
#define COL_PANEL   0x1c1917
#define COL_TRACK   0x292524

#define KNOB_STEP        5      /* percent per knob step */
#define ARC_IDLE_MS      4000   /* hide the arc after this long without input */
#define SEND_PERIOD_MS   100    /* at most one command per value per period */
#define ECHO_HOLD_MS     1500   /* ignore the roaster's echo after a local edit */
#define STALE_MS         3000   /* status older than this is not shown as live */
#define CHART_POINTS     300    /* 1 Hz: five minutes */
#define CHART_MAX_C      300

enum { W_HEAT, W_FAN, W_COUNT };
#define SEL_NONE (-1)

typedef struct {
    lv_obj_t   *pill;
    lv_obj_t   *value;
    lv_color_t  color;
    const char *name;
    int         val;          /* what the pill shows, 0-100 */
    bool        dirty;        /* val changed locally and not yet sent */
    bool        edited;
    uint32_t    edit_tick;    /* lv_tick_get() of the last local edit */
} widget_t;

static widget_t s_w[W_COUNT] = {
    [W_HEAT] = { .name = "HEAT" },
    [W_FAN]  = { .name = "FAN" },
};
static int s_sel = SEL_NONE;

static lv_obj_t          *s_bt;
static lv_obj_t          *s_et;
static lv_obj_t          *s_note;
static lv_obj_t          *s_arc;
static lv_obj_t          *s_chart;
static lv_chart_series_t *s_ser_bt;
static lv_chart_series_t *s_ser_et;

/* ---- helpers ------------------------------------------------------------ */

static lv_obj_t *make_label(lv_obj_t *parent, const lv_font_t *font, uint32_t color)
{
    lv_obj_t *l = lv_label_create(parent);
    lv_obj_set_style_text_font(l, font, 0);
    lv_obj_set_style_text_color(l, lv_color_hex(color), 0);
    lv_obj_set_style_text_align(l, LV_TEXT_ALIGN_CENTER, 0);
    return l;
}

static void show_value(widget_t *w)
{
    lv_label_set_text_fmt(w->value, "%d%%", w->val);
}

static void show_temp(lv_obj_t *label, float c)
{
    if (isnan(c)) {
        lv_label_set_text(label, "--");
    } else {
        lv_label_set_text_fmt(label, "%d", (int)lroundf(c));
    }
}

static int clamp100(int v) { return v < 0 ? 0 : v > 100 ? 100 : v; }

/* ---- sending ------------------------------------------------------------ */

static void send_widget(int which)
{
    widget_t *w = &s_w[which];
    if (!w->dirty) {
        return;
    }
    w->dirty = false;
    if (which == W_FAN) {
        /* The heater must never be left running while the fan is stopped:
         * zero it first. (The hardware interlock is the real protection;
         * this just keeps the two values honest.) */
        if (w->val == 0 && s_w[W_HEAT].val > 0) {
            s_w[W_HEAT].val = 0;
            show_value(&s_w[W_HEAT]);
            roaster_link_set_heat(0);
        }
        roaster_link_set_fan(w->val);
    } else {
        roaster_link_set_heat(w->val);
    }
}

static void send_timer_cb(lv_timer_t *t)
{
    (void)t;
    /* Fan before heat, so a fan change that also zeroes the heater goes out in
     * the order the roaster expects. */
    send_widget(W_FAN);
    send_widget(W_HEAT);
}

/* ---- the arc ------------------------------------------------------------ */

static void style_pill(int which)
{
    widget_t *w = &s_w[which];
    lv_obj_set_style_border_width(w->pill, which == s_sel ? 4 : 1, 0);
}

static void close_arc(void)
{
    const int prev = s_sel;
    s_sel = SEL_NONE;
    lv_obj_add_flag(s_arc, LV_OBJ_FLAG_HIDDEN);
    if (prev != SEL_NONE) {
        send_widget(prev);       /* don't leave a half-sent edit behind */
        style_pill(prev);
    }
}

static bool heat_allowed(void)
{
    roaster_status_t st;
    roaster_link_status(&st);
    if (st.age_ms >= STALE_MS) {
        return false;
    }
    /* A heater that is already on can always be turned down -- a roast driven
     * from Artisan never sets `following`. Starting it from zero needs a roast
     * and a fan. */
    if (s_w[W_HEAT].val > 0) {
        return true;
    }
    return st.following && s_w[W_FAN].val > 0;
}

static void open_arc(int which)
{
    if (s_sel != SEL_NONE) {
        const int prev = s_sel;
        send_widget(prev);
        s_sel = SEL_NONE;
        style_pill(prev);
    }
    s_sel = which;
    lv_obj_set_style_arc_color(s_arc, s_w[which].color, LV_PART_INDICATOR);
    lv_arc_set_value(s_arc, s_w[which].val);
    lv_obj_remove_flag(s_arc, LV_OBJ_FLAG_HIDDEN);
    style_pill(which);
}

/* Set the selected value from the arc or the knob. */
static void edit(int which, int val)
{
    widget_t *w = &s_w[which];
    val = clamp100(val);
    w->val       = val;
    w->dirty     = true;
    w->edited    = true;
    w->edit_tick = lv_tick_get();
    show_value(w);
    lv_arc_set_value(s_arc, val);
}

static void arc_changed_cb(lv_event_t *e)
{
    (void)e;
    if (s_sel != SEL_NONE) {
        edit(s_sel, lv_arc_get_value(s_arc));
    }
}

static void arc_released_cb(lv_event_t *e)
{
    (void)e;
    if (s_sel != SEL_NONE) {
        send_widget(s_sel);
    }
}

static void pill_click_cb(lv_event_t *e)
{
    const int which = (int)(intptr_t)lv_event_get_user_data(e);
    roaster_status_t st;
    roaster_link_status(&st);
    if (st.age_ms >= STALE_MS || (which == W_HEAT && !heat_allowed())) {
        tiercel_board_haptic(TIERCEL_HAPTIC_LIMIT);
        return;
    }
    tiercel_board_haptic(TIERCEL_HAPTIC_TAP);
    if (s_sel == which) {
        close_arc();
    } else {
        open_arc(which);
    }
}

static void screen_click_cb(lv_event_t *e)
{
    /* Only a tap on the bare screen, not one that bubbled up from a child. */
    if (lv_event_get_target_obj(e) == lv_event_get_current_target_obj(e)) {
        close_arc();
    }
}

static void knob_cb(int diff, void *ctx)
{
    (void)ctx;
    if (s_sel == SEL_NONE) {
        return;
    }
    const int cur = s_w[s_sel].val;
    const int nxt = clamp100(cur + diff * KNOB_STEP);
    if (nxt == cur) {
        tiercel_board_haptic(TIERCEL_HAPTIC_LIMIT);
        return;
    }
    edit(s_sel, nxt);
}

/* ---- periodic refresh --------------------------------------------------- */

static void refresh_cb(lv_timer_t *t)
{
    (void)t;
    roaster_status_t st;
    roaster_link_status(&st);
    const bool live = st.age_ms < STALE_MS;

    show_temp(s_bt, live ? st.bt : NAN);
    show_temp(s_et, live ? st.et : NAN);

    if (!roaster_link_connected()) {
        lv_label_set_text(s_note, "connecting...");
    } else if (!live) {
        lv_label_set_text(s_note, "no data");
    } else {
        lv_label_set_text(s_note, "");
    }

    /* Follow the roaster's values, except for a moment after the user's own
     * edit -- the roaster's 100 ms frames would otherwise drag the pill and
     * the arc back to the old value before the new one lands. */
    if (live) {
        const float echo[W_COUNT] = { [W_HEAT] = st.heat, [W_FAN] = st.fan };
        for (int i = 0; i < W_COUNT; i++) {
            widget_t *w = &s_w[i];
            const bool holding =
                w->dirty || (w->edited && lv_tick_elaps(w->edit_tick) < ECHO_HOLD_MS);
            if (!holding) {
                w->val = clamp100((int)lroundf(echo[i]));
                show_value(w);
                if (s_sel == i) {
                    lv_arc_set_value(s_arc, w->val);
                }
            }
        }
    }

    /* Heat is dimmed completely whenever it could not run. */
    const bool heat_ok = live && heat_allowed();
    lv_obj_set_style_opa(s_w[W_HEAT].pill, heat_ok ? LV_OPA_COVER : LV_OPA_30, 0);
    lv_obj_set_style_opa(s_w[W_FAN].pill, live ? LV_OPA_COVER : LV_OPA_30, 0);

    if (s_sel != SEL_NONE) {
        const bool gone = (s_sel == W_HEAT && !heat_ok) || (s_sel == W_FAN && !live);
        if (gone || tiercel_board_ms_since_input() > ARC_IDLE_MS) {
            close_arc();
        }
    }
}

static void chart_cb(lv_timer_t *t)
{
    (void)t;
    roaster_status_t st;
    roaster_link_status(&st);
    const bool live = st.age_ms < STALE_MS;
    lv_chart_set_next_value(s_chart, s_ser_bt,
                            live && !isnan(st.bt) ? (int)st.bt : LV_CHART_POINT_NONE);
    lv_chart_set_next_value(s_chart, s_ser_et,
                            live && !isnan(st.et) ? (int)st.et : LV_CHART_POINT_NONE);
}

/* ---- construction ------------------------------------------------------- */

static void build_pill(lv_obj_t *scr, int which, int x_off)
{
    widget_t *w = &s_w[which];
    w->color = lv_color_hex(which == W_HEAT ? COL_HEAT : COL_FAN);

    w->pill = lv_obj_create(scr);
    lv_obj_set_size(w->pill, 100, 60);
    lv_obj_align(w->pill, LV_ALIGN_CENTER, x_off, 78);
    lv_obj_remove_flag(w->pill, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_radius(w->pill, 14, 0);
    lv_obj_set_style_bg_color(w->pill, lv_color_hex(COL_PANEL), 0);
    lv_obj_set_style_border_color(w->pill, w->color, 0);
    lv_obj_set_style_border_width(w->pill, 1, 0);
    lv_obj_set_style_pad_all(w->pill, 0, 0);
    lv_obj_add_event_cb(w->pill, pill_click_cb, LV_EVENT_CLICKED,
                        (void *)(intptr_t)which);

    lv_obj_t *name = make_label(w->pill, &lv_font_montserrat_14, COL_DIM);
    lv_label_set_text(name, w->name);
    lv_obj_align(name, LV_ALIGN_TOP_MID, 0, 5);

    w->value = make_label(w->pill, &lv_font_montserrat_28, 0xffffff);
    lv_obj_set_width(w->value, 96);
    lv_obj_align(w->value, LV_ALIGN_BOTTOM_MID, 0, -4);
    show_value(w);
}

static void build_reading(lv_obj_t *scr, const char *name, uint32_t color, int x_off,
                          lv_obj_t **value)
{
    lv_obj_t *tag = make_label(scr, &lv_font_montserrat_14, COL_DIM);
    lv_label_set_text(tag, name);
    lv_obj_align(tag, LV_ALIGN_CENTER, x_off, -26);

    *value = make_label(scr, &lv_font_montserrat_40, color);
    lv_obj_set_width(*value, 120);
    lv_obj_align(*value, LV_ALIGN_CENTER, x_off, 2);
    lv_label_set_text(*value, "--");
}

static void build_chart(lv_obj_t *scr)
{
    s_chart = lv_chart_create(scr);
    lv_obj_set_size(s_chart, 200, 70);
    lv_obj_align(s_chart, LV_ALIGN_CENTER, 0, -100);
    lv_chart_set_type(s_chart, LV_CHART_TYPE_LINE);
    lv_chart_set_point_count(s_chart, CHART_POINTS);
    lv_chart_set_update_mode(s_chart, LV_CHART_UPDATE_MODE_SHIFT);
    lv_chart_set_range(s_chart, LV_CHART_AXIS_PRIMARY_Y, 0, CHART_MAX_C);
    lv_chart_set_div_line_count(s_chart, 0, 0);
    lv_obj_set_style_bg_opa(s_chart, LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_width(s_chart, 0, 0);
    lv_obj_set_style_pad_all(s_chart, 0, 0);
    lv_obj_set_style_size(s_chart, 0, 0, LV_PART_INDICATOR);   /* no point dots */
    lv_obj_set_style_line_width(s_chart, 3, LV_PART_ITEMS);
    lv_obj_remove_flag(s_chart, LV_OBJ_FLAG_CLICKABLE);

    s_ser_et = lv_chart_add_series(s_chart, lv_color_hex(COL_ET), LV_CHART_AXIS_PRIMARY_Y);
    s_ser_bt = lv_chart_add_series(s_chart, lv_color_hex(COL_BT), LV_CHART_AXIS_PRIMARY_Y);
    lv_chart_set_all_value(s_chart, s_ser_et, LV_CHART_POINT_NONE);
    lv_chart_set_all_value(s_chart, s_ser_bt, LV_CHART_POINT_NONE);
}

static void build_arc(lv_obj_t *scr)
{
    s_arc = lv_arc_create(scr);
    lv_obj_set_size(s_arc, 352, 352);
    lv_obj_center(s_arc);
    lv_arc_set_rotation(s_arc, 0);
    lv_arc_set_bg_angles(s_arc, 135, 45);        /* 270 degrees, gap at the bottom */
    lv_arc_set_range(s_arc, 0, 100);
    lv_obj_set_style_arc_width(s_arc, 24, LV_PART_MAIN);
    lv_obj_set_style_arc_width(s_arc, 24, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(s_arc, lv_color_hex(COL_TRACK), LV_PART_MAIN);
    lv_obj_set_style_bg_color(s_arc, lv_color_white(), LV_PART_KNOB);
    lv_obj_set_style_pad_all(s_arc, 2, LV_PART_KNOB);
    lv_obj_set_ext_click_area(s_arc, 10);
    lv_obj_add_flag(s_arc, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_event_cb(s_arc, arc_changed_cb, LV_EVENT_VALUE_CHANGED, NULL);
    lv_obj_add_event_cb(s_arc, arc_released_cb, LV_EVENT_RELEASED, NULL);
}

void ui_start(void)
{
    if (!tiercel_board_lock(0)) {
        return;
    }
    lv_obj_t *scr = lv_screen_active();
    lv_obj_set_style_bg_color(scr, lv_color_black(), 0);
    lv_obj_remove_flag(scr, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_event_cb(scr, screen_click_cb, LV_EVENT_CLICKED, NULL);

    build_chart(scr);
    build_reading(scr, "BT", COL_BT, -62, &s_bt);
    build_reading(scr, "ET", COL_ET, 62, &s_et);
    build_pill(scr, W_HEAT, -56);
    build_pill(scr, W_FAN, 56);

    s_note = make_label(scr, &lv_font_montserrat_14, COL_DIM);
    lv_obj_set_width(s_note, 140);
    lv_obj_align(s_note, LV_ALIGN_CENTER, 0, 136);
    lv_label_set_text(s_note, "connecting...");

    build_arc(scr);

    tiercel_board_set_rotate_callback(knob_cb, NULL);
    lv_timer_create(refresh_cb, 200, NULL);
    lv_timer_create(chart_cb, 1000, NULL);
    lv_timer_create(send_timer_cb, SEND_PERIOD_MS, NULL);
    refresh_cb(NULL);
    tiercel_board_unlock();

    tiercel_board_backlight_set(100);
}
