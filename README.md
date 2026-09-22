# Yaeger

ESP32-S3 coffee roaster controller. Artisan drives the roast via WebSocket; the firmware handles hardware I/O, safety, and first-crack detection.

## Architecture

```
Artisan (PC) ──WebSocket──► ESP32-S3 main board ──SPI──► MAX31855 (ET, BT thermocouples)
                                                  ──I2C──► MLX90614 IR probe + SSD1306 OLED
                                                  ──PWM──► Heater SSR + Fan
                                                  ──UART──► Crack listener board
Crack listener board ────────────────────────────────────────────────────────────────────┘
  ESP32-S3 + INMP441 MEMS mic
  FFT-based first-crack detection → sends CRACK event over UART
  Main board relays → Artisan push event {"message":"FCs"}
```

The firmware does not own profiles or PID loops. Artisan controls burner and fan via WebSocket sliders. The board enforces one safety rule: heater output is zero whenever the fan is off.

---

## Main Board Hardware Pinout (ESP32-S3 DevKitC-1 N16R8)

| GPIO | Function | Notes |
|------|----------|-------|
| 3 | Heater PWM | 50 Hz SSR signal |
| 4 | ARGB data | WS2812 status LED |
| 5 | SPI MISO | Shared thermocouple bus |
| 6 | SPI CLK | Shared thermocouple bus |
| 7 | DHT22 data | Optional ambient humidity/temperature sensor |
| 8 | Fan PWM | 20 kHz |
| 15 | ET CS | MAX31855 exhaust/inlet air thermocouple |
| 16 | BT CS | MAX31855 bean thermocouple |
| 17 | CRACK RX (Serial2) | Receives UART from crack listener |
| 18 | CRACK TX (Serial2) | Not currently used |
| 41 | I2C SDA | MLX90614 IR probe + SSD1306 OLED |
| 42 | I2C SCL | MLX90614 IR probe + SSD1306 OLED |
| 43 | USB CDC TX | Debug serial |
| 44 | USB CDC RX | Debug serial |
| 48 | Onboard NeoPixel | Status indicator |

### Optional DHT22 ambient sensor
GPIO 7 is reserved for an optional DHT22 sensor. Wire it as:

- VCC → 3.3V
- GND → GND
- DATA → GPIO 7
- 10 kΩ pull-up from DATA to 3.3V

The device reports `CH5` (temperature) and `RH` (relative humidity) over the WebSocket status payload.

---

## Temperature Channels

| Channel | Sensor | Type | Notes |
|---------|--------|------|-------|
| CH1 / ET | MAX31855 (GPIO 15 CS) | K-type thermocouple via SPI | Exhaust / inlet air temperature |
| CH2 / BT | MAX31855 (GPIO 16 CS) | K-type thermocouple via SPI | Bean temperature |
| CH3 | MLX90614 (I2C) | IR non-contact | Object (surface) temperature |
| CH4 | MLX90614 (I2C) | IR non-contact | Ambient temperature |
| CH5 | DHT22 (GPIO 7) | Digital temp sensor | Optional ambient temperature |
| RH | DHT22 (GPIO 7) | Digital humidity sensor | Optional relative humidity |

CH1–CH5 and RH map directly to the WebSocket data payload. CH3/CH4 require the MLX90614 to be wired (see below). If the IR sensor is absent, `_irPresent = false` and the firmware returns 0 for CH3/CH4. If the DHT22 is absent, CH5 and RH read 0.

The **BT Source** setting in Device Settings lets you choose which sensor Artisan receives as the bean temperature (BT thermocouple, IR object, or average). Defaults to BT thermocouple.

---

## MLX90614 IR Probe Wiring

| MLX90614 pin | ESP32-S3 GPIO |
|---|---|
| VCC | 3.3 V |
| GND | GND |
| SDA | GPIO 41 |
| SCL | GPIO 42 |

The SSD1306 OLED shares the same I2C bus (address 0x3C). The MLX90614 is at address 0x5A.

---

## OLED Display (SSD1306)

128×64 I2C OLED on GPIO 41/42 (shared with MLX90614). Shows ET, BT, fan, and heater values. Address: 0x3C.

---

## Crack Listener Board

A separate ESP32-S3 with an INMP441 MEMS microphone. Listens continuously, runs an FFT on 256-sample windows at 16 kHz, and sends a UART message when it detects the acoustic signature of first crack.

### Crack listener pinout

| GPIO | Function |
|------|----------|
| 13 | I2S SD (INMP441 data) |
| 14 | I2S SCK (INMP441 clock) |
| 15 | I2S WS (INMP441 word select) |
| 16 | UART RX (from main board — not currently used) |
| 17 | UART TX → main board GPIO 17 |
| 48 | NeoPixel status LED |

### Detection parameters (stored in NVS)

| Parameter | Default | Description |
|-----------|---------|-------------|
| `loFreq` | 3500 Hz | Lower bound of crack frequency band |
| `hiFreq` | 7500 Hz | Upper bound of crack frequency band |
| `threshold` | 35000 | FFT magnitude threshold for detection |

**Note:** `monitorMode` in `cracks/src/main.cpp` is currently set to `true` (starts in audio-streaming mode on boot). Change to `false` for production use so crack detection runs automatically without the browser UI connected.

**Note:** `Serial2.printf("CRACK,...")` in `cracks/src/main.cpp` is commented out. Uncomment it for the UART trigger to reach the main board.

### Tuning the crack detector

Open the **Crack Tuner** panel in the yaeger.local dashboard (requires Chrome/Edge with Web Serial enabled for http://yaeger.local — see below). Connect to the crack listener board via USB. The panel shows a live spectrogram and FFT with adjustable frequency band and threshold sliders. Click **Save to Board** to persist new values to NVS.

To enable Web Serial on yaeger.local:
1. Open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
2. Add `http://yaeger.local` to the list
3. Relaunch Chrome

Standalone alternative: `cd tools && npx serve .` then open `http://localhost:3000/crack-tuner.html`.

---

## Artisan WebSocket Setup

**Config → Device → WebSocket**

| Field | Value |
|-------|-------|
| Host | `yaeger.local` |
| Port | `80` |
| Path | `/ws` |
| Protocol | - |
| Node names | ET, BT, CH3, CH4 |

**Config → Device → ET/BT Channels**: ET=CH1, BT=CH2

**Slider actions** (Config → Events → Sliders):

| Slider | Action |
|--------|--------|
| Burner | `{"id":1,"command":"setBurner","value":{})` |
| Fan | `{"id":1,"command":"setFan","value":{}}` |

**Push events** (Config → Device → WebSocket → Enable push events):
- `FCs` → First crack start event

---

## Building

### Main board firmware
```sh
cd yaeger/
pio run --target upload
```

### Miniweb (dashboard UI)
```sh
cd miniweb/
npm install
npm run build      # outputs to ../data/
pio run --target uploadfs
```

### Crack listener firmware
```sh
cd cracks/
pio run --target upload
```

---

## Repository Layout

```
cracks/          Crack listener board firmware (ESP32-S3 + INMP441)
miniweb/         Dashboard web UI (VanJS + TypeScript, served from LittleFS)
PCB/             PCB manufacturing files (Gerbers, BOM)
schema/          Schematics and board PDFs
src/             Main board firmware (ESP32-S3, Arduino/PlatformIO)
tools/           Development utilities (crack-tuner.html)
```
