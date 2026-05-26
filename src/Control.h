#ifndef CONTROL_H
#define CONTROL_H

#include <cstdint>
#include "vendor/AutoTunePID.h"
#include "pwm.h"
#include "sensor.h"

const char *modeToChar(OperationalMode mode);

enum class TemperatureTarget {
  BT,
  ET,
  MAX
};

// One profile control point in absolute time from roast start.
// 0xFF in `fan` means "no fan command at this point" (sentinel).
struct ProfilePoint {
  float timeSec;
  float setpoint;
  uint8_t fan;
};

static const int MAX_PROFILE_POINTS = 32;

// One row of the roast history. Stored at 1 Hz for the duration of the roast.
// Compact (16 B) so a 30-min buffer is ~56 KB.
struct RoastSample {
  uint16_t elapsedSec; // seconds since roast start (~18h max)
  uint16_t setpoint;   // °C, no fractional precision needed for history
  int16_t et;          // °C × 10
  int16_t bt;          // °C × 10
  uint8_t fan;         // 0-100
  uint8_t burner;      // 0-100
  uint8_t flags;       // reserved
  uint8_t _pad;
};

static const int HISTORY_CAPACITY = 1800; // 30 min @ 1 Hz

inline const char* TargetToString(TemperatureTarget t)
{
  switch (t)
  {
    case TemperatureTarget::BT:   return "BT";
    case TemperatureTarget::MAX: return "MAX";
    default:      return "ET";
  }
}

inline TemperatureTarget StringToTarget(const String& s)
{
  if (s.equals("BT"))  return TemperatureTarget::BT;
  if (s.equals("MAX"))  return TemperatureTarget::MAX;
  return TemperatureTarget::ET;
}

class Control {
private:
  AutoTunePID _autotune;
  TemperatureTarget _temperatureTarget;
  PwmOutput *_pwmFan;   // owned; null when in SSR fan mode
  int _fanPin;
  bool _fanSsrMode;
  bool _ssrFanOn;
  PwmOutput _heater;
  Sensor _etSensor;
  Sensor _btSensor;
  const uint8_t noUpdateBeforeMs = 20; // 50 Hz
  unsigned long lastUpdate;
  bool tuningEnabled;
  bool hasResults;

  // Active profile (in RAM only — uploaded by webapp on Start Roast)
  ProfilePoint _profilePoints[MAX_PROFILE_POINTS];
  int _profilePointCount = 0;
  bool _following = false;
  unsigned long _roastStartMs = 0;
  int _fanOffset = 0; // ±25, applied to profile fan command

  // 1 Hz history buffer (circular)
  RoastSample _history[HISTORY_CAPACITY];
  int _historyHead = 0;   // index of oldest entry if full
  int _historyCount = 0;
  unsigned long _lastHistorySampleMs = 0;

  // For safety watchdog
  unsigned long _lastWsActivityMs = 0;

  // Private helper methods
  float getTemperature() const;
  void applyProfileAt(float elapsedSec);
  void recordHistorySample();

public:
  Control(float kp, float ki, float kd, TemperatureTarget target, bool fanSsrMode);
  ~Control();

  // PID gain configuration
  void setPidValues(float kp, float ki, float kd);
  float getKp() const;
  float getKi() const;
  float getKd() const;

  // Setpoint control
  void setSetpoint(float setpoint);
  float getSetpoint() const;

  // Heater control
  void setHeater(float value);
  float getHeater() const;

  // Fan control
  void setFan(float value);
  float getFan() const;

  float getExhaustTemp() const;
  float getBeanTemp() const;
  float getAmbientTemp() const;

  // Temperature target selection
  void setTemperatureTarget(TemperatureTarget target);
  const char* getTemperatureTarget() const;

  // Operational mode
  void setMode(OperationalMode mode);
  OperationalMode getMode();

  // Autotuning
  void startAutotune();
  void resetAutotune();
  bool hasAutotuneResults() const;

  // Active profile execution (firmware drives PID setpoint + fan from this)
  void setActiveProfile(const ProfilePoint *points, int count);
  int getActiveProfileCount() const { return _profilePointCount; }
  const ProfilePoint &getActiveProfilePoint(int i) const { return _profilePoints[i]; }
  void startRoast();
  void endRoast();
  void allOff();
  bool isFollowing() const { return _following; }
  unsigned long getRoastStartMs() const { return _roastStartMs; }
  float getRoastElapsedSec() const;
  void setFanOffset(int offset);
  int getFanOffset() const { return _fanOffset; }

  // History buffer
  int getHistoryCount() const { return _historyCount; }
  // Returns sample by chronological index (0 = oldest).
  const RoastSample &getHistorySample(int chronologicalIdx) const;
  void clearHistory();

  // Watchdog: webapp pings this on every incoming WebSocket activity.
  // Used by the safety check to detect prolonged disconnect.
  void noteWsActivity();
  unsigned long getMsSinceWsActivity() const;

  // Main control loop
  void loop();
};

#endif // CONTROL_H
