#include "CrackDetector.h"
#include "config.h"
#include "logging.h"
#include <arduinoFFT.h>
#include <driver/i2s.h>
#include <Adafruit_NeoPixel.h>
#include <Preferences.h>
#include <atomic>

#define SAMPLES 256
#define SAMPLING_FREQUENCY 16000

extern Adafruit_NeoPixel pixels;

static ArduinoFFT<float> FFT = ArduinoFFT<float>();
static float vReal[SAMPLES];
static float vImag[SAMPLES];
static int32_t raw[SAMPLES];

static Preferences _crackPrefs;
static std::atomic<bool> _crackPending{false};
static std::atomic<bool> _monitorMode{false};
static TaskHandle_t _taskHandle = nullptr;

// Atomics so Core 0 task and Core 1 loop() can safely read/write these concurrently
static std::atomic<int> loFreq{3500};
static std::atomic<int> hiFreq{7500};
static std::atomic<int> crackThresh{35000};
static const int delaytime = 3000;

// LED state — written from any core via requestLedColor(), applied to pixels hardware
// only from Core 1 via updateLed(). Adafruit_NeoPixel/RMT is not thread-safe.
static std::atomic<uint32_t> _ledColor{0};
static std::atomic<uint32_t> _ledExpireMillis{0};
static std::atomic<bool>     _ledDirty{false};

static void requestLedColor(uint8_t r, uint8_t g, uint8_t b, unsigned long durationMs = 0) {
  _ledColor.store(Adafruit_NeoPixel::Color(r, g, b), std::memory_order_relaxed);
  _ledExpireMillis.store(durationMs > 0 ? (uint32_t)(millis() + durationMs) : 0,
                         std::memory_order_relaxed);
  _ledDirty.store(true, std::memory_order_release);
}

void CrackDetector::begin() {
  _crackPrefs.begin("crack", false);
  loFreq.store(_crackPrefs.getInt("loFreq", 3500));
  hiFreq.store(_crackPrefs.getInt("hiFreq", 7500));
  crackThresh.store(_crackPrefs.getInt("threshold", 35000));

  logf("[CrackDetector] Init: lo=%d hi=%d thresh=%d\n", loFreq.load(), hiFreq.load(), crackThresh.load());

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
    .bck_io_num = I2S_MIC_SCK_PIN,
    .ws_io_num = I2S_MIC_WS_PIN,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num = I2S_MIC_SD_PIN
  };

  esp_err_t err = i2s_driver_install(I2S_NUM_0, &i2s_config, 0, NULL);
  if (err != ESP_OK) {
    logf("[CrackDetector] Failed to install I2S driver: %d\n", err);
    return;
  }
  i2s_set_pin(I2S_NUM_0, &pin_config);
  log("[CrackDetector] I2S driver initialized on Core 0");

  xTaskCreatePinnedToCore(
    taskEntry,
    "CrackDetector",
    6144,
    nullptr,
    2,
    &_taskHandle,
    0 // Pin to Core 0
  );
}

bool CrackDetector::popCrackEvent() {
  return _crackPending.exchange(false);
}

bool CrackDetector::isMonitorMode() {
  return _monitorMode.load();
}

void CrackDetector::setMonitorMode(bool enabled) {
  _monitorMode.store(enabled);
  if (enabled) {
    requestLedColor(0, 0, 150); // Blue for monitor mode
  } else {
    requestLedColor(0, 20, 0);  // Dim green for normal detection
  }
}

int CrackDetector::getLoFreq()    { return loFreq.load(); }
int CrackDetector::getHiFreq()    { return hiFreq.load(); }
int CrackDetector::getThreshold() { return crackThresh.load(); }

void CrackDetector::setParams(int lo, int hi, int thresh) {
  loFreq.store(lo);
  hiFreq.store(hi);
  crackThresh.store(thresh);
  _crackPrefs.putInt("loFreq", lo);
  _crackPrefs.putInt("hiFreq", hi);
  _crackPrefs.putInt("threshold", thresh);
  logf("[CrackDetector] Params saved: lo=%d hi=%d thresh=%d\n", lo, hi, thresh);
}

void CrackDetector::processSerialCommand(const String &cmd) {
  if (cmd == "m") {
    setMonitorMode(true);
    return;
  }
  if (cmd == "x") {
    setMonitorMode(false);
    return;
  }
  if (cmd.startsWith("s,")) {
    int c1 = cmd.indexOf(',', 2);
    int c2 = cmd.indexOf(',', c1 + 1);
    if (c1 > 0 && c2 > 0) {
      int lo = cmd.substring(2, c1).toInt();
      int hi = cmd.substring(c1 + 1, c2).toInt();
      int th = cmd.substring(c2 + 1).toInt();
      setParams(lo, hi, th);
    }
  }
}

