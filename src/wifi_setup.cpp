#include "wifi_setup.h"

#include "WiFiType.h"
#include "esp32-hal.h"
#include "logging.h"
#include <Arduino.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <WiFi.h>

#include "config.h"
#include "preferenceKeys.h"


class WiFiParams {
private:
  Preferences *preferences;

public:
  WiFiParams(Preferences *p);
  ~WiFiParams() = default;

  bool hasCredentials();
   String getSSID();
   String getPass();
};

WiFiParams::WiFiParams(Preferences *p) {
  this->preferences = p;
}

bool WiFiParams::hasCredentials() {
  return this->preferences->isKey(wifiSSIDKey);
}


 String WiFiParams::getSSID() {
  return this->preferences->getString(wifiSSIDKey, INITIAL_WIFI_SSID);
}

 String WiFiParams::getPass() {
  return this->preferences->getString(wifiPassKey, INITIAL_WIFI_PASS);
}

void setupAP(WiFiParams params) {
  WiFi.mode(WIFI_AP);
  delay(100);
  WiFi.softAP("Yaeger");
  WiFi.setTxPower(WIFI_POWER_8_5dBm);
}

void connectToWifi(WiFiParams params) {
  WiFi.mode(WIFI_STA);

  WiFi.begin(params.getSSID(), params.getPass());
  WiFi.setTxPower(WIFI_POWER_8_5dBm);
  int wifiCounter = 0;
  while (WiFi.status() != WL_CONNECTED) {
    if (WiFi.status() == WL_CONNECT_FAILED) {
      log("Connect failed, restoring AP");
      setupAP(params);
      break;
    }
    wifiCounter++;
    delay(1000);
    log(".");
    if (wifiCounter > 10) {
      log("No connection after 10 seconds, restoring AP");
      WiFi.disconnect(true);
      delay(100);
      setupAP(params);
      break;
    }
  }
  log("");
  log("Connected to ");
  log(WiFi.SSID().c_str());
  log("IP address: ");
  log(WiFi.localIP().toString().c_str());
}

void setupWifi(Preferences *p) {
  auto params = WiFiParams(p);

  const char *hostname = "yaeger.local";
  WiFi.config(INADDR_NONE, INADDR_NONE, INADDR_NONE, INADDR_NONE);
  WiFi.setHostname(hostname);

  if (params.hasCredentials()) {
    log("trying to connect to wifi");
    connectToWifi(params);
  } else {
    log("no wifi data found, setting up AP");
    setupAP(params);
  }

  if (!MDNS.begin("yaeger")) {
    log("could not set up MDNS responder");
  }
}

