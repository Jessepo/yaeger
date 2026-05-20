1. the "follow profile checkbox in the profile container and the auto/manual on the top are redundent. Desired function is a single "PID On" and "PID Off" botton on top toggles the PID profile following on and off.
2. Add an "all off" button on top. Disable PID, turn off heater, turn off fan
3. When clicking on a saved profile, a "filed to load prifile" popup appears
4. The BT rate of rise is way too erratic. At least double the filtering for this one, at the expense of adding a delay to the plot.
All above here done
5. The heater works, but the PID isn't controlling the heater. The slider isn't even moving on the app. The fan is running to the given profile just fine though (I'm in PWM mode)
6. The BT rate of rise is still too eratic. Is it based on the smoothed BT or the real BT?
7. Saved roasts does nothing

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