// Called only from Core 1 (loop()) — the only place that touches pixels hardware
void CrackDetector::updateLed() {
  uint32_t exp = _ledExpireMillis.load(std::memory_order_relaxed);
  if (exp > 0 && millis() >= exp) {
    _ledExpireMillis.store(0, std::memory_order_relaxed);
    uint32_t idleColor = _monitorMode.load()
      ? Adafruit_NeoPixel::Color(0, 0, 150)
      : Adafruit_NeoPixel::Color(0, 20, 0);
    _ledColor.store(idleColor, std::memory_order_relaxed);
    _ledDirty.store(true, std::memory_order_release);
  }
  if (_ledDirty.exchange(false, std::memory_order_acq_rel)) {
    pixels.setPixelColor(0, _ledColor.load(std::memory_order_relaxed));
    pixels.show();
  }
}

void CrackDetector::taskEntry(void *pvParameters) {
  int counttime = 0;
  bool isthis1stcount = false, isthis2ndcount = false, isthis3rdcount = false;
  unsigned long recordmillis1 = 0, recordmillis2 = 0, recordmillis3 = 0;

  for (;;) {
    size_t bytes_read = 0;
    esp_err_t res = i2s_read(I2S_NUM_0, raw, sizeof(raw), &bytes_read, portMAX_DELAY);
    if (res != ESP_OK || bytes_read == 0) {
      vTaskDelay(pdMS_TO_TICKS(10));
      continue;
    }

    // Monitor mode: stream raw PCM frames to USB Serial (sync 0xAA 0x55 + 256*int16)
    if (_monitorMode.load()) {
      uint8_t hdr[2] = {0xAA, 0x55};
      Serial.write(hdr, 2);
      int16_t pcm[SAMPLES];
      for (int i = 0; i < SAMPLES; i++) {
        pcm[i] = (int16_t)(raw[i] >> 16);
      }
      Serial.write((uint8_t*)pcm, SAMPLES * sizeof(int16_t));
      continue;
    }

    // Normal detection mode: run FFT
    for (int i = 0; i < SAMPLES; i++) {
      vReal[i] = (float)(raw[i] >> 14);
      vImag[i] = 0.0f;
    }

    FFT.windowing(vReal, SAMPLES, FFT_WIN_TYP_HANN, FFT_FORWARD);
    FFT.compute(vReal, vImag, SAMPLES, FFT_FORWARD);
    FFT.complexToMagnitude(vReal, vImag, SAMPLES);

    bool hitInFrame = false;
    float hitFreq = 0.0f;
    float hitMag = 0.0f;

    int loF   = loFreq.load(std::memory_order_relaxed);
    int hiF   = hiFreq.load(std::memory_order_relaxed);
    int thresh = crackThresh.load(std::memory_order_relaxed);

    for (int i = 2; i <= SAMPLES / 2; i++) {
      float freq = i * 1.0f * SAMPLING_FREQUENCY / SAMPLES;
      if (freq >= (float)loF && freq <= (float)hiF && vReal[i] > (float)thresh) {
        hitInFrame = true;
        hitFreq = freq;
        hitMag = vReal[i];
        break; // Count at most 1 hit per 16ms frame
      }
    }

    if (hitInFrame) {
      if (!isthis1stcount) {
        recordmillis1 = millis();
        isthis1stcount = true;
        counttime = 1;
      } else if (!isthis2ndcount) {
        recordmillis2 = millis();
        isthis2ndcount = true;
        counttime = 2;
      } else if (!isthis3rdcount) {
        recordmillis3 = millis();
        isthis3rdcount = true;
        counttime = 3;
      }

      requestLedColor(0, 180, 0, 100); // Bright green indicator for hit
    }

    // Check 3-hit detection window
    if (isthis1stcount && isthis3rdcount) {
      unsigned long elapsed = recordmillis3 - recordmillis1;
      if (elapsed <= (unsigned long)delaytime) {
        _crackPending.store(true);
        requestLedColor(150, 0, 0, 500); // Red flash on crack trigger
      }
      isthis1stcount = isthis2ndcount = isthis3rdcount = false;
      recordmillis1 = recordmillis2 = recordmillis3 = 0;
      counttime = 0;
    }

    // Check timeout if hits don't reach 3 within window
    if (isthis1stcount && (millis() - recordmillis1 > (unsigned long)delaytime)) {
      isthis1stcount = isthis2ndcount = isthis3rdcount = false;
      recordmillis1 = recordmillis2 = recordmillis3 = 0;
      counttime = 0;
    }
  }
}
