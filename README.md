# Yaeger

ESP32-S3 coffee roaster controller. Artisan drives the roast via WebSocket; the firmware handles hardware I/O, safety, and first-crack detection.

## Architecture

```
Artisan (PC) ──WebSocket──► ESP32-S3 (Dual-Core 240 MHz)
                              ├─ Core 1: Roaster Control & Web Loop
                              │    ──SPI──► MAX31855 (ET, BT thermocouples)
                              │    ──I2C──► MLX90614 IR probe + SSD1306 OLED
                              │    ──PWM──► Heater SSR + Fan
                              │    ──1-Wire► Optional DHT22 sensor
                              │
                              └─ Core 0: Real-Time Crack Detector Task (FreeRTOS)
                                   ──I2S DMA──► INMP441 / ICS-43434 MEMS Mic
                                   Continuous 16 kHz audio → 256-pt Hann FFT
                                   Direct in-memory event → Artisan push {"message":"FCs"}
```

The firmware does not own profiles or PID loops. Artisan controls burner and fan via WebSocket sliders. The board enforces one safety rule: heater output is zero whenever the fan is off. Crack detection runs on Core 0 without blocking or jittering Core 1 roaster operations.

---

## Hardware Pinout (ESP32-S3 DevKitC-1 N16R8)

| GPIO | Function | Notes |
|------|----------|-------|
| 3 | Heater PWM | 50 Hz SSR signal |
| 4 | ARGB data | WS2812 status LED |
| 5 | SPI MISO | Shared thermocouple bus |
| 6 | SPI CLK | Shared thermocouple bus |
| 7 | DHT22 data | Optional ambient humidity/temperature sensor |
| 8 | Fan PWM | 20 kHz |
| 13 | I2S_MIC_SD | INMP441 / ICS-43434 MEMS mic serial data |
| 14 | I2S_MIC_SCK | INMP441 / ICS-43434 MEMS mic bit clock |
| 15 | ET CS | MAX31855 exhaust/inlet air thermocouple chip select |
| 16 | BT CS | MAX31855 bean thermocouple chip select |
| 17 | I2S_MIC_WS | INMP441 / ICS-43434 MEMS mic word select |
| 41 | I2C SDA | MLX90614 IR probe + SSD1306 OLED |
| 42 | I2C SCL | MLX90614 IR probe + SSD1306 OLED |
| 43 | USB CDC TX | Upload / serial monitor |
| 44 | USB CDC RX | Upload / serial monitor |
| 48 | Onboard NeoPixel | Status indicator (boot, ready, mic hit/crack detection) |

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

## Acoustic First-Crack Detector (Integrated Core 0 Task)

An integrated FreeRTOS task on **Core 0** continuously analyzes audio from an I2S MEMS microphone (INMP441 or ICS-43434) to detect the acoustic signature of coffee first-crack pops and pushes events to Artisan automatically.

### Multi-Core FreeRTOS Design
- **Core 0 (PRO_CPU):** Runs the `CrackDetector` task at priority 2. Blocks on I2S DMA until 256 samples arrive (~16 ms), computes a 256-point Hann-windowed FFT in ~0.4 ms (< 3% CPU utilization), and checks band magnitudes. Completely isolated from Core 1's sensor stalls and display refreshes.
- **Core 1 (APP_CPU):** Runs the main roaster control loop, MAX31855 SPI reads, PWM/SSR controls, and OLED display.
- **Direct Event Dispatch:** When 3 hits occur within the debounce window (3 seconds), the task sets an atomic flag. The WebSocket loop picks it up and pushes `{"message":"FCs"}` to Artisan and the web dashboard without UART latency or string parsing.

### Microphone Pinout

| Mic Pin (INMP441 / ICS-43434) | ESP32-S3 GPIO | Notes |
|:-----------------------------:|:-------------:|-------|
| VDD | 3.3 V | Power |
| GND | GND | Ground |
| L/R | GND | Left channel |
| SD  | GPIO 13 | Serial Data (`I2S_MIC_SD_PIN`) |
| SCK | GPIO 14 | Bit Clock (`I2S_MIC_SCK_PIN`) |
| WS  | GPIO 17 | Word Select (`I2S_MIC_WS_PIN` — moved from GPIO 15 to avoid conflict with `MAX1CS`) |

### Onboard Status NeoPixel (GPIO 48)
- **Idle:** Dim green (indicates ready / detecting)
- **Audio Hit:** Bright green flash (100 ms) whenever frequency magnitude crosses threshold
- **Crack Confirmed:** Red flash (500 ms) when 3 hits occur within 3 seconds
- **Monitor Mode:** Blue (active audio streaming to tuner tool)

### Detection Parameters (Stored in NVS)

| Parameter | Default | Description |
|-----------|---------|-------------|
| `loFreq` | 3500 Hz | Lower bound of crack frequency band |
| `hiFreq` | 7500 Hz | Upper bound of crack frequency band |
| `threshold` | 35000 | FFT magnitude threshold for detection |

### Tuning the Crack Detector

You can tune the detector live using **`tools/crack-tuner.html`** or the dashboard Crack Tuner panel:
1. Connect the ESP32-S3 via USB at 115200 baud.
2. The tool sends command `m` to enter monitor mode (streams raw 16 kHz int16 PCM audio with `0xAA 0x55` header). While in monitor mode, text logging to `Serial` is muted automatically.
3. Adjust **Low freq**, **High freq**, and **Threshold** sliders while listening to audio and viewing the real-time spectrogram.
4. Saving sends `s,<lo>,<hi>,<thresh>` to persist new values to NVS namespace `crack`.
5. Disconnecting sends `x` to restore standard detection mode and resume serial logging.

Run tuner standalone:
```sh
cd tools && npx serve .
# Open http://localhost:3000/crack-tuner.html in Chrome or Edge
```

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
| Burner | `{"id":1,"command":"setBurner","value":{}}` |
| Fan | `{"id":1,"command":"setFan","value":{}}` |

**Push events** (Config → Device → WebSocket → Enable push events):
- `FCs` → First crack start event (fired automatically by the I2S crack detector)

---

## Building

### Roaster Firmware (includes Crack Detector)
```sh
pio run --target upload
```

### Miniweb (dashboard UI)
```sh
cd miniweb/
npm install
npm run build      # outputs to ../data/
pio run --target uploadfs
```

---

## Repository Layout

```
cracks/          Legacy standalone crack listener firmware (prototype)
miniweb/         Dashboard web UI (VanJS + TypeScript, served from LittleFS)
PCB/             PCB manufacturing files (Gerbers, BOM)
schema/          Schematics and board PDFs
src/             Unified roaster & crack detector firmware (ESP32-S3, Arduino/PlatformIO)
tools/           Development utilities (crack-tuner.html)
```
