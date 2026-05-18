#ifndef CONTROL_H
#define CONTROL_H

#include "vendor/AutoTunePID.h"
#include "pwm.h"
#include "sensor.h"

const char *modeToChar(OperationalMode mode);

enum class TemperatureTarget {
  BT,
  ET,
  MAX
};

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
  PwmOutput _fan;
  PwmOutput _heater;
  Sensor _etSensor;
  Sensor _btSensor;
  const uint8_t noUpdateBeforeMs = 20; // 50 Hz
  unsigned long lastUpdate;
  bool tuningEnabled;
  bool hasResults;

  // Private helper methods
  float getTemperature() const;

public:
  Control(float kp, float ki, float kd, TemperatureTarget target);
  ~Control() = default;

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

  // Main control loop
  void loop();
};

#endif // CONTROL_H
