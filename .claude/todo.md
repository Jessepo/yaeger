1. the "follow profile checkbox in the profile container and the auto/manual on the top are redundent. Desired function is a single "PID On" and "PID Off" botton on top toggles the PID profile following on and off.
2. Add an "all off" button on top. Disable PID, turn off heater, turn off fan
3. When clicking on a saved profile, a "filed to load prifile" popup appears
4. The BT rate of rise is way too erratic. At least double the filtering for this one, at the expense of adding a delay to the plot.

---

## 5. USB fallback for bad WiFi (planning only)

Goal: when WiFi is flaky or absent, talk to the roaster over USB instead.

### Approach: Web Serial API

Browser-native API (`navigator.serial`). Chromium-only — Chrome/Edge/Opera, no Firefox/Safari. ESP32-S3 already has native USB CDC and shows up as a virtual COM port. Same JSON protocol the WebSocket uses, just over a USB byte stream. No protocol redesign.

### Firmware changes (~50-80 LOC)

- Add `ARDUINO_USB_CDC_ON_BOOT=1` to the main `esp32-s3` env in `platformio.ini` (the s3-mini env already has it).
- In `CommandLoop.cpp` status loop, mirror outbound JSON to `Serial.println(output)`.
- In `main.cpp` loop(), read `Serial.available()` line-by-line, JSON-parse, dispatch to the same command handler as `WSRequestHandler::onWsEvent`.
- Decide where logs go: either prefix log lines (`LOG: ...`) so the client filters them out, or route logging to UART0 on different pins.

### Web changes (~120-150 LOC)

- New `serial.ts` mirroring `websocket.ts`'s shape: exports `connectionStatus`, `lastMessage`, `lastUpdate`, a `send()` function. Opens port via `navigator.serial.requestPort()`, reads bytes through a newline splitter, JSON-parses each line, writes JSON-stringified commands with `\n` framing.
- Transport abstraction: `roast.ts` shouldn't care which transport is active. Pick at startup, default to WebSocket with a "Connect USB" fallback button.
- Auto-reconnect via `navigator.serial.getPorts()` after the first user grant.

### Offline page-loading gotcha

If WiFi is dead, you also can't load the dashboard from the ESP32. Two paths:

- Dev/laptop setup: `npm run dev` on your machine, open `localhost:3000`, click "Connect USB". Page is local, USB carries the data.
- Production: enable the PWA service worker (currently `injectRegister: null` in `vite.config.ts:86`). Install the PWA once while online → loads from cache offline thereafter.

Web Serial requires a secure context, so neither `file://` nor an http page from a non-localhost origin works. Localhost or installed PWA only.

### Effort: ~1 day total

Firmware: one afternoon. Web: one afternoon. PWA offline activation: ~5 LOC.

### Caveats

- Chromium-only browser support (~75% of desktops).
- USB cable must carry data, not just power.
- Browser shows a port-picker prompt on first connect each session — subsequent connects can auto-resume the saved port.
- Concurrent WiFi + USB technically works (both transports receive status, both can send commands) — UI should pick one at a time to keep the model simple.
- The logging-vs-protocol routing decision on the same Serial pipe is the only real architectural question.

### Alternative: Web Bluetooth (BLE)

Same browser support story (Chromium-only), same architecture. Wire-free but more complex (GATT services, MTU sizing). For a countertop roaster on USB power, plain USB serial is simpler. Worth knowing it exists.

### Suggested order if pursued

1. Add `Serial.println(output)` in firmware status loop. Verify with Arduino IDE serial monitor that JSON is coming out cleanly.
2. Add the inbound serial command parser in firmware. Verify by sending commands manually from the monitor.
3. Write `serial.ts` on the web side.
4. Add transport selector UI.
5. Enable PWA service worker if true offline use is wanted.
