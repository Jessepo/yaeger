#include "display.h"
#include "config.h"
#include "Control.h"
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1327.h>
#include <WiFi.h>

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 128
#define OLED_RESET -1

// Most 1.5" 128x128 SSD1327 I2C modules default to 0x3D (some to 0x3C)
#define OLED_I2C_ADDR_PRIMARY 0x3D
#define OLED_I2C_ADDR_SECONDARY 0x3C

static Adafruit_SSD1327 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

void initDisplay() {
  Wire.begin(DISPLAY_DA, DISPLAY_CL);
  Wire.setClock(400000); // 400kHz Fast I2C for 128x128 buffer transfer

  if (!display.begin(OLED_I2C_ADDR_PRIMARY)) {
    Serial.println("SSD1327 not detected at 0x3D, attempting 0x3C...");
    if (!display.begin(OLED_I2C_ADDR_SECONDARY)) {
      Serial.println("SSD1327 display failed to initialize on both 0x3D and 0x3C");
      return;
    }
  }
  display.clearDisplay();
  display.display();
}

void setWifiIP() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1327_WHITE);
  display.setCursor(0, 10);
  display.println("Yaeger online");
  display.setCursor(0, 30);
  display.print("IP: ");
  display.println(WiFi.localIP());
  display.display();
  delay(3000); // Show IP for 3 seconds before switching to main display
}

void updateDisplay(Control *control) {
  static unsigned long lastUpdate = 0;
  if (millis() - lastUpdate < 500) return;
  lastUpdate = millis();

  display.clearDisplay();
  display.setTextColor(SSD1327_WHITE);

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
  display.drawLine(0, 46, 127, 46, SSD1327_WHITE);

  // --- Heater & Fan Controls Row ---
  float heater = control->getHeater();
  float fan = control->getFan();

  display.setTextSize(1);
  display.setCursor(0, 52);
  display.print("Heater: ");
  display.print(heater, 0);
  display.print("%");

  // Heater bar (x=68, y=53, w=58, h=6)
  display.drawRect(68, 53, 58, 6, SSD1327_WHITE);
  int heaterWidth = (int)((heater / 100.0f) * 54.0f);
  if (heaterWidth > 0) {
    display.fillRect(70, 55, heaterWidth, 2, SSD1327_WHITE);
  }

  display.setCursor(0, 66);
  display.print("Fan:    ");
  display.print(fan, 0);
  display.print("%");

  // Fan bar (x=68, y=67, w=58, h=6)
  display.drawRect(68, 67, 58, 6, SSD1327_WHITE);
  int fanWidth = (int)((fan / 100.0f) * 54.0f);
  if (fanWidth > 0) {
    display.fillRect(70, 69, fanWidth, 2, SSD1327_WHITE);
  }

  // Divider 2
  display.drawLine(0, 78, 127, 78, SSD1327_WHITE);

  // --- Environmental / Extra Sensor Row ---
  display.setCursor(0, 84);
  if (control->getIRObjectTemp() > 0.0f) {
    display.print("IR:  ");
    display.print(control->getIRObjectTemp(), 1);
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
  } else {
    display.print("WiFi: Disconnected");
  }

  display.setCursor(0, 114);
  display.print("Yaeger Roaster");

  display.display();
}