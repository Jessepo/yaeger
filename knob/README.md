# Yaeger knob

A round-display remote for the Yaeger roaster, on the
[Waveshare ESP32-S3-Knob-Touch-LCD-1.8](https://www.waveshare.com/wiki/ESP32-S3-Knob-Touch-LCD-1.8)
(360x360, touch, detent knob, haptics).

It is a WebSocket client of the roaster firmware (`ws://yaeger.local/ws`). The
roaster pushes a status frame every 100 ms; the knob shows BT/ET and a trend,
and sets fan and heat.

- Tap **FAN** or **HEAT**: an arc appears around the rim. Drag it, or turn the
  knob (5% per step). It hides after 4 s without input.
- **HEAT** is dimmed, and ignores taps, unless the heater is already on (so it
  can be turned down) or a roast is running (`following`) and the fan is above
  0. The firmware has no software interlock of its own; this is the only one,
  besides the hardware interlock.
- Setting the fan to 0 sends heat 0 first.

## Build

Needs ESP-IDF 5.4 or newer.

    idf.py set-target esp32s3
    idf.py menuconfig        # "Yaeger knob": Wi-Fi SSID/password, roaster host
    idf.py build flash monitor

`sdkconfig.defaults` only seeds a new `sdkconfig`; after editing it, delete
`sdkconfig` and rebuild. The USB-C port reaches the S3 in one plug
orientation only: if no `/dev/ttyACM*` / COM port appears, flip the plug.

## Layout

- `main/roaster_link.c` WebSocket client and protocol. No LVGL.
- `main/ui.c` the screen, arc, knob mapping and heat gating.
- `main/net.c` Wi-Fi and mDNS.
- `components/tiercel_board/` board support, copied from
  [TrailCurrentTiercel](https://github.com/trailcurrentoss/TrailCurrentTiercel)
  (MIT, see its `LICENSE`), with the Bluetooth co-processor link removed. The
  panel init table in `board_display.c` is Waveshare's, from their Demo 08.
