#include "CommandLoop.h"
#include "logging.h"
#include "Control.h"
#include <ArduinoJson.h>
#include <cstring>
#include <Preferences.h>
#include <WiFi.h>

#include "config.h"
#include "preferenceKeys.h"

WSRequestHandler::WSRequestHandler(AsyncWebSocket *ws, Control *control, Preferences *preferences) {
  using namespace std::placeholders;
  this->control = control;
  this->preferences = preferences;
  this->_lastUpdate = 0;
  this->ws = ws;
  this->ws->onEvent(std::bind(&WSRequestHandler::onWsEvent, this, _1, _2, _3, _4, _5, _6));
}

void WSRequestHandler::sendEvent(const char *event) {
  char buf[64];
  snprintf(buf, sizeof(buf), "{\"message\":\"%s\"}", event);
  ws->textAll(buf);
}

void WSRequestHandler::onWsEvent(AsyncWebSocket *server, AsyncWebSocketClient *client,
                                 AwsEventType type, void *arg, uint8_t *data, size_t len) {
  switch (type) {
    case WS_EVT_CONNECT:
      logf("[%u] Connected!\n", client->id());
      break;

    case WS_EVT_DISCONNECT:
      logf("[%u] Disconnected!\n", client->id());
      // If the last client leaves and the heater is on, kill it.
      if (ws->count() == 0 && control->getHeater() > 0.f) {
        control->allOff();
      }
      break;

    case WS_EVT_DATA: {
      auto *info = (AwsFrameInfo *) arg;
      String msg = "";
      for (size_t i = 0; i < info->len; i++) msg += (char) data[i];

      JsonDocument doc;
      deserializeJson(doc, msg);

      long ln_id = doc["id"].as<long>();

      // Artisan WebSocket protocol — Anleitung: https://artisan-scope.org/devices/websockets/
      const char *command = doc["command"].as<const char *>();

      if (command != nullptr && strncmp(command, "getData", 7) == 0) {
        JsonDocument resp;
        JsonObject root = resp.to<JsonObject>();
        root["id"] = ln_id;
        JsonObject d = root["data"].to<JsonObject>();
        d["ET"]  = control->getExhaustTemp();
        d["BT"]  = control->getBeanTemp();
        d["CH3"] = control->getIRObjectTemp();
        d["CH4"] = control->getIRAmbientTemp();
        d["CH5"] = control->getDHTTemperature();
        d["RH"]  = control->getDHTHumidity();
        String out;
        serializeJson(resp, out);
        client->text(out);
        return;
      }

      if (command != nullptr && strncmp(command, "setBurner", 9) == 0) {
        control->setHeater(doc["value"].as<float>());
        return;
      }

      if (command != nullptr && strncmp(command, "setFan", 6) == 0) {
        control->setFan(doc["value"].as<float>());
        return;
      }

      if (command != nullptr && strncmp(command, "allOff", 6) == 0) {
        control->allOff();
        log("all off");
        return;
      }

      // Dashboard manual sliders (same effect as Artisan setBurner/setFan)
      if (!doc["BurnerVal"].isNull()) {
        control->setHeater(doc["BurnerVal"].as<float>());
      }
      if (!doc["FanVal"].isNull()) {
        control->setFan(doc["FanVal"].as<float>());
      }

      if (command != nullptr &&
          (strncmp(command, "setPreferences", 14) == 0 ||
           strncmp(command, "getPreferences", 14) == 0)) {
        if (strncmp(command, "setPreferences", 14) == 0) {
          if (!doc["fanMode"].isNull()) {
            String fanMode = doc["fanMode"].as<const char *>();
            if (fanMode == "pwm" || fanMode == "ssr") {
              preferences->putString(fanModeKey, fanMode);
            }
          }
          if (!doc["btSource"].isNull()) {
            String bts = doc["btSource"].as<const char *>();
            if (bts == "bt" || bts == "ir" || bts == "avg") {
              preferences->putString(btSourceKey, bts);
            }
          }
          if (!doc["wifiSsid"].isNull() && !doc["wifiPass"].isNull()) {
            preferences->putString(wifiSSIDKey, doc["wifiSsid"].as<const char *>());
            preferences->putString(wifiPassKey, doc["wifiPass"].as<const char *>());
          }
        }

        JsonDocument resp;
        JsonObject root = resp.to<JsonObject>();
        root["id"] = ln_id;
        JsonObject d = root["data"].to<JsonObject>();
        d["type"]     = "preferences";
        d["fanMode"]  = preferences->getString(fanModeKey,  "pwm");
        d["btSource"] = preferences->getString(btSourceKey, "bt");
        String out;
        serializeJson(resp, out);
        client->text(out);
      }
    }
    break;

    default:
      logf("unhandled message type: %d\n", type);
      break;
  }
}

void WSRequestHandler::loop() {
  // Non-blocking UART read from crack listener board.
  // Each complete line starting with "CRACK" triggers a first-crack event
  // pushed to all connected WebSocket clients (Artisan + dashboard).
  while (Serial2.available()) {
    char c = (char) Serial2.read();
    if (c == '\n') {
      _crackLineBuf.trim();
      if (_crackLineBuf.startsWith("CRACK")) {
        log("First crack detected via UART — sending FCs event");
        sendEvent("FCs");
      }
      _crackLineBuf = "";
    } else {
      _crackLineBuf += c;
    }
  }

  if (millis() - _lastUpdate < 100) return;

  if (this->ws->count() == 0) {
    this->_lastUpdate = millis();
    return;
  }

  bool backpressured = false;
  for (const auto &c : this->ws->getClients()) {
    if (c.queueIsFull()) {
      backpressured = true;
      break;
    }
  }
  if (backpressured) {
    this->_lastUpdate = millis();
    return;
  }

  JsonDocument doc;
  JsonObject root = doc.to<JsonObject>();
  JsonObject d = root["data"].to<JsonObject>();

  d["type"]       = "status";
  d["ET"]         = control->getExhaustTemp();
  d["BT"]         = control->getBeanTemp();
  d["Amb"]        = control->getAmbientTemp();
  d["CH3"]        = control->getIRObjectTemp();
  d["CH4"]        = control->getIRAmbientTemp();
  d["CH5"]        = control->getDHTTemperature();
  d["RH"]         = control->getDHTHumidity();
  d["BurnerVal"]  = control->getHeater();
  d["FanVal"]     = control->getFan();
  d["wifiStrength"] = WiFi.RSSI();

  String output;
  serializeJson(doc, output);
  this->ws->textAll(output);
  this->_lastUpdate = millis();
}
