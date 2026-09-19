# Yaeger ↔ Artisan Setup (WebSocket)

Yaeger speaks the Artisan WebSocket protocol natively. Artisan polls for
temperatures, sends heater/fan commands via slider actions, and Yaeger can
push crack events back to Artisan unprompted.

---

## Hardware

### Main board (ESP32-S3 DevKitC-1)

| GPIO | Signal | Connected to |
|-----:|--------|--------------|
| 3    | HEATER_PIN | AC SSR input (50 Hz PWM, ≤ 65 % duty) |
| 4    | ARGB_PIN | WS2812 LED strip — 8 pixels |
| 5    | SPI MISO | MAX31855 × 2 (shared data line) |
| 6    | SPI CLK  | MAX31855 × 2 (shared clock) |
| 8    | FAN_PIN  | Fan driver — PWM 20 kHz or SSR digital |
| 15   | MAX1CS   | ET thermocouple chip select (exhaust) |
| 16   | MAX2CS   | BT thermocouple chip select (bean) |
| 17   | CRACK_RX | Serial2 RX ← crack listener UART TX |
| 18   | CRACK_TX | Serial2 TX (not currently used) |
| 41   | I2C SDA  | OLED SSD1306 + MLX90614 IR probe |
| 42   | I2C SCL  | OLED SSD1306 + MLX90614 IR probe |
| 43   | USB CDC TX | Upload / serial monitor |
| 44   | USB CDC RX | Upload / serial monitor |
| 48   | NeoPixel | Onboard status pixel (red = booting, green = ready) |

> **S3 Mini alternate pinout** — set `-D S3MINI` in build_flags.
> HEATER=18, FAN=21, MAX CLK=33, MISO=35, ET_CS=37, BT_CS=39, I2C same.
> Pick different CRACK_RX/TX pins (e.g. 19/20) since GPIO 18 is HEATER on S3 Mini.

### Crack listener board (separate ESP32-S3)

| GPIO | Signal | Notes |
|-----:|--------|-------|
| 13   | I2S SD  | INMP441 / ICS-43434 mic data |
| 14   | I2S SCK | Mic bit clock |
| 15   | I2S WS  | Mic word select |
| 16   | UART RX | ← main board (currently unused) |
| 17   | UART TX | → main board CRACK_RX (GPIO 17) |
| 48   | NeoPixel | Status LED |

Wire crack listener GPIO 17 → main board GPIO 17, and a shared GND.

> **Important:** the `Serial2.printf("CRACK,...")` line in
> `cracks/src/main.cpp` is commented out. Uncomment it so the listener
> actually transmits over UART.

### IR probe (MLX90614)

The MLX90614 shares the I2C bus with the OLED.  Default I2C address
`0x5A` — no jumpers needed.

| MLX90614 pin | Connect to |
|---|---|
| VCC | 3.3 V |
| GND | GND |
| SDA | GPIO 41 |
| SCL | GPIO 42 |

The probe reads **object temperature** (drum/bean surface → CH3) and
**ambient temperature** (board ambient → CH4). Both channels show `0.0`
if no sensor is detected at boot.

---

## Temperature channels

| Artisan channel | Node name | Source |
|:---:|---|---|
| 1 | `ET` | Exhaust thermocouple (MAX31855 #1) |
| 2 | `BT` | Bean thermocouple (MAX31855 #2) |
| 3 | `CH3` | MLX90614 object temperature (IR surface) |
| 4 | `CH4` | MLX90614 ambient temperature |

---

## Artisan configuration (step by step)

### 1 — Add devices

**Config → Device → ET/BT** tab → click **+** → choose **WebSocket**.
This gives you channels 1 (ET) and 2 (BT).

To add channels 3 and 4 → click **+** again → choose **WebSocket 34**.

### 2 — WebSocket port settings

**Config → Ports → WebSocket** tab:

| Field | Value |
|---|---|
| Host | `yaeger.local` (or the device IP) |
| Port | `80` |
| Path | `/ws` |
| Command node | `command` |
| Message ID node | `id` |
| Machine ID node | `machine` |
| Data node | `data` |
| getData request tag | `getData` |
| Timeout (s) | `3` |

### 3 — Channel node names

Still in the WebSocket tab, under **Devices**:

| Channel | Node |
|---|---|
| ET (ch 1) | `ET` |
| BT (ch 2) | `BT` |
| CH3 (ch 3) | `CH3` |
| CH4 (ch 4) | `CH4` |

### 4 — Sliders (heater + fan)

**Config → Devices → Sliders** tab:

| Slider | Label | Action |
|---|---|---|
| Burner | Burner | `send({"command":"setBurner","value":{BurnerSlider}})` |
| Air | Air | `send({"command":"setFan","value":{AirSlider}})` |

Set both sliders min = `0`, max = `100`.

### 5 — Buttons (events + safety)

**Config → Devices → Buttons** tab → click **+** for each:

| Button | Action |
|---|---|
| All Off | `send({"command":"allOff"})` |

### 6 — Enable push events

**Config → Events** tab → check **CHARGE**, **DROP**, **FCs**, **FCe**,
**DRY** so Artisan accepts the unsolicited messages Yaeger sends.

---

## Push events — device → Artisan

Yaeger can push these at any time without being polled:

| JSON Yaeger sends | Artisan effect |
|---|---|
| `{"message":"CHARGE"}` | Marks charge, optionally starts recording |
| `{"message":"DROP"}` | Marks drop, optionally stops recording |
| `{"message":"FCs"}` | Marks first crack start |
| `{"message":"FCe"}` | Marks first crack end |
| `{"message":"DRY"}` | Marks dry end |
| `{"message":"SCs"}` | Marks second crack start |

First crack is fired automatically when the crack listener board sends a
`CRACK,...` line over UART. The others can be added as dashboard buttons
in the Yaeger web UI if needed.

---

## Workflow

1. Power on Yaeger. OLED shows IP; status pixel turns green.
2. Open Artisan → click **ON**. Artisan connects and begins polling
   `getData` at its configured sample rate.
3. Use Artisan's **Burner** and **Air** sliders to set heater and fan.
4. Press Artisan's **Charge** button when you drop beans — or wire a
   dashboard button to `send({"command":"allOff"})` for safety.
5. First crack fires automatically from the microphone board.
6. End roast in Artisan (**Drop** button), then use the Air slider to
   ramp fan for cool-down.

The Yaeger web dashboard at `yaeger.local` remains a live viewer showing
ET, BT, IR surface temp, heater %, and fan % in real time.
