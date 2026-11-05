#include "sensor.h"
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
    if (this->_lastFault != 0) {
      logf("Thermocouple on sensor %s recovered\n", this->_sensorName.c_str());
      this->_lastFault = 0;
    }
    this->_value = value;
    this->_filteredValue = this->_valueFilter.process(value);
  }
  this->_ambient = this->_tc.readInternal();
  this->_lastUpdate = now;
}


void Sensor::handleThermocoupleFault() {
  uint8_t e = this->_tc.readError();
  if (e == this->_lastFault) return;
  this->_lastFault = e;

  const char *name = this->_sensorName.c_str();
  logf("Thermocouple fault(s) detected on sensor %s! Error: %d\n", name, e);

  if (e & MAX31855_FAULT_OPEN) {
    logf("FAULT [%s]: Thermocouple is open - no connections.\n", name);
  }
  if (e & MAX31855_FAULT_SHORT_GND) {
    logf("FAULT [%s]: Thermocouple is short-circuited to GND.\n", name);
  }
  if (e & MAX31855_FAULT_SHORT_VCC) {
    logf("FAULT [%s]: Thermocouple is short-circuited to VCC.\n", name);
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
