New Todo:
Goal: The device follows the profile with the PID even if the websocket is disconnected. The app automatically reconnects. If any of these have better alternatives, that is better. 
- Create a circular buffer on the device that stores the target profile loaded onto the screen in the miniweb webapp. The onboard PID will follow this profile (default BT) even when there is an interruption in the websocket connection. 
- Ensure the webapp will automatically reconnect if there is an interruption and update with the current state of the roaster (time, temp, recoreded datapoints, etc.) when a roast is in progress. 
- The behavior of the PID and roaster is unchanged, but the webapp is no longer serving the targets over websocket commands, it's only recieving the recorded data. That way it can continue even if there is an interruption in service. 
- Make sure the "all off" button is absolutely working at all times and if it is pressed while disconnected it will send the all off command first thing after reconnecting. 
---

## 5. Dedicated Raspberry Pi kiosk (planning only)

Goal: a reliable, self-contained interface that doesn't depend on home WiFi or internet. The Pi becomes the network the ESP32 talks to, plus the screen the operator looks at.

### Key insight

"Bad internet" wasn't really the problem — flaky home WiFi was. Putting a Pi between the ESP32 and the rest of the world lets us host our own private WiFi network just for the roaster, eliminating that variable entirely. No firmware or web-app code changes required.

### Recommended architecture: Pi as WiFi AP + kiosk

- Pi 4 + 7" official touchscreen (~$120 hardware total). Mounted on/near the roaster.
- Pi runs `hostapd` + `dnsmasq`, broadcasting something like "Yaeger-Net". ESP32 joins this SSID (configure once via the existing setup flow). DHCP reservation in dnsmasq pins the ESP32 to a known IP.
- Pi can simultaneously be on Ethernet for actual internet — OTA, NTP, anything cloud-side still works. The internet just isn't in the dashboard-to-ESP32 hot path.
- Dashboard hosting: two options.
  - **Easy**: Pi browser points at `http://<esp32-ip>/`, ESP32 serves the dashboard from LittleFS as today. The Pi's AP makes the link rock-solid; nothing else changes.
  - **Slightly nicer**: build the dashboard once (`npm run build`), copy `data/` to `/var/www/yaeger/` on the Pi, serve via nginx. ESP32 only handles WebSocket + API. Faster page load, update UI without reflashing firmware. Trade-off: dashboard and firmware versions can drift.
- Kiosk: a systemd unit launches `chromium-browser --kiosk --noerrdialogs http://yaeger.local/` (or the Pi-local URL) on boot. ~10 lines of unit file. Pi powers up → dashboard on screen.

### Alternative: ESP32 hosts its own AP

Firmware already supports this — `setupAP()` in `src/wifi_setup.cpp:45-49` broadcasts "Yaeger" when no WiFi credentials are stored. Wipe credentials → ESP32 becomes its own network → Pi (or anything) connects directly. Zero additional code.

Trade-off: ESP32's softAP has limited range and client capacity, and the ESP32 loses internet access while in AP mode (no OTA, no NTP). Fine as a fallback or for portable use, not ideal for a permanent install.

### Effort

- Half a day if comfortable with Pi setup.
- One day if learning hostapd from scratch.
- Zero firmware or web code changes for the basic version.

### What this replaces

- **USB serial fallback / Web Serial API** — irrelevant. The Pi-ESP32 link doesn't go through home WiFi or the internet, so flaky external networking can't break it. Web Serial was solving a problem that doesn't exist in this topology.
- **PWA offline activation** — also unnecessary. The Pi's local network is stable by design. You can still enable the PWA for cosmetic benefit (faster page load from cache), but it's not load-bearing.
- **Web Bluetooth** — same.

### When the USB approach would still be worth it

One case: you want to control the roaster from a laptop somewhere else, no Pi present. Pi kiosk covers "I'm standing at the roaster" (90% of operations) better; USB would cover "I'm on the couch" (10%). Probably not worth building both — pick the use case that matters more.

### Setup steps if pursued

1. Provision Pi OS Lite (or full with desktop, depending on kiosk preference).
2. Install hostapd + dnsmasq, configure AP on `wlan0` with a fixed SSID/passphrase and DHCP range.
3. Boot the ESP32, enter setup mode, point it at the Pi's SSID.
4. Reserve a static IP for the ESP32 in dnsmasq using its MAC.
5. Install chromium-browser. Create a systemd user unit that launches it in kiosk mode at boot.
6. (Optional) Set up nginx serving the prebuilt dashboard from `/var/www/yaeger/` for the "nicer" hosting variant.
7. (Optional) Wire up Ethernet for internet on the Pi without compromising the AP.
