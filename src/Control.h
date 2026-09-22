#ifndef CONTROL_H
#define CONTROL_H

#include "pwm.h"
#include "sensor.h"
#include <Adafruit_MLX90614.h>
#include <DHT.h>

class Control {
private:
  PwmOutput *_pwmFan;
  int _fanPin;
  bool _fanSsrMode;
  bool _ssrFanOn;
  PwmOutput _heater;
  float _heaterVal = 0.f;
  Sensor _etSensor;
  Sensor _btSensor;
  Adafruit_MLX90614 _ir;
  DHT _dht;
  bool _irPresent = false;
  bool _dhtPresent = false;
  float _dhtTempC = 0.f;
  float _dhtHumidity = 0.f;
  const uint8_t noUpdateBeforeMs = 20;
  unsigned long lastUpdate = 0;

public:
  explicit Control(bool fanSsrMode);
  ~Control();

  void setHeater(float value);
  float getHeater() const;
  void setFan(float value);
  float getFan() const;

  float getExhaustTemp() const;
  float getBeanTemp() const;
  float getAmbientTemp() const;
  float getIRObjectTemp() const;
  float getIRAmbientTemp() const;
  float getDHTTemperature() const;
  float getDHTHumidity() const;

  void allOff();
  void loop();
};

#endif // CONTROL_H
