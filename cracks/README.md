# Yaeger Crack Listener

A standalone ESP32-S3 firmware that listens for **first crack** and
**second crack** pops during a coffee roast and reports them to the
main Yaeger roaster controller over UART. The main controller turns
each report into a chart event, the same as if you'd pressed the
"First Crack" button on the dashboard — except it happens
automatically the moment the bean actually cracks.

The listener is fully independent from the main roaster firmware. It
builds and flashes separately, runs on its own board, and only shares a
few pins (TX/RX + GND) with the rest of the system.

## How it works

1. An I2S MEMS microphone (e.g. INMP441, ICS-43434) samples audio at
   **16 kHz**, 32-bit, mono.
2. Every **256 samples (~16 ms)** the firmware runs a Hann-windowed
   **FFT** to get the magnitude of each frequency bin.
3. It scans the bins between **6 kHz and 8 kHz** — the sharp,
   high-frequency band where coffee cracks live — and checks if any of
   them exceeds the magnitude threshold (`CRACK_THRESHOLD`).
4. A simple "three hits within 3 seconds" debounce avoids one-off
   transients (paper rustle, drum bang). When three near-by hits land
   inside the window, the firmware emits a UART message:

   ```
   CRACK,<count>,<elapsed_ms>\n
   ```

   `count` is the hit count (1–3), `elapsed_ms` is the span from the
   first to the third hit. The onboard NeoPixel flashes red for 500 ms
   on each send so you can see it firing in real life.
5. Cracks past the 3-second window reset the state machine and the
   listener starts a fresh scan.

## Hardware

- **MCU**: ESP32-S3 DevKitC-1 (or any ESP32-S3 board with an onboard
  NeoPixel on GPIO 48 and a free UART)
- **Microphone**: I2S MEMS mic on
  - `SCK` → GPIO 14
  - `WS`  → GPIO 15
  - `SD`  → GPIO 13
  - `VDD` / `GND` to 3V3 / GND
  - `L/R` to GND (left channel, matches `I2S_CHANNEL_FMT_ONLY_LEFT`)
- **UART link to main board**:
  - listener **TX (GPIO 17)** → main board **RX**
  - listener **RX (GPIO 16)** → main board **TX** (optional, currently
    unused — listener doesn't process incoming commands)
  - **common GND** between the two boards
  - 115200 8N1
- **NeoPixel**: onboard, GPIO 48 (DevKitC-1's built-in RGB LED).
  - green: a candidate hit was just detected
  - red flash (500 ms): a full crack event was sent
  - off: idle

## Install

### Prerequisites
- [PlatformIO Core](https://platformio.org/install/cli) or the
  PlatformIO VS Code extension
- USB cable to the ESP32-S3

### Build & flash
From the repo root:

```sh
pio run --project-dir cracks --target upload
```

Or from inside the `cracks/` directory:

```sh
pio run --target upload
```

The first build will download the espressif32 platform and the two
required libraries (`arduinoFFT`, `Adafruit NeoPixel`).

### Monitor
```sh
pio device monitor --project-dir cracks --baud 115200
```

You'll see `[DBG]` lines for every candidate hit and every `CRACK,...`
message that gets sent.

## UART protocol

One ASCII line per detected crack, terminated by `\n`:

```
CRACK,<count>,<elapsed_ms>\n
```

| Field        | Type   | Meaning                                              |
|--------------|--------|------------------------------------------------------|
| `count`      | int    | Number of detected hits in this group (1–3)          |
| `elapsed_ms` | uint32 | Milliseconds from the first to the third hit         |

That's the whole protocol — easy to parse with a single `sscanf` or
`String.split` on the main-board side.

## Tuning knobs

All at the top of `src/main.cpp`:

| `#define`           | Default | What to change it for                            |
|---------------------|---------|--------------------------------------------------|
| `SAMPLING_FREQUENCY`| 16000   | Higher → catches higher-pitched cracks but burns more CPU |
| `SAMPLES`           | 256     | Bigger → finer freq resolution, more latency      |
| `LOCRACKF` / `HICRACKF` | 6000 / 8000 | Adjust the watched band if cracks land elsewhere |
| `CRACK_THRESHOLD`   | 1000    | Lower → more sensitive (more false positives)     |
| `delaytime`         | 3000 ms | Width of the 3-hit debounce window                |

If you're getting false positives from drum noise, raise
`CRACK_THRESHOLD`. If real cracks are being missed, lower it and watch
the `[DBG]` log to see what magnitudes your mic actually produces.

## Layout

```
cracks/
├── platformio.ini   PIO env (esp32-s3-devkitc-1, arduinoFFT, NeoPixel)
├── src/
│   └── main.cpp     The listener
└── README.md        This file
```

Fully sibling-isolated from the main roaster firmware in
`../platformio.ini` — nothing in here affects the roaster build.
