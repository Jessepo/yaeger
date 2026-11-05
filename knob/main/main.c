#include "esp_check.h"

#include "net.h"
#include "roaster_link.h"
#include "tiercel_board.h"
#include "ui.h"

void app_main(void)
{
    ESP_ERROR_CHECK(tiercel_board_init());
    ESP_ERROR_CHECK(net_start());
    roaster_link_start();
    ui_start();
}
