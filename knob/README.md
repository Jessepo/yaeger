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
  can be turned down) or the fan is above 0. The firmware has no software
  interlock of its own; this is the only one, besides the hardware interlock.
- Setting the fan to 0 sends heat 0 first.

## Build

Needs ESP-IDF 5.4 or newer.
ESP-IDF 6.x uses the managed `espressif/cjson` component; the build fetches it
automatically. The board pins `esp_lvgl_port` to 2.6.x for compatibility with
ESP-IDF 6 and LVGL 9.2.

    idf.py set-target esp32s3
    idf.py menuconfig        # "Yaeger knob": Wi-Fi SSID/password, roaster host
    idf.py build flash monitor

Set the Wi-Fi credentials and roaster host in `idf.py menuconfig` under
**Yaeger knob**. Keep credentials out of the tracked `Kconfig.projbuild`;
use the local, ignored `sdkconfig`. Existing `sdkconfig` values take
precedence over defaults, so change settings through menuconfig. To reset to
defaults, remove `sdkconfig` and rebuild.

The host can be an mDNS name or a bare IP address (no scheme, port, or path).
The client constructs `ws://<host>:<port>/ws`; the default port is 80. If
`yaeger.local` cannot be resolved, use the roaster's IP. If the IP reports
"Host is unreachable", confirm the knob has obtained an IP address and is on
the same non-guest LAN as the roaster; a PC reaching the roaster does not
guarantee the knob can.

On Windows, specify the knob's COM port if several ports are present:

    idf.py -p COMx build flash monitor

The port should identify the ESP32-S3, not another ESP32 device. The USB-C
port reaches the S3 in one plug orientation only: if no `/dev/ttyACM*` or COM
port appears, flip the plug.

## Layout

- `main/roaster_link.c` WebSocket client and protocol. No LVGL.
- `main/ui.c` the screen, arc, knob mapping and heat gating.
- `main/net.c` Wi-Fi and mDNS.
- `components/tiercel_board/` board support, copied from
  [TrailCurrentTiercel](https://github.com/trailcurrentoss/TrailCurrentTiercel)
  (MIT, see its `LICENSE`), with the Bluetooth co-processor link removed. The
  panel init table in `board_display.c` is Waveshare's, from their Demo 08.
