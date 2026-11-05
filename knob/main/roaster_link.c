#include <math.h>
#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_websocket_client.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

#include "roaster_link.h"

static const char *TAG = "link";

#define RX_MAX         1024
#define SEND_TIMEOUT   pdMS_TO_TICKS(200)
/* The firmware's quiet-link watchdog counts any command as activity, and the
 * webapp sends getData once a second. Do the same, so the roaster knows an
 * operator is still here. */
#define KEEPALIVE_US   1000000

static esp_websocket_client_handle_t s_client;
static SemaphoreHandle_t             s_lock;
static roaster_status_t              s_status = { .age_ms = UINT32_MAX };
static int64_t                       s_status_us;
static volatile bool                 s_connected;
static char                          s_rx[RX_MAX];

static float num(const cJSON *obj, const char *key, float fallback)
{
    const cJSON *v = cJSON_GetObjectItemCaseSensitive(obj, key);
    return cJSON_IsNumber(v) ? (float)v->valuedouble : fallback;
}

static void parse_frame(const char *text)
{
    cJSON *root = cJSON_Parse(text);
    if (!root) {
        return;
    }
    const cJSON *d    = cJSON_GetObjectItemCaseSensitive(root, "data");
    const cJSON *type = cJSON_GetObjectItemCaseSensitive(d, "type");
    /* getData replies carry no "type"; only status frames hold everything. */
    if (cJSON_IsString(type) && strcmp(type->valuestring, "status") == 0) {
        const cJSON *fol = cJSON_GetObjectItemCaseSensitive(d, "following");
        xSemaphoreTake(s_lock, portMAX_DELAY);
        s_status.et        = num(d, "ET", NAN);
        s_status.bt        = num(d, "BT", NAN);
        s_status.fan       = num(d, "FanVal", 0);
        s_status.heat      = num(d, "BurnerVal", 0);
        s_status.following = cJSON_IsTrue(fol);
        s_status_us        = esp_timer_get_time();
        xSemaphoreGive(s_lock);
    }
    cJSON_Delete(root);
}

static void on_ws_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;
    (void)base;
    const esp_websocket_event_data_t *e = data;
    switch (id) {
    case WEBSOCKET_EVENT_CONNECTED:
        ESP_LOGI(TAG, "connected");
        s_connected = true;
        break;
    case WEBSOCKET_EVENT_DISCONNECTED:
        ESP_LOGW(TAG, "disconnected");
        s_connected = false;
        break;
    case WEBSOCKET_EVENT_DATA:
        /* Text (0x1) or a continuation (0x0); ping/pong/close are not ours. */
        if ((e->op_code != 0x1 && e->op_code != 0x0) || e->payload_len >= RX_MAX) {
            break;
        }
        if (e->payload_offset + e->data_len > RX_MAX - 1) {
            break;
        }
        memcpy(s_rx + e->payload_offset, e->data_ptr, e->data_len);
        if (e->payload_offset + e->data_len >= e->payload_len) {
            s_rx[e->payload_len] = '\0';
            parse_frame(s_rx);
        }
        break;
    default:
        break;
    }
}

static void keepalive_cb(void *arg)
{
    (void)arg;
    if (s_connected) {
        static const char msg[] = "{\"id\":1,\"command\":\"getData\"}";
        esp_websocket_client_send_text(s_client, msg, sizeof(msg) - 1, SEND_TIMEOUT);
    }
}

void roaster_link_start(void)
{
    s_lock = xSemaphoreCreateMutex();

    char uri[96];
    snprintf(uri, sizeof(uri), "ws://%s:%d/ws", CONFIG_KNOB_ROASTER_HOST,
             CONFIG_KNOB_ROASTER_PORT);
    const esp_websocket_client_config_t cfg = {
        .uri                  = uri,
        .reconnect_timeout_ms = 1000,
        .network_timeout_ms   = 5000,
        .buffer_size          = RX_MAX,
    };
    s_client = esp_websocket_client_init(&cfg);
    esp_websocket_register_events(s_client, WEBSOCKET_EVENT_ANY, on_ws_event, NULL);
    esp_websocket_client_start(s_client);

    const esp_timer_create_args_t t = { .callback = keepalive_cb, .name = "ws_keepalive" };
    esp_timer_handle_t timer;
    esp_timer_create(&t, &timer);
    esp_timer_start_periodic(timer, KEEPALIVE_US);
}

void roaster_link_status(roaster_status_t *out)
{
    xSemaphoreTake(s_lock, portMAX_DELAY);
    *out = s_status;
    out->age_ms = s_status_us == 0
                      ? UINT32_MAX
                      : (uint32_t)((esp_timer_get_time() - s_status_us) / 1000);
    xSemaphoreGive(s_lock);
}

bool roaster_link_connected(void) { return s_connected; }

static void send_value(const char *key, int percent)
{
    if (!s_connected) {
        return;
    }
    percent = percent < 0 ? 0 : percent > 100 ? 100 : percent;
    char msg[48];
    const int n = snprintf(msg, sizeof(msg), "{\"id\":1,\"%s\":%d}", key, percent);
    esp_websocket_client_send_text(s_client, msg, n, SEND_TIMEOUT);
}

void roaster_link_set_fan(int percent)  { send_value("FanVal", percent); }
void roaster_link_set_heat(int percent) { send_value("BurnerVal", percent); }
