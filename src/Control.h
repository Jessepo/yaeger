#ifndef CONTROL_H
#define CONTROL_H

#include <cstdint>
#include <freertos/FreeRTOS.h>
#include <freertos/portmacro.h>
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

  // Active profile (in RAM only — uploaded by webapp on Start Roast).
  // _profileMux guards _profilePoints[] and _profilePointCount: the WS
  // callback runs on AsyncTCP's FreeRTOS task while Control::loop runs on
  // the main Arduino task, so without a mutex the main loop could read a
  // half-updated profile during a live-edit and compute a garbage
  // setpoint (which would drop heater output to 0).
  ProfilePoint _profilePoints[MAX_PROFILE_POINTS];
  int _profilePointCount = 0;
  portMUX_TYPE _profileMux = portMUX_INITIALIZER_UNLOCKED;
  bool _following = false;
  unsigned long _roastStartMs = 0;
  int _fanOffset = 0; // ±25, applied to profile fan command

  // For safety watchdog
  unsigned long _lastWsActivityMs = 0;

  // Private helper methods
  float getTemperature() const;
  void applyProfileAt(float elapsedSec);

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
  // Atomically copy the current active profile into `outPoints` (must have
  // room for MAX_PROFILE_POINTS).  Returns the count copied.  Use this
  // from any thread other than the main loop (e.g. WS request handlers)
  // to avoid racing with setActiveProfile.
  int snapshotActiveProfile(ProfilePoint *outPoints);
  void startRoast();
  void endRoast();
  void allOff();
  bool isFollowing() const { return _following; }
  unsigned long getRoastStartMs() const { return _roastStartMs; }
  float getRoastElapsedSec() const;
  void setFanOffset(int offset);
  int getFanOffset() const { return _fanOffset; }

  // Watchdog: webapp pings this on every incoming WebSocket activity.
  // Used by the safety check to detect prolonged disconnect.
  void noteWsActivity();
  unsigned long getMsSinceWsActivity() const;

  // Main control loop
  void loop();
};

#endif // CONTROL_H
