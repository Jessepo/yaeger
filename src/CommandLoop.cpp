#include "CommandLoop.h"
#include "logging.h"
#include "Control.h"
#include <ArduinoJson.h>
#include <cmath>
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

void WSRequestHandler::onWsEvent(AsyncWebSocket *server, AsyncWebSocketClient *client,
                                 AwsEventType type, void *arg, uint8_t *data, size_t len) {
  switch (type) {
    case WS_EVT_CONNECT:
      logf("[%u] Connected!\n", client->id());
      // client->text("Connected");

      break;
    case WS_EVT_DISCONNECT: {
      logf("[%u] Disconnected!\n", client->id());
      // turn off heater and set fan to 100% when not under PID control
      if (this->control->getMode() == OperationalMode::Manual && control->getHeater() > 0.f) {
        control->setHeater(0.f);
        control->setFan(100.f);
      }
    }
    break;
    case WS_EVT_DATA: {
      auto *info = (AwsFrameInfo *) arg;

      String msg = "";
      /*if (info->opcode != WS_TEXT || !info->final) {*/
      /*  break;*/
      /*}*/

      for (size_t i = 0; i < info->len; i++) {
        msg += (char) data[i];
      }


      JsonDocument doc;

      // DEBUG WEBSOCKET
      // logf("[%u] get Text: %s\n", num, payload);

      // Extract Values lt. https://arduinojson.org/v6/example/http-client/
      // Artisan Anleitung: https://artisan-scope.org/devices/websockets/

      deserializeJson(doc, msg);

      // Any incoming command counts as activity for the safety watchdog.
      control->noteWsActivity();

      long ln_id = doc["id"].as<long>();


      if (!doc["Mode"].isNull() && strncmp(doc["Mode"].as<const char *>(), "Manual", 6) == 0) {
        control->setMode(OperationalMode::Manual);
      }

      if (!doc["Mode"].isNull() && strncmp(doc["Mode"].as<const char *>(), "PID", 3) == 0) {
        control->setMode(OperationalMode::Auto);
      }

      if (!doc["BurnerVal"].isNull()) {
        auto val = doc["BurnerVal"].as<float>();
        if (DEBUG) logf("BurnerVal: %6.1lf\n", val);
        // DimmerVal = doc["BurnerVal"].as<long>();
        control->setHeater(val);
      }

      if (!doc["Setpoint"].isNull()) {
        auto setpoint = doc["Setpoint"].as<float>();
        if (DEBUG) logf("Setpoint: %6.1lf\n", setpoint);
        control->setSetpoint(setpoint);
      }

      if (!doc["FanVal"].isNull()) {
        auto fanVal = doc["FanVal"].as<float>();
        if (DEBUG) logf("FanVal: %6.1lf\n", fanVal);
        control->setFan(fanVal);
      }

      if (!doc["Target"].isNull()) {
        String targetInput = doc["Target"];
        auto target = StringToTarget(targetInput);
        control->setTemperatureTarget(target);
        preferences->putString(temperatureTargetKey, targetInput);
      }

      // Send Values to Artisan over Websocket
      const char *command = doc["command"].as<const char *>();
      if (command != nullptr && strncmp(command, "setBurner", 9) == 0) {
        auto val = doc["value"].as<float>();
        if (DEBUG) logf("BurnerVal: %d\n", val);
        control->setHeater(val);
      }
      if (command != nullptr && strncmp(command, "setFan", 6) == 0) {
        auto val = doc["value"].as<float>();
        if (DEBUG) logf("FanVal: %d\n", val);
        control->setFan(val);
      }

      if (command != nullptr && strncmp(command, "autotune", 8) == 0) {
        if (control->getFan() < 30) control->setFan(60);
        control->startAutotune();
      }

      // ----- New: firmware-owned profile execution ------------------------
      // The webapp uploads the profile once, then hands off control. After
      // this we no longer need per-tick Setpoint/FanVal commands during a
      // roast; the firmware drives them autonomously from the loaded points.
      auto parseProfilePoints = [&doc](ProfilePoint *out, int maxCount) -> int {
        JsonArray arr = doc["points"].as<JsonArray>();
        if (arr.isNull()) return 0;
        int n = 0;
        for (JsonObject p : arr) {
          if (n >= maxCount) break;
          out[n].timeSec = p["time"].as<float>();
          out[n].setpoint = p["setpoint"].as<float>();
          if (p["fan"].isNull()) {
            out[n].fan = 0xFF;
          } else {
            int f = p["fan"].as<int>();
            if (f < 0) f = 0;
            if (f > 100) f = 100;
            out[n].fan = (uint8_t)f;
          }
          n++;
        }
        return n;
      };

      if (command != nullptr &&
          (strncmp(command, "setActiveProfile", 16) == 0 ||
           strncmp(command, "updateActiveProfile", 19) == 0)) {
        ProfilePoint pts[MAX_PROFILE_POINTS];
        int n = parseProfilePoints(pts, MAX_PROFILE_POINTS);
        control->setActiveProfile(pts, n);
        if (DEBUG) logf("active profile loaded: %d points", n);
      }

      if (command != nullptr && strncmp(command, "startRoast", 10) == 0) {
        control->startRoast();
        log("roast started");
      }

      if (command != nullptr && strncmp(command, "endRoast", 8) == 0) {
        control->endRoast();
        log("roast ended");
      }

      if (command != nullptr && strncmp(command, "allOff", 6) == 0) {
        control->allOff();
        log("all off");
      }

      if (command != nullptr && strncmp(command, "setFanOffset", 12) == 0) {
        int off = doc["value"].as<int>();
        control->setFanOffset(off);
      }

      if (command != nullptr && strncmp(command, "setPreferences", 14) == 0) {
        if (!doc["pidKp"].isNull() && !doc["pidKi"].isNull() && !doc["pidKd"].isNull()) {
          auto pidKp = doc["pidKp"].as<float>();
          auto pidKi = doc["pidKi"].as<float>();
          auto pidKd = doc["pidKd"].as<float>();
          preferences->putFloat(pidPKey, pidKp);
          preferences->putFloat(pidIKey, pidKi);
          preferences->putFloat(pidDKey, pidKd);
          control->setPidValues(pidKp, pidKi, pidKd);
        }

        if (!doc["cooldownFanSpeed"].isNull()) {
          long cooldownFanSpeed = doc["cooldownFanSpeed"].as<long>();
          if (DEBUG) logf("cooldownFanSpeed: %d\n", cooldownFanSpeed);
          preferences->putLong(coolingFanKey, cooldownFanSpeed);
        }

        if (!doc["fanMode"].isNull()) {
          // "pwm" or "ssr" — applied at next boot.
          String fanMode = doc["fanMode"].as<const char *>();
          if (fanMode == "pwm" || fanMode == "ssr") {
            preferences->putString(fanModeKey, fanMode);
            if (DEBUG) logf("fanMode: %s (reboot to apply)", fanMode.c_str());
          }
        }


        if (!doc["wifiSsid"].isNull() && !doc["wifiPass"].isNull()) {
          if (DEBUG) log("Wifi Credentials found, saving...");
          String wifiSSID = doc["wifiSsid"];
          if (DEBUG) log(wifiSSID.c_str());
          preferences->putString(wifiSSIDKey, wifiSSID);
          String wifiPass = doc["wifiPass"];
          log(wifiPass.c_str());
          preferences->putString(wifiPassKey, wifiPass);
        }
      }

      if (command != nullptr && (strncmp(command, "setPreferences", 14) == 0 || strncmp(command, "getPreferences", 14)
                                 ==
                                 0)) {
        JsonObject root = doc.to<JsonObject>();
        JsonObject resultData = root["data"].to<JsonObject>();

        root["id"] = ln_id;
        resultData["type"] = "preferences";
        resultData["pidKp"] = preferences->getFloat(pidPKey, 1.0);
        resultData["pidKi"] = preferences->getFloat(pidIKey, 0.1);
        resultData["pidKd"] = preferences->getFloat(pidDKey, 0.01);
        resultData["cooldownFanSpeed"] = preferences->getLong(coolingFanKey, 50);
        resultData["fanMode"] = preferences->getString(fanModeKey, "pwm");

        char buffer[200]; // create temp buffer
        serializeJson(doc, buffer); // serialize to buffer
        // DEBUG WEBSOCKET
        if (DEBUG) log(buffer);

        client->text(buffer);
      }

      // Webapp asks for full roast state on (re)connect so it can rebuild
      // its local view. Includes the active profile points + flags.
      if (command != nullptr && strncmp(command, "getRoastState", 13) == 0) {
        JsonDocument resp;
        JsonObject root = resp.to<JsonObject>();
        root["id"] = ln_id;
        JsonObject d = root["data"].to<JsonObject>();
        d["type"] = "roastState";
        d["following"] = control->isFollowing();
        d["roastElapsedSec"] = control->getRoastElapsedSec();
        d["fanOffset"] = control->getFanOffset();
        d["historyCount"] = control->getHistoryCount();
        JsonArray pts = d["profile"].to<JsonArray>();
        for (int i = 0; i < control->getActiveProfileCount(); i++) {
          const ProfilePoint &p = control->getActiveProfilePoint(i);
          JsonObject o = pts.add<JsonObject>();
          o["time"] = p.timeSec;
          o["setpoint"] = p.setpoint;
          if (p.fan != 0xFF) o["fan"] = (int)p.fan;
        }
        String out;
        serializeJson(resp, out);
        client->text(out);
      }

      // Webapp asks for the 1 Hz history buffer (backfill the chart on
      // reconnect). At 1 Hz × 30 min cap = 1800 samples ≈ 50 KB JSON.
      if (command != nullptr && strncmp(command, "getRoastHistory", 15) == 0) {
        JsonDocument resp;
        JsonObject root = resp.to<JsonObject>();
        root["id"] = ln_id;
        JsonObject d = root["data"].to<JsonObject>();
        d["type"] = "roastHistory";
        JsonArray arr = d["samples"].to<JsonArray>();
        int n = control->getHistoryCount();
        for (int i = 0; i < n; i++) {
          const RoastSample &s = control->getHistorySample(i);
          JsonObject o = arr.add<JsonObject>();
          o["t"] = s.elapsedSec;
          o["et"] = s.et / 10.0f;
          o["bt"] = s.bt / 10.0f;
          o["sp"] = s.setpoint;
          o["fan"] = s.fan;
          o["bur"] = s.burner;
        }
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
  if (millis() - _lastUpdate < 100)
    return; // Max update frequency 100ms

  JsonDocument doc;
  JsonObject root = doc.to<JsonObject>();
  JsonObject resultData = root["data"].to<JsonObject>();

  resultData["type"] = "status";
  resultData["ET"] = control->getExhaustTemp();
  resultData["BT"] = control->getBeanTemp();
  resultData["Amb"] = control->getAmbientTemp();
  resultData["BurnerVal"] = control->getHeater();
  resultData["Setpoint"] = control->getSetpoint();
  resultData["Target"] = control->getTemperatureTarget();
  resultData["Mode"] = modeToChar(control->getMode());
  resultData["FanVal"] = control->getFan();
  resultData["pidKp"] = control->getKp();
  resultData["pidKi"] = control->getKi();
  resultData["pidKd"] = control->getKd();
  resultData["wifiStrength"] = WiFi.RSSI();
  // Roast execution state — webapp uses these to reflect firmware-owned roast.
  resultData["following"] = control->isFollowing();
  resultData["roastElapsedSec"] = control->getRoastElapsedSec();
  resultData["historyCount"] = control->getHistoryCount();

  String output;
  serializeJson(doc, output);
  this->ws->textAll(output);
  this->_lastUpdate = millis();
}
