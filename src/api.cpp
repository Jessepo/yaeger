#include "logging.h"
#include "sensors.h"
#include "wifi_setup.h"
#include <ESPAsyncWebServer.h>
#include <Preferences.h>
#include <SPIFFS.h>
#include <ArduinoJson.h>

const char* ROASTS_DIR = "/spiffs/roasts";
const int MAX_ROASTS = 5;

void setupApi(AsyncWebServer *server) {
  log("setting up api");
  
  // Initialize SPIFFS if not already done
  if (!SPIFFS.begin(true)) {
    logf("SPIFFS Mount Failed");
  }
  
  // Create roasts directory if it doesn't exist
  if (!SPIFFS.exists(ROASTS_DIR)) {
    SPIFFS.mkdir(ROASTS_DIR);
  }
  
  server->on("/api/wifi", HTTP_GET, [](AsyncWebServerRequest *request) {
    if (!request->hasParam("ssid") || !request->hasParam("pass")) {
      AsyncWebServerResponse *response = request->beginResponse(400);
      request->send(response);
      return;
    }

    const char *ssid = request->getParam("ssid")->value().c_str();
    const char *pass = request->getParam("pass")->value().c_str();

    Preferences prefs;
    prefs.begin(wifiPrefsKey, false);
    prefs.putString(wifiSSIDKey, ssid);
    prefs.putString(wifiPassKey, pass);
    logf("saving to prefs, ssid: %s", ssid);

    prefs.end();
    request->send(200);
  });
  
  // Save roast to device storage
  server->on("/api/roast/save", HTTP_POST, [](AsyncWebServerRequest *request) {
    // Handle completion in body handler
  }, nullptr, [](AsyncWebServerRequest *request, uint8_t *data, size_t len, size_t index, size_t total) {
    if (!request->hasParam("name")) {
      if (index == 0) {
        request->send(400, "text/plain", "Missing roast name");
      }
      return;
    }
    
    String roastName = request->arg("name");
    // Sanitize filename
    roastName.replace("/", "_");
    roastName.replace("\\", "_");
    roastName.replace(":", "_");
    
    String filePath = String(ROASTS_DIR) + "/" + roastName + ".json";
    
    // Check max roasts limit on first chunk
    if (index == 0) {
      File dir = SPIFFS.open(ROASTS_DIR);
      int fileCount = 0;
      File file = dir.openNextFile();
      while (file) {
        fileCount++;
        file = dir.openNextFile();
      }
      
      if (fileCount >= MAX_ROASTS && !SPIFFS.exists(filePath.c_str())) {
        request->send(400, "text/plain", "Maximum roasts stored (5)");
        return;
      }
    }
    
    // Write data chunks to file
    static File f;
    if (index == 0) {
      f = SPIFFS.open(filePath, "w");
      logf("Opening file for writing: %s", filePath.c_str());
    }
    
    if (f && len > 0) {
      f.write(data, len);
    }
    
    // Close and send response when done
    if (index + len == total) {
      if (f) {
        f.close();
      }
      logf("Roast saved to %s, total bytes: %d", filePath.c_str(), total);
      request->send(200, "application/json", "{\"status\":\"saved\"}");
    }
  });
  
  // List saved roasts
  server->on("/api/roast/list", HTTP_GET, [](AsyncWebServerRequest *request) {
    File dir = SPIFFS.open(ROASTS_DIR);
    if (!dir || !dir.isDirectory()) {
      request->send(500, "text/plain", "Cannot open roasts directory");
      return;
    }
    
    JsonDocument doc;
    JsonArray roasts = doc["roasts"].to<JsonArray>();
    
    File file = dir.openNextFile();
    while (file) {
      if (!file.isDirectory() && String(file.name()).endsWith(".json")) {
        JsonObject roast = roasts.add<JsonObject>();
        roast["name"] = file.name();
        roast["size"] = file.size();
      }
      file = dir.openNextFile();
    }
    
    String output;
    serializeJson(doc, output);
    request->send(200, "application/json", output);
  });
  
  // Load roast from device storage
  server->on("/api/roast/load", HTTP_GET, [](AsyncWebServerRequest *request) {
    if (!request->hasParam("name")) {
      request->send(400, "text/plain", "Missing roast name");
      return;
    }
    
    String roastName = request->getParam("name")->value();
    roastName.replace("/", "_");
    roastName.replace("\\", "_");
    roastName.replace(":", "_");
    
    String filePath = String(ROASTS_DIR) + "/" + roastName + ".json";
    
    if (!SPIFFS.exists(filePath.c_str())) {
      request->send(404, "text/plain", "Roast not found");
      return;
    }
    
    // Read file and send
    File file = SPIFFS.open(filePath, "r");
    if (!file) {
      request->send(500, "text/plain", "Failed to read roast file");
      return;
    }
    
    String fileContent;
    while (file.available()) {
      fileContent += (char)file.read();
    }
    file.close();
    
    request->send(200, "application/json", fileContent);
  });
  
  // Delete roast from device storage
  server->on("/api/roast/delete", HTTP_DELETE, [](AsyncWebServerRequest *request) {
    if (!request->hasParam("name")) {
      request->send(400, "text/plain", "Missing roast name");
      return;
    }
    
    String roastName = request->getParam("name")->value();
    roastName.replace("/", "_");
    roastName.replace("\\", "_");
    roastName.replace(":", "_");
    
    String filePath = String(ROASTS_DIR) + "/" + roastName + ".json";
    
    if (SPIFFS.remove(filePath.c_str())) {
      logf("Deleted roast: %s", filePath.c_str());
      request->send(200, "application/json", "{\"status\":\"deleted\"}");
    } else {
      request->send(500, "text/plain", "Failed to delete roast");
    }
  });
}
