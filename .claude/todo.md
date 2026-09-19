
## Crack detection tuning

Record raw I2S audio from the crack listener board during a roast, then
build a playback tool to replay the recording against the FFT/threshold
logic. Goal: listen to what was captured and dial in CRACK_THRESHOLD and
frequency bin range (currently 6–8 kHz) without needing a live roast.

Probably needs:
- A record mode on the listener board (dump raw I2S samples to UART or
  save to flash)
- A desktop script or web tool that plays back the audio and simulates
  the detection logic with adjustable parameters
