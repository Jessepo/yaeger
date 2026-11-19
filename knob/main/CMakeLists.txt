if(IDF_VERSION_MAJOR GREATER_EQUAL 6)
    set(json_component espressif__cjson)
else()
    set(json_component json)
endif()

idf_component_register(
    SRCS
        "main.c"
        "net.c"
        "roaster_link.c"
        "ui.c"
    INCLUDE_DIRS "."
    REQUIRES
        tiercel_board
        esp_wifi
        esp_netif
        esp_event
        esp_timer
        nvs_flash
        ${json_component}
        espressif__esp_websocket_client
        espressif__mdns
)
