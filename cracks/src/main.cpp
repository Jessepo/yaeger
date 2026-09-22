#include <Arduino.h>
#include "arduinoFFT.h"
#include <driver/i2s.h>
#include <Adafruit_NeoPixel.h>
#include <Preferences.h>

#define SAMPLES 256
#define SAMPLING_FREQUENCY 16000

#define I2S_WS  15
#define I2S_SCK 14
#define I2S_SD  13

#define PIN_NEOPIXEL 48

ArduinoFFT<float> FFT = ArduinoFFT<float>();
float vReal[SAMPLES], vImag[SAMPLES];
Adafruit_NeoPixel pixel(1, PIN_NEOPIXEL, NEO_GRB + NEO_KHZ800);

static bool monitorMode = true;
static Preferences crackPrefs;
static String cmdBuf = "";

// Detection parameters — loaded from NVS on boot, updated via 's,lo,hi,thresh\n' command
static int loFreq = 3500, hiFreq = 7500, crackThresh = 35000;

int crackcount = 0, counttime = 0;
bool isthis1stcount, isthis2ndcount, isthis3rdcount, newscan = 1;
unsigned long recordmillis1, recordmillis2, recordmillis3;
int delaytime = 3000;

void processCmd(const String &cmd) {
  if (cmd == "m") { monitorMode = true; return; }
  if (cmd == "x") { monitorMode = false; return; }
  if (cmd.startsWith("s,")) {
    int c1 = cmd.indexOf(',', 2);
    int c2 = cmd.indexOf(',', c1 + 1);
    if (c1 > 0 && c2 > 0) {
      loFreq    = cmd.substring(2, c1).toInt();
      hiFreq    = cmd.substring(c1 + 1, c2).toInt();
      crackThresh = cmd.substring(c2 + 1).toInt();
      crackPrefs.putInt("loFreq",    loFreq);
      crackPrefs.putInt("hiFreq",    hiFreq);
      crackPrefs.putInt("threshold", crackThresh);
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println("[DBG] Serial started");

  crackPrefs.begin("crack", false);
  loFreq     = crackPrefs.getInt("loFreq",    3500);
  hiFreq     = crackPrefs.getInt("hiFreq",    7500);
  crackThresh = crackPrefs.getInt("threshold", 35000);

  // Serial2.begin(115200, SERIAL_8N1, 16, 17);

  pixel.begin();
  Serial.println("[DBG] Pixel started");

  i2s_config_t i2s_config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = SAMPLING_FREQUENCY,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 4,
    .dma_buf_len = SAMPLES,
    .use_apll = false
  };
  i2s_pin_config_t pin_config = {
    .bck_io_num = I2S_SCK,
    .ws_io_num = I2S_WS,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num = I2S_SD
  };
  i2s_driver_install(I2S_NUM_0, &i2s_config, 0, NULL);
  Serial.println("[DBG] I2S driver installed");
  i2s_set_pin(I2S_NUM_0, &pin_config);
  Serial.println("[DBG] I2S pins set");
  Serial.printf("[DBG] Params: lo=%d hi=%d thresh=%d\n", loFreq, hiFreq, crackThresh);
  Serial.println("[DBG] Ready");
}

void loop() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n') {
      cmdBuf.trim();
      if (cmdBuf.length() > 0) processCmd(cmdBuf);
      cmdBuf = "";
    } else {
      cmdBuf += c;
    }
  }

  int32_t raw[SAMPLES];
  size_t bytes_read;
  i2s_read(I2S_NUM_0, raw, sizeof(raw), &bytes_read, portMAX_DELAY);

  if (monitorMode) {
    uint8_t hdr[2] = {0xAA, 0x55};
    Serial.write(hdr, 2);
    int16_t pcm[SAMPLES];
    for (int i = 0; i < SAMPLES; i++) pcm[i] = (int16_t)(raw[i] >> 16);
    Serial.write((uint8_t*)pcm, SAMPLES * 2);
    return;
  }

  for (int i = 0; i < SAMPLES; i++) {
    vReal[i] = (float)(raw[i] >> 14);
    vImag[i] = 0;
  }

  FFT.windowing(vReal, SAMPLES, FFT_WIN_TYP_HANN, FFT_FORWARD);
  FFT.compute(vReal, vImag, SAMPLES, FFT_FORWARD);
  FFT.complexToMagnitude(vReal, vImag, SAMPLES);

  for (int i = 2; i <= SAMPLES / 2; i++) {
    float freq = i * 1.0 * SAMPLING_FREQUENCY / SAMPLES;
    if (freq >= loFreq && freq <= hiFreq && vReal[i] > crackThresh) {
      Serial.printf("[DBG] freq=%.0f mag=%.0f\n", freq, vReal[i]);
      if (crackcount <= 4) crackcount++; else crackcount = 0;

      if (!isthis1stcount && newscan)      { recordmillis1 = millis(); isthis1stcount = 1; counttime++; newscan = 0; }
      else if (!isthis2ndcount && newscan) { recordmillis2 = millis(); isthis2ndcount = 1; counttime++; newscan = 0; }
      else if (!isthis3rdcount && newscan) { recordmillis3 = millis(); isthis3rdcount = 1; counttime++; newscan = 0; }

      pixel.setPixelColor(0, pixel.Color(0, 180, 0)); pixel.show();
    }
  }

  newscan = 1;
  pixel.setPixelColor(0, pixel.Color(0, 50, 0)); pixel.show();

  if (isthis1stcount && isthis3rdcount) {
    if ((recordmillis3 - recordmillis1) <= (unsigned long)delaytime && counttime <= 3) {
      // Serial2.printf("CRACK,%d,%lu\n", counttime, recordmillis3 - recordmillis1);
      Serial.printf("[DBG] CRACK sent: count=%d elapsed=%lums\n", counttime, recordmillis3 - recordmillis1);
      pixel.setPixelColor(0, pixel.Color(150, 0, 0)); pixel.show(); delay(500);
      pixel.setPixelColor(0, pixel.Color(0, 50, 0)); pixel.show();
      counttime = 0;
    }
    if ((recordmillis3 - recordmillis1) > (unsigned long)delaytime) {
      isthis1stcount = isthis2ndcount = isthis3rdcount = 0;
      recordmillis1 = recordmillis3 = 0; counttime = 0;
    }
  }
}
