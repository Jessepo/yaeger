#include "leds.h"
#include "sensors.h"
#include <Adafruit_NeoPixel.h>

#define LED_PIN 4
#define LED_COUNT 8
#define BT_START 20.0f
#define BT_END 215.0f
#define ET_WARNING 400.0f

static Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);
static unsigned long lastPulseMillis = 0;
static bool pulseState = false;

// Color interpolation helper
static uint32_t tempColor(float t) {
  // t = 0.0 to 1.0
  // green -> yellow -> orange -> red
  if (t < 0.33f) {
    // green to yellow
    uint8_t r = (uint8_t)(t / 0.33f * 255);
    return strip.Color(r, 255, 0);
  } else if (t < 0.66f) {
    // yellow to orange
    uint8_t g = (uint8_t)(255 - ((t - 0.33f) / 0.33f * 128));
    return strip.Color(255, g, 0);
  } else {
    // orange to red
    uint8_t g = (uint8_t)(127 - ((t - 0.66f) / 0.34f * 127));
    return strip.Color(255, g, 0);
  }
}
void initAnimation() {
  // Phase 1: Knight Rider sweep (red, 3 passes)
  for (int pass = 0; pass < 3; pass++) {
    // Left to right
    for (int i = 0; i < LED_COUNT; i++) {
      strip.clear();
      strip.setPixelColor(i, strip.Color(255, 0, 0));
      if (i > 0) strip.setPixelColor(i - 1, strip.Color(60, 0, 0));   // trail
      if (i > 1) strip.setPixelColor(i - 2, strip.Color(15, 0, 0));   // fade
      strip.show();
      delay(60);
    }
    // Right to left
    for (int i = LED_COUNT - 1; i >= 0; i--) {
      strip.clear();
      strip.setPixelColor(i, strip.Color(255, 0, 0));
      if (i < LED_COUNT - 1) strip.setPixelColor(i + 1, strip.Color(60, 0, 0));
      if (i < LED_COUNT - 2) strip.setPixelColor(i + 2, strip.Color(15, 0, 0));
      strip.show();
      delay(60);
    }
  }

  // Phase 2: Fill green left to right
  for (int i = 0; i < LED_COUNT; i++) {
    strip.setPixelColor(i, strip.Color(0, 180, 0));
    strip.show();
    delay(80);
  }

  // Hold for a moment then clear
  delay(500);
  strip.clear();
  strip.show();
}
void initLeds() {
  strip.begin();
  strip.clear();
  strip.show();
}

void updateLeds() {
  float etbt[3];
  getETBTReadings(etbt);
  float bt = etbt[1];
  float et = etbt[0];

  // Check ET warning
  bool warning = et >= ET_WARNING;
  if (warning) {
    // Pulse red every 500ms
    if (millis() - lastPulseMillis >= 500) {
      lastPulseMillis = millis();
      pulseState = !pulseState;
    }
    uint32_t color = pulseState ? strip.Color(255, 0, 0) : strip.Color(0, 0, 0);
    for (int i = 0; i < LED_COUNT; i++) {
      strip.setPixelColor(i, color);
    }
    strip.show();
    return;
  }

  // Progress bar based on BT
  float progress = (bt - BT_START) / (BT_END - BT_START);
  if (progress < 0) progress = 0;
  if (progress > 1) progress = 1;

  // How many pixels to light up
  float pixelsLit = progress * LED_COUNT;

  for (int i = 0; i < LED_COUNT; i++) {
    if (i < (int)pixelsLit) {
      // Fully lit pixel — color based on position in strip
      strip.setPixelColor(i, tempColor((float)i / (LED_COUNT - 1)));
    } else if (i == (int)pixelsLit) {
      // Partially lit pixel — dim version of its color
      float fraction = pixelsLit - (int)pixelsLit;
      uint32_t c = tempColor((float)i / (LED_COUNT - 1));
      uint8_t r = ((c >> 16) & 0xFF) * fraction;
      uint8_t g = ((c >> 8) & 0xFF) * fraction;
      uint8_t b = (c & 0xFF) * fraction;
      strip.setPixelColor(i, strip.Color(r, g, b));
    } else {
      strip.setPixelColor(i, 0);
    }
  }
  strip.show();
}