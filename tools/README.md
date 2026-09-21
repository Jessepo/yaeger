# Crack Detector Tuner

A browser-based tool for tuning the FFT crack detection parameters on the Yaeger crack listener board without needing a live roast.

## What it does

Streams raw I2S audio from the crack listener board over USB, plays it through your speakers in real-time, and runs the same FFT detection logic as the firmware — with sliders to adjust the parameters live.

- **Scrolling spectrogram** — frequency on the X axis (0–8 kHz), time scrolls upward. The detection band is highlighted yellow; magnitude above threshold turns red.
- **FFT bar chart** — instant view of the current frame's magnitudes. Dashed orange line = threshold. Red bars = detection triggered.
- **CRACK DETECTED** indicator — flashes whenever the JS detection logic would fire, using the same bin-by-bin check as the firmware.
- **Three sliders** that mirror the firmware `#define` values:
  | Slider | Firmware constant | Default |
  |---|---|---|
  | Low freq | `LOCRACKF` | 6000 Hz |
  | High freq | `HICRACKF` | 8000 Hz |
  | Threshold | `CRACK_THRESHOLD` | 600,000 |

Once you find good values here, update the constants in `cracks/src/main.cpp` and reflash.

## Requirements

- Chrome or Edge (Web Serial API)
- Crack listener board connected via USB
- A local HTTP server (Web Serial doesn't work from `file://`)

## Setup

### 1. Flash the firmware

Make sure the crack listener board is running the latest firmware from `cracks/`. Monitor mode support was added alongside this tool — if the board is running older firmware, the tool will connect but receive no frames.

Also verify that `Serial2.printf("CRACK,...")` is **uncommented** in `cracks/src/main.cpp` if you want the UART trigger to reach the main board during a real roast.

### 2. Serve the tool

```sh
cd tools
npx serve .
```

Then open `http://localhost:3000/crack-tuner.html` in Chrome or Edge.

### 3. Connect

1. Plug the crack listener board into USB.
2. Click **Connect Board** and select the board's serial port from the browser dialog.
3. Audio starts immediately. The board enters monitor mode (streams raw PCM; crack detection pauses on the board while streaming).
4. Click **Disconnect** or close the tab to stop. The board returns to normal crack detection.

## Workflow

1. Run the tool during a roast (or replay a session) and listen for first crack.
2. Watch the spectrogram for the burst of energy in the 6–8 kHz range that crack events produce.
3. Adjust **Low freq** / **High freq** to bracket the actual crack energy you see.
4. Adjust **Threshold** until the CRACK indicator fires reliably on real cracks but not on ambient noise. Lower = more sensitive.
5. Transfer the tuned values back to `cracks/src/main.cpp`:
   ```cpp
   #define CRACK_THRESHOLD  <your value>
   #define LOCRACKF         <your value>
   #define HICRACKF         <your value>
   ```
6. Reflash.

## How monitor mode works

When the browser connects, it sends the byte `'m'` over USB serial. The board's `loop()` reads this and switches to streaming mode: each iteration sends a 514-byte binary frame (`0xAA 0x55` sync header + 256 × int16 PCM samples) instead of running the FFT. Sending `'x'` returns to normal mode.

The tool's JS FFT uses the same Hann window and bin-to-frequency mapping as the firmware. Sample values are scaled by ×4 to match the firmware's `raw[i] >> 14` representation, so threshold values are directly comparable.
