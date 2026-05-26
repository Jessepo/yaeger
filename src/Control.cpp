#include "Control.h"
#include "config.h"
#include "logging.h"
#include <Arduino.h>


const char *modeToChar(OperationalMode mode) {
  const char *result;
  if (mode == OperationalMode::Auto) {
    result = "PID";
  } else if (mode == OperationalMode::Tune) {
    result = "Tuning";
  } else {
    result = "Manual";
  }
  return result;
}


Control::Control(float kp, float ki, float kd, TemperatureTarget target, bool fanSsrMode)
  : _autotune(0, MAX_HEATER_POWER, TuningMethod::ZieglerNichols),
    _temperatureTarget(target),
    _pwmFan(fanSsrMode ? nullptr : new PwmOutput(FAN_PIN, FAN_FREQUENCY, 10, 0)),
    _fanPin(FAN_PIN),
    _fanSsrMode(fanSsrMode),
    _ssrFanOn(false),
    _heater(HEATER_PIN, HEATER_FREQUENCY, 10, 1),
    _etSensor(MAX1CLK, MAX1CS, MAX1DO, "Exhaust"),
    _btSensor(MAX2CLK, MAX2CS, MAX2DO, "Bean"),
    lastUpdate(0),
    tuningEnabled(false),
    hasResults(false) {
  if (_fanSsrMode) {
    pinMode(_fanPin, OUTPUT);
    digitalWrite(_fanPin, LOW);
  }
  _autotune.setManualGains(kp, ki, kd);
  _autotune.enableAntiWindup(true, 0.8);
  _autotune.setOscillationMode(OscillationMode::Normal);
  _autotune.setSetpoint(0.);
  _autotune.setOperationalMode(OperationalMode::Manual);
  _autotune.setManualOutput(0.);
}

Control::~Control() {
  delete _pwmFan;
}


void Control::setPidValues(float kp, float ki, float kd) {
  _autotune.setManualGains(kp, ki, kd);
}

void Control::setSetpoint(float setpoint) {
  if (_autotune.getSetpoint() == 0 && setpoint > 0.) {
    _autotune.resetError();
  }
  _autotune.setSetpoint(max(min(setpoint, 250.f), 0.f));
}

void Control::setHeater(float value) {
  _autotune.setManualOutput(value);
}

void Control::startAutotune() {
  _autotune.setOperationalMode(OperationalMode::Tune);
  tuningEnabled = true;
}

void Control::resetAutotune() {
  hasResults = false;
}

bool Control::hasAutotuneResults() const {
  return hasResults;
}

float Control::getKp() const {
  return _autotune.getKp();
}

float Control::getKi() const {
  return _autotune.getKi();
}

