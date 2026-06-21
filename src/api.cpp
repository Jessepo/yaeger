#include "logging.h"
#include <ESPAsyncWebServer.h>
#include <Preferences.h>
#include <LittleFS.h>
#include <ArduinoJson.h>

const char* ROASTS_DIR = "/roasts";
const int MAX_ROASTS = 5;
const char* PROFILES_DIR = "/profiles";
const int MAX_PROFILES = 8;

static String sanitizeName(String n) {
  n.replace("/", "_");
  n.replace("\\", "_");
  n.replace(":", "_");
  return n;
}

// Strip directory prefix and ".json" suffix so the client sees user-facing
// names (e.g. "second profile") rather than the on-disk path
// ("/profiles/second profile.json").
static String basenameNoExt(const String &p) {
  int slash = p.lastIndexOf('/');
  String n = slash >= 0 ? p.substring(slash + 1) : p;
  if (n.endsWith(".json")) n = n.substring(0, n.length() - 5);
  return n;
}

#include "preferenceKeys.h"

void setupApi(AsyncWebServer *server, Preferences *preferences) {
  log("setting up api");
  server->on("/api/wifi", HTTP_GET, [preferences](AsyncWebServerRequest *request) {
    if (!request->hasParam("ssid") || !request->hasParam("pass")) {
      AsyncWebServerResponse *response = request->beginResponse(400);
      request->send(response);
      return;
    }

    const char *ssid = request->getParam("ssid")->value().c_str();
    const char *pass = request->getParam("pass")->value().c_str();

    preferences->putString(wifiSSIDKey, ssid);
    preferences->putString(wifiPassKey, pass);
    logf("saving to prefs, ssid: %s", ssid);
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
      File dir = LittleFS.open(ROASTS_DIR);
      int fileCount = 0;
      File file = dir.openNextFile();
      while (file) {
        fileCount++;
        file = dir.openNextFile();
      }
      
      if (fileCount >= MAX_ROASTS && !LittleFS.exists(filePath.c_str())) {
        request->send(400, "text/plain", "Maximum roasts stored (5)");
        return;
      }
    }
    
    // Write data chunks to file
    static File f;
    if (index == 0) {
      f = LittleFS.open(filePath, "w");
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
    File dir = LittleFS.open(ROASTS_DIR);
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
        roast["name"] = basenameNoExt(file.name());
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
    
    if (!LittleFS.exists(filePath.c_str())) {
      request->send(404, "text/plain", "Roast not found");
      return;
    }
    
    // Read file and send
    File file = LittleFS.open(filePath, "r");
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

    if (LittleFS.remove(filePath.c_str())) {
      logf("Deleted roast: %s", filePath.c_str());
      request->send(200, "application/json", "{\"status\":\"deleted\"}");
    } else {
      request->send(500, "text/plain", "Failed to delete roast");
    }
  });

  // ------- Profile storage --------------------------------------------------

  // Save profile (chunked body, JSON payload)
  server->on("/api/profile/save", HTTP_POST,
    [](AsyncWebServerRequest *request) { /* completion in body handler */ },
    nullptr,
    [](AsyncWebServerRequest *request, uint8_t *data, size_t len, size_t index, size_t total) {
      if (!request->hasParam("name")) {
        if (index == 0) request->send(400, "text/plain", "Missing profile name");
        return;
      }
      String profileName = sanitizeName(request->arg("name"));
      String filePath = String(PROFILES_DIR) + "/" + profileName + ".json";

      // Enforce MAX_PROFILES at the start of the upload
      if (index == 0) {
        File dir = LittleFS.open(PROFILES_DIR);
        int fileCount = 0;
        File file = dir.openNextFile();
        while (file) {
          fileCount++;
          file = dir.openNextFile();
        }
        if (fileCount >= MAX_PROFILES && !LittleFS.exists(filePath.c_str())) {
          request->send(400, "text/plain", "Maximum profiles stored (8). Delete one first.");
          return;
        }
      }

      static File pf;
      if (index == 0) {
        pf = LittleFS.open(filePath, "w");
        logf("Saving profile to %s", filePath.c_str());
      }
      if (pf && len > 0) pf.write(data, len);
      if (index + len == total) {
        if (pf) pf.close();
        logf("Profile saved (%u bytes)", total);
        request->send(200, "application/json", "{\"status\":\"saved\"}");
      }
    });

  // List saved profiles
  server->on("/api/profile/list", HTTP_GET, [](AsyncWebServerRequest *request) {
    File dir = LittleFS.open(PROFILES_DIR);
    if (!dir || !dir.isDirectory()) {
      request->send(500, "text/plain", "Cannot open profiles directory");
      return;
    }
    JsonDocument doc;
    JsonArray profiles = doc["profiles"].to<JsonArray>();
    File file = dir.openNextFile();
    while (file) {
      if (!file.isDirectory() && String(file.name()).endsWith(".json")) {
        JsonObject p = profiles.add<JsonObject>();
        p["name"] = basenameNoExt(file.name());
        p["size"] = file.size();
      }
      file = dir.openNextFile();
    }
    String output;
    serializeJson(doc, output);
    request->send(200, "application/json", output);
  });

  // Load a profile
  server->on("/api/profile/load", HTTP_GET, [](AsyncWebServerRequest *request) {
    if (!request->hasParam("name")) {
      request->send(400, "text/plain", "Missing profile name");
      return;
    }
    String name = sanitizeName(request->getParam("name")->value());
    String filePath = String(PROFILES_DIR) + "/" + name + ".json";
    if (!LittleFS.exists(filePath.c_str())) {
      request->send(404, "text/plain", "Profile not found");
      return;
    }
    File f = LittleFS.open(filePath, "r");
    if (!f) {
      request->send(500, "text/plain", "Failed to read profile");
      return;
    }
    String body;
    while (f.available()) body += (char)f.read();
    f.close();
    request->send(200, "application/json", body);
  });

  // Delete a profile
  server->on("/api/profile/delete", HTTP_DELETE, [](AsyncWebServerRequest *request) {
    if (!request->hasParam("name")) {
      request->send(400, "text/plain", "Missing profile name");
      return;
    }
    String name = sanitizeName(request->getParam("name")->value());
    String filePath = String(PROFILES_DIR) + "/" + name + ".json";
    if (LittleFS.remove(filePath.c_str())) {
      logf("Deleted profile: %s", filePath.c_str());
      request->send(200, "application/json", "{\"status\":\"deleted\"}");
    } else {
      request->send(500, "text/plain", "Failed to delete profile");
    }
  });
}
