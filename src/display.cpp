#include "display.h"
#include "config.h"
#include "Control.h"
#include <Adafruit_GFX.h>
#include <Adafruit_SH110X.h>
#include <WiFi.h>

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 128
#define OLED_RESET -1

// Most 128x128 SH1107 I2C modules default to 0x3C (some to 0x3D)
#define OLED_I2C_ADDR_PRIMARY 0x3C
#define OLED_I2C_ADDR_SECONDARY 0x3D

static Adafruit_SH1107 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
static bool displayReady = false;

// TEMP diagnostic: list every I2C address that ACKs. Runs at 100kHz so weak
// pull-ups still work; if the OLED shows up here but begin() fails at
// 400kHz, suspect missing pull-up resistors.
// Set to 0 to disable, or delete this block and the #if in initDisplay().
#define I2C_SCAN_ON_BOOT 0

#if I2C_SCAN_ON_BOOT
static void scanI2C() {
  // USB CDC drops output sent before the monitor connects; wait up to 3s.
  unsigned long start = millis();
  while (!Serial && millis() - start < 3000) delay(10);

  Serial.printf("I2C scan on SDA=%d SCL=%d...\n", DISPLAY_DA, DISPLAY_CL);
  int found = 0;
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.printf("  found device at 0x%02X\n", addr);
      found++;
    }
  }
  Serial.printf("I2C scan done, %d device(s) found\n", found);
}
#endif

void initDisplay() {
  Wire.begin(DISPLAY_DA, DISPLAY_CL);
#if I2C_SCAN_ON_BOOT
  Wire.setClock(100000);
  scanI2C();
#endif
  Wire.setClock(400000); // 400kHz Fast I2C
  delay(100);

  if (!display.begin(OLED_I2C_ADDR_PRIMARY, true)) {
    Serial.println("SH1107 not detected at 0x3C, attempting 0x3D...");
    if (!display.begin(OLED_I2C_ADDR_SECONDARY, true)) {
      Serial.println("SH1107 display failed to initialize on both 0x3C and 0x3D");
      displayReady = false;
      return;
    }
  }
  displayReady = true;
  Serial.println("SH1107 initialized");
  display.clearDisplay();
  display.display();
}

void setWifiIP() {
  if (!displayReady) return;
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SH110X_WHITE);
  display.setCursor(0, 10);
  display.println("Yaeger online");
  display.setCursor(0, 30);
  display.print("IP: ");
  display.println(WiFi.localIP());
  display.display();
  delay(3000); // Show IP for 3 seconds before switching to main display
}

static void updateDisplay(Control *control) {
  if (!displayReady) return;

  display.clearDisplay();
  display.setTextColor(SH110X_WHITE);

  // --- Temperatures Row (ET / BT) ---
  // ET
  display.setTextSize(2);
  display.setCursor(0, 4);
  display.print("ET");
  display.setCursor(0, 24);
  display.print(control->getExhaustTemp(), 1);

  // BT
  display.setCursor(68, 4);
  display.print("BT");
  display.setCursor(68, 24);
  display.print(control->getBeanTemp(), 1);

  // Divider 1
  display.drawLine(0, 46, 127, 46, SH110X_WHITE);

  // --- Heater & Fan Controls Row ---
  float heater = control->getHeater();
  float fan = control->getFan();

  display.setTextSize(1);
  display.setCursor(0, 52);
  display.print("Heat: ");
  display.print(heater, 0);
  display.print("%");

  // Heater bar (x=68, y=53, w=58, h=6)
  display.drawRect(68, 53, 58, 6, SH110X_WHITE);
  int heaterWidth = (int)((heater / 100.0f) * 54.0f);
  if (heaterWidth > 0) {
    display.fillRect(70, 55, heaterWidth, 2, SH110X_WHITE);
  }

  display.setCursor(0, 66);
  display.print("Fan:  ");
  display.print(fan, 0);
  display.print("%");

  // Fan bar (x=68, y=67, w=58, h=6)
  display.drawRect(68, 67, 58, 6, SH110X_WHITE);
  int fanWidth = (int)((fan / 100.0f) * 54.0f);
  if (fanWidth > 0) {
    display.fillRect(70, 69, fanWidth, 2, SH110X_WHITE);
  }

  // Divider 2
  display.drawLine(0, 78, 127, 78, SH110X_WHITE);

  // --- Environmental / Extra Sensor Row ---
  display.setCursor(0, 84);
  float irTemp = control->getIRObjectTemp();
  if (irTemp > 0.0f) {
    display.print("IR:  ");
    display.print(irTemp, 1);
    display.print(" C");
  } else if (control->getDHTTemperature() > 0.0f) {
    display.print("Amb: ");
    display.print(control->getDHTTemperature(), 1);
    display.print("C  ");
    display.print(control->getDHTHumidity(), 0);
    display.print("%RH");
  } else {
    display.print("Amb: ");
    display.print(control->getAmbientTemp(), 1);
    display.print(" C");
  }

  // --- Network / System Status Row ---
  display.setCursor(0, 100);
  if (WiFi.isConnected()) {
    display.print("IP:  ");
    display.print(WiFi.localIP());
  } else if (WiFi.getMode() == WIFI_AP) {
    display.print("AP:  ");
    display.print(WiFi.softAPIP());
  } else {
    display.print("WiFi: Disconnected");
  }

  display.setCursor(0, 114);
  display.print("Yaeger Roaster");

  display.display();
}

// The full-screen I2C transfer takes ~40ms on SH1107 (2KB buffer), runs in its own task.
static void displayTask(void *arg) {
  Control *control = static_cast<Control *>(arg);
  for (;;) {
    updateDisplay(control);
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}

void startDisplayTask(Control *control) {
  xTaskCreatePinnedToCore(
    displayTask,
    "Display",
    4096,
    control,
    1,
    nullptr,
    1 // Pin to Core 1, same as loop()
  );
}