#include "Control.h"
#include "config.h"
#include "logging.h"
#include <Arduino.h>

Control::Control(bool fanSsrMode)
  : _pwmFan(fanSsrMode ? nullptr : new PwmOutput(FAN_PIN, FAN_FREQUENCY, 10, 0)),
    _fanPin(FAN_PIN),
    _fanSsrMode(fanSsrMode),
    _ssrFanOn(false),
    _heater(HEATER_PIN, HEATER_FREQUENCY, 10, 1),
    _etSensor(MAX1CLK, MAX1CS, MAX1DO, "Exhaust"),
    _btSensor(MAX2CLK, MAX2CS, MAX2DO, "Bean"),
    _ir(),
    _dht(DHT_PIN, DHT_TYPE) {
  if (_fanSsrMode) {
    pinMode(_fanPin, OUTPUT);
    digitalWrite(_fanPin, LOW);
  }
  _irPresent = _ir.begin();
  if (_irPresent) {
    log("MLX90614 IR sensor found");
  } else {
    log("MLX90614 IR sensor not found — CH3/CH4 will read 0");
  }

  _dht.begin();
  float initialTemp = _dht.readTemperature();
  _dhtPresent = !isnan(initialTemp);
  if (_dhtPresent) {
    _dhtTempC = initialTemp;
    _dhtHumidity = _dht.readHumidity();
    log("DHT22 sensor found on GPIO 7");
  } else {
    log("DHT22 sensor not detected on GPIO 7 — CH5/RH will read 0");
  }
}

Control::~Control() {
  delete _pwmFan;
}

void Control::setHeater(float value) {
  if (value < 0.f) value = 0.f;
  if (value > MAX_HEATER_POWER) value = MAX_HEATER_POWER;
  _heaterVal = value;
}

float Control::getHeater() const {
  return _heaterVal;
}

void Control::setFan(float value) {
  if (_fanSsrMode) {
    _ssrFanOn = value > 0.f;
    digitalWrite(_fanPin, _ssrFanOn ? HIGH : LOW);
  } else if (_pwmFan) {
    _pwmFan->setValue(value);
  }
}

float Control::getFan() const {
  if (_fanSsrMode) return _ssrFanOn ? 100.f : 0.f;
  return _pwmFan ? _pwmFan->getValue() : 0.f;
}

float Control::getExhaustTemp() const {
  return _etSensor.getValue();
}

float Control::getBeanTemp() const {
  return _btSensor.getValue();
}

float Control::getAmbientTemp() const {
  return _btSensor.getAmbient();
}

float Control::getIRObjectTemp() const {
  if (!_irPresent) return 0.f;
  return _ir.readObjectTempC();
}

float Control::getIRAmbientTemp() const {
  if (!_irPresent) return 0.f;
  return _ir.readAmbientTempC();
}

float Control::getDHTTemperature() const {
  if (!_dhtPresent) return 0.f;
  return _dhtTempC;
}

float Control::getDHTHumidity() const {
  if (!_dhtPresent) return 0.f;
  return _dhtHumidity;
}

void Control::allOff() {
  _heaterVal = 0.f;
  setFan(0.f);
}

void Control::loop() {
  unsigned long now = millis();
  if ((now - lastUpdate) < noUpdateBeforeMs) return;
  lastUpdate = now;

  _btSensor.takeReading();
  _etSensor.takeReading();

  if (_dhtPresent) {
    float temp = _dht.readTemperature();
    if (!isnan(temp)) {
      _dhtTempC = temp;
    }
    float humidity = _dht.readHumidity();
    if (!isnan(humidity)) {
      _dhtHumidity = humidity;
    }
  }

  // Safety: refuse to heat if the fan is not running.
  float out = (getFan() < 1.f) ? 0.f : _heaterVal;
  _heater.setValue(out);
}
