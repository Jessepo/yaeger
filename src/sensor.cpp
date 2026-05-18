#include "Sensor.h"
#include "logging.h"

Sensor::Sensor(int tClk, int tCs, int tDo, String sensorName)
  : _tc(tClk, tCs, tDo),
    _lastUpdate(0),
    _value(0.f),
    _ambient(0.f),
    _sensorName(sensorName) {
}

bool Sensor::initialize() {
  log("Initializing sensor");

  bool ok = _tc.begin();

  logf("Sensor %s\n", ok ? "initialized" : "failed to init");

  return ok;
}

void Sensor::takeReading() {
  unsigned long now = millis();
  unsigned long dt = (now - this->_lastUpdate);

  if (dt < _noUpdateBeforeMs) {
    return;
  }

  float value = this->_tc.readCelsius();
  if (isnan(value)) {
    this->handleThermocoupleFault();
  } else {
    this->_value = value;
    this->_filteredValue = this->_valueFilter.process(value);
  }
  this->_ambient = this->_tc.readInternal();
  this->_lastUpdate = now;
}


void Sensor::handleThermocoupleFault() {
  uint8_t e = this->_tc.readError();
  logf("Thermocouple fault(s) detected on sensor %s! Error: %d\n", this->_sensorName, e);

  if (e & MAX31855_FAULT_OPEN) {
    logf("FAULT [%s]: Thermocouple is open - no connections.\n", this->_sensorName);
  }
  if (e & MAX31855_FAULT_SHORT_GND) {
    logf("FAULT [%s]: Thermocouple is short-circuited to GND.\n", this->_sensorName);
  }
  if (e & MAX31855_FAULT_SHORT_VCC) {
    logf("FAULT [%s]: Thermocouple is short-circuited to VCC.\n", this->_sensorName);
  }
}

float Sensor::getValue() const {
  return this->_value;
}

float Sensor::getFilteredValue() const {
  return this->_filteredValue;
}

float Sensor::getAmbient() const {
  return this->_ambient;
}