float Control::getKd() const {
  return _autotune.getKd();
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

void Control::setTemperatureTarget(TemperatureTarget target) {
  _temperatureTarget = target;
}

float Control::getHeater() const {
  return _autotune.getOutput();
}

float Control::getSetpoint() const {
  return _autotune.getSetpoint();
}

float Control::getExhaustTemp() const {
  return this->_etSensor.getValue();
}

float Control::getBeanTemp() const {
  return this->_btSensor.getValue();
}

float Control::getAmbientTemp() const {
  return this->_btSensor.getAmbient();
}

const char *Control::getTemperatureTarget() const {
  const char *result;
  if (_temperatureTarget == TemperatureTarget::BT) {
    result = "BT";
  } else if (_temperatureTarget == TemperatureTarget::ET) {
    result = "ET";
  } else {
    result = "MAX";
  }
  return result;
}

OperationalMode Control::getMode() {
  return _autotune.getOperationalMode();
}

void Control::setMode(OperationalMode mode) {
  _autotune.setOperationalMode(mode);
}


float Control::getTemperature() const {
  float bt = this->_btSensor.getFilteredValue();
  float et = this->_etSensor.getFilteredValue();

  if (_temperatureTarget == TemperatureTarget::BT) {
    return bt;
  }
  if (_temperatureTarget == TemperatureTarget::ET) {
    return et;
  }
  if (_temperatureTarget == TemperatureTarget::MAX) {
    return max(bt, et);
  }
  return 0.f;
}

void Control::loop() {
  if (tuningEnabled && _autotune.getOperationalMode() != OperationalMode::Tune) {
    // tuning completed, set status accordingly
    tuningEnabled = false;
    hasResults = true;
    setFan(30.f);
    setSetpoint(0);
  }

  // Safety watchdog: if the webapp has been disconnected for >5 minutes AND
  // we're following a profile AND BT is over the safety threshold, kill
  // everything. Prevents an unattended too-hot roast when the operator
  // can't see what's happening.
  if (_following && _lastWsActivityMs > 0 &&
      (millis() - _lastWsActivityMs) > 300000UL &&
      _btSensor.getValue() > 230.f) {
    log("WATCHDOG: WS quiet >5min and BT>230 — forcing All Off");
    allOff();
  }

  unsigned long now = millis();
  unsigned long dt = (now - lastUpdate);
  if (dt < noUpdateBeforeMs) {
    return;
  }
  lastUpdate = now;
  this->_btSensor.takeReading();
  this->_etSensor.takeReading();

  // If a profile is loaded and we're following it, drive the setpoint + fan
  // from the profile instead of waiting for the webapp to push commands.
  if (_following) {
    applyProfileAt(getRoastElapsedSec());
  }

  float temp = getTemperature();
  _autotune.update(temp);

  float heaterValue = _autotune.getOutput();
  if (heaterValue > 0. && getFan() <= 10) {
    setFan(30.f);
  }

  _heater.setValue(heaterValue);

  // 1 Hz history sample for the chart-backfill on reconnect.
  if (_following && (now - _lastHistorySampleMs) >= 1000) {
    recordHistorySample();
    _lastHistorySampleMs = now;
  }
}

float Control::getRoastElapsedSec() const {
  if (!_following || _roastStartMs == 0) return 0.f;
  return (millis() - _roastStartMs) / 1000.0f;
}

// Linear-interpolate setpoint and fan from the active profile at the given
// elapsed time, then push them into the PID and fan driver.
void Control::applyProfileAt(float elapsedSec) {
  if (_profilePointCount == 0) return;

  // Find the segment containing elapsedSec.
  // Profile points are sorted in time-ascending order by construction.
  const ProfilePoint *prev = &_profilePoints[0];
  const ProfilePoint *next = &_profilePoints[0];

  if (elapsedSec <= _profilePoints[0].timeSec) {
    // Before the first point: hold first point's values.
    next = prev = &_profilePoints[0];
  } else if (elapsedSec >= _profilePoints[_profilePointCount - 1].timeSec) {
    // Past the last point: hold last values.
    next = prev = &_profilePoints[_profilePointCount - 1];
  } else {
    for (int i = 1; i < _profilePointCount; i++) {
      if (elapsedSec <= _profilePoints[i].timeSec) {
        prev = &_profilePoints[i - 1];
        next = &_profilePoints[i];
        break;
      }
    }
  }

  // Setpoint: linear interpolation
  float setpointVal;
  if (next == prev) {
    setpointVal = prev->setpoint;
  } else {
    float span = next->timeSec - prev->timeSec;
    float t = span > 0.f ? (elapsedSec - prev->timeSec) / span : 0.f;
    setpointVal = prev->setpoint + (next->setpoint - prev->setpoint) * t;
  }
  setSetpoint(setpointVal);

  // Fan: step-style (take the previous point's value) + offset, when defined
  if (prev->fan != 0xFF) {
    int adjusted = (int)prev->fan + _fanOffset;
    if (adjusted < 0) adjusted = 0;
    if (adjusted > 100) adjusted = 100;
    setFan((float)adjusted);
  }
}

void Control::recordHistorySample() {
  RoastSample &s = _history[(_historyHead + _historyCount) % HISTORY_CAPACITY];
  s.elapsedSec = (uint16_t)min((unsigned long)0xFFFF, (unsigned long)getRoastElapsedSec());
  s.setpoint = (uint16_t)max(0.f, min(65535.f, _autotune.getSetpoint()));
  s.et = (int16_t)(_etSensor.getValue() * 10.f);
  s.bt = (int16_t)(_btSensor.getValue() * 10.f);
  s.fan = (uint8_t)min(100.f, max(0.f, getFan()));
  s.burner = (uint8_t)min(100.f, max(0.f, _autotune.getOutput()));
  s.flags = 0;
  s._pad = 0;
  if (_historyCount < HISTORY_CAPACITY) {
    _historyCount++;
  } else {
    // Overwriting oldest; advance head.
    _historyHead = (_historyHead + 1) % HISTORY_CAPACITY;
  }
}

const RoastSample &Control::getHistorySample(int chronologicalIdx) const {
  return _history[(_historyHead + chronologicalIdx) % HISTORY_CAPACITY];
}

void Control::clearHistory() {
  _historyHead = 0;
  _historyCount = 0;
  _lastHistorySampleMs = 0;
}

void Control::setActiveProfile(const ProfilePoint *points, int count) {
  if (count > MAX_PROFILE_POINTS) count = MAX_PROFILE_POINTS;
  if (count < 0) count = 0;
  for (int i = 0; i < count; i++) {
    _profilePoints[i] = points[i];
  }
  _profilePointCount = count;
}

void Control::startRoast() {
  _following = true;
  _roastStartMs = millis();
  _lastHistorySampleMs = 0;
  clearHistory();
  // Switch to PID mode so the autotune controller actually does its job.
  _autotune.setOperationalMode(OperationalMode::Auto);
  // Apply the t=0 setpoint/fan immediately.
  if (_profilePointCount > 0) applyProfileAt(0.f);
  // Take the first sample so the chart isn't empty.
  recordHistorySample();
  _lastHistorySampleMs = millis();
}

void Control::endRoast() {
  _following = false;
}

void Control::allOff() {
  _following = false;
  _autotune.setOperationalMode(OperationalMode::Manual);
  _autotune.setManualOutput(0.f);
  setFan(0.f);
}

void Control::setFanOffset(int offset) {
  if (offset < -25) offset = -25;
  if (offset > 25) offset = 25;
  _fanOffset = offset;
}

void Control::noteWsActivity() {
  _lastWsActivityMs = millis();
}

unsigned long Control::getMsSinceWsActivity() const {
  if (_lastWsActivityMs == 0) return 0;
  return millis() - _lastWsActivityMs;
}
