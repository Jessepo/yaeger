#include "display.h"
#include "config.h"
#include "sensors.h"
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <WiFi.h>
#include "heater.h"
#include "fan.h"

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64

static Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

void initDisplay() {
  Wire.begin(DISPLAY_DA, DISPLAY_CL);
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("SSD1306 failed");
    return;
  }
  display.clearDisplay();
  display.display();
}

void setWifiIP() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("Yaeger online");
  display.setCursor(0, 16);
  display.print("IP: ");
  display.println(WiFi.localIP());
  delay(3000); // Show IP for 3 seconds before switching to main display
  display.display();
}

void updateDisplay() {
  float etbt[3];
  getETBTReadings(etbt);

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  // ET
  display.setTextSize(2);  // bigger header
  display.setCursor(0, 0);
  display.print("ET");

  display.setTextSize(2);
  display.setCursor(0, 18);  // moved down 8px
  display.print(etbt[0], 1);
 

  // BT
  display.setTextSize(2);  // bigger header
  display.setCursor(70, 0);
  display.print("BT");

  display.setTextSize(2);
  display.setCursor(70, 18);  // moved down 8px
  display.print(etbt[1], 1);
  

  // Divider
  display.drawLine(0, 35, 128, 35, SSD1306_WHITE);

  // Heater and fan on bottom row
  display.setTextSize(1);
  display.setCursor(0, 42);
  display.print("Heater: ");
  display.print(getHeaterPower());
  display.print("%");

  display.setCursor(0, 54);
  display.print("Fan:    ");
  display.print(getFanSpeed());
  display.print("%");


  display.display();
}