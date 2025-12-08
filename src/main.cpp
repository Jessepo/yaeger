
#include <Adafruit_NeoPixel.h>
#include <ArduinoJson.h>
#include <ESPAsyncWebServer.h>
#include <ElegantOTA.h> //https://github.com/ayushsharma82/AsyncElegantOTA
#include <LittleFS.h>

#include "AsyncWebSocket.h"
#include "CommandLoop.h"
#include "HardwareSerial.h"
#include "IPAddress.h"
#include "WiFiType.h"
#include "api.h"
#include "config.h"
#include "display.h"
#include "fan.h"
#include "heater.h"
#include "logging.h"
#include "sensors.h"
#include "wifi_setup.h"

#define PIN 48
Adafruit_NeoPixel pixels(1, PIN);
// for ota
const char *host = "esp32 Roaster";
// Create AsyncWebServer object on port 80
/*WebServer server(80);*/
// Create a WebSocket object
AsyncWebSocket ws("/ws");
AsyncWebServer server(80);

void setupSimulation(AsyncWebSocket *ws);
void updateSimulation();

unsigned long ota_progress_millis = 0;
void onOTAStart() {
  // Log when OTA has started
  log("OTA update started!");
  // <Add your own code here>
  /*pixels.setPixelColor(0, pixels.Color(5,5,0));*/
  /*pixels.show();*/
}

void onOTAProgress(size_t current, size_t final) {
  // Log every 1 second
  if (millis() - ota_progress_millis > 1000) {
    ota_progress_millis = millis();
    logf("OTA Progress Current: %u bytes, Final: %u bytes\n", current, final);
  }
}

void onOTAEnd(bool success) {
  // Log when OTA has finished
  if (success) {
    log("OTA update finished successfully!");
  } else {
    log("There was an error during OTA update!");
  }
  // <Add your own code here>
  /*pixels.setPixelColor(0, pixels.Color(0,0,0));*/
  /*pixels.show();*/
}

void setup(void) {
  Serial.begin(115200);
  delay(1000); // Take some time to open up the Serial Monitor
  startSensors();
  pixels.begin();
  pixels.clear();
  pixels.setPixelColor(0, pixels.Color(5, 0, 0));
  pixels.show();

  // Wait for connection
  setupWifi();
  initDisplay();
  setWifiIP();

  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS failed");
  }
  server.serveStatic("/", LittleFS, "/").setDefaultFile("index.html");

  ElegantOTA.begin(&server); // Start ElegantOTA
  // ElegantOTA callbacks
  ElegantOTA.onStart(onOTAStart);
  ElegantOTA.onProgress(onOTAProgress);
  ElegantOTA.onEnd(onOTAEnd);

  setupLogging(&server);

  // WebSocket handler
#ifndef SIMULATIONS
  setupMainLoop(&ws);
#else
  setupSimulation(&ws);
#endif // !SIMULATIONS
  server.addHandler(&ws);

  // API
  setupApi(&server);

  server.begin();
  log("HTTP server started");
  pixels.clear();
  pixels.setPixelColor(0, pixels.Color(0, 5, 0));
  pixels.show();

  initFan();
  initHeater();
}

void loop(void) {
  ElegantOTA.loop();
  ws.cleanupClients();
  delay(10);
  takeReadings();
  updateHeater();
#ifdef SIMULATIONS
  updateSimulation();
#endif
}

float tempRiseF = 0.0;
float currentTemp = 22.0;

void updateSimulation() {
  if (tempRiseF <= 1.0 && currentTemp > 22.0) {
    currentTemp -= 0.5;
    return;
  }
  currentTemp += tempRiseF * 0.1;
}

void setupSimulation(AsyncWebSocket *ws) {

  ws->onEvent([](AsyncWebSocket *server, AsyncWebSocketClient *client,
                 AwsEventType type, void *arg, uint8_t *data, size_t len) {
    switch (type) {
    case WS_EVT_CONNECT:
      logf("[%u] Connected!\n", client->id());
      // client->text("Connected");

      break;
    case WS_EVT_DISCONNECT: {
      logf("[%u] Disconnected!\n", client->id());
      // turn off heater and set fan to 100%
      setHeaterPower(0);
      setFanSpeed(100);
    } break;
    case WS_EVT_DATA: {

      AwsFrameInfo *info = (AwsFrameInfo *)arg;
#ifdef DEBUG
      logf("ws[%s][%u] %s-message[%llu]: ", server->url(), client->id(),
           (info->opcode == WS_TEXT) ? "text" : "binary", info->len);
      logf("final: %d\n", info->final);
#endif
      String msg = "";
      /*if (info->opcode != WS_TEXT || !info->final) {*/
      /*  break;*/
      /*}*/

      for (size_t i = 0; i < info->len; i++) {
        msg += (char)data[i];
      }
#ifdef DEBUG
      logf("msg: %s\n", msg.c_str());
#endif

      const size_t capacity = JSON_OBJECT_SIZE(3) + 60; // Memory pool
      DynamicJsonDocument doc(capacity);

      // DEBUG WEBSOCKET
      // logf("[%u] get Text: %s\n", num, payload);

      // Extract Values lt. https://arduinojson.org/v6/example/http-client/
      // Artisan Anleitung: https://artisan-scope.org/devices/websockets/

      deserializeJson(doc, msg);

      long ln_id = doc["id"].as<long>();
      // Get BurnerVal from Artisan over Websocket
      if (!doc["BurnerVal"].isNull()) {
        long val = doc["BurnerVal"].as<long>();
        tempRiseF = 0.1 * val;
        logf("temp rise: %.2f\n", tempRiseF);
        logf("BurnerVal: %d\n", val);
        setHeaterPower(val);
      }
      if (!doc["FanVal"].isNull()) {
        long val = doc["FanVal"].as<long>();
        logf("FanVal: %d\n", val);
        setFanSpeed(val);
      }

      // Send Values to Artisan over Websocket
      const char *command = doc["command"].as<const char *>();
      if (command != NULL && strncmp(command, "setBurner", 9) == 0) {
        long val = doc["value"].as<long>();
        tempRiseF = 0.1 * val;
        logf("temp rise: %.2f\n", tempRiseF);
        logf("BurnerVal: %d\n", val);
        setHeaterPower(val);
      }
      if (command != NULL && strncmp(command, "setFan", 6) == 0) {
        long val = doc["value"].as<long>();
        logf("FanVal: %d\n", val);
        setFanSpeed(val);
      }
      // if (command != NULL && strncmp(command, "getData", 7) == 0) {
        JsonObject root = doc.to<JsonObject>();
        JsonObject data = root.createNestedObject("data");
        root["id"] = ln_id;
        data["ET"] = currentTemp;       // Med_ExhaustTemp.getMedian()
        data["BT"] = currentTemp * 0.9; // Med_BeanTemp.getMedian();
        data["Amb"] = 22.0;
        data["BurnerVal"] = getHeaterPower(); // float(DimmerVal);
        data["FanVal"] = getFanSpeed();
      // }

      char buffer[200];                        // create temp buffer
      size_t len = serializeJson(doc, buffer); // serialize to buffer
      // DEBUG WEBSOCKET
      log(buffer);

      client->text(buffer);
      // send message to client
      // webSocket.sendTXT(num, "message here");

      // send data to all connected clients
      // webSocket.broadcastTXT("message here");
    } break;
    default: // send message to client
      logf("unhandled message type: %d\n", type);
      // webSocket.sendBIN(num, payload, length);
      break;
    }
  });
}
