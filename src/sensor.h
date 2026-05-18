#ifndef SENSORS_H
#define SENSORS_H
#include <Adafruit_MAX31855.h>
#include <cstdint>
#include "MovingAverageFilter.h"

class Sensor {
private:
  // Thermocouple sensors
  Adafruit_MAX31855 _tc;
  String _sensorName;

  // Timing and synchronization
  const uint8_t _noUpdateBeforeMs = 5; // Lower than main loop for now
  MovingAverageFilter _valueFilter = MovingAverageFilter(5);
  unsigned long _lastUpdate;

  // Sensor readings: [0] = ET, [1] = BT, [2] = Ambient
  float _value;
  float _filteredValue;
  float _ambient;



  void handleThermocoupleFault();
public:
  Sensor(int tClk, int tCs, int tDo, String sensorName);
  ~Sensor() = default;

  // Initialization
  bool initialize();

  // Reading operations
  void takeReading();

  float getValue() const;

  float getFilteredValue() const;

  float getAmbient() const;
};

#endif // SENSORS_H
