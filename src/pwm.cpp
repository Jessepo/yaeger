#include "pwm.h"
#include <Arduino.h>
#include <string>

PwmOutput::PwmOutput(int pin, float frequencyInput, int dutyResolution, int channel)
: _pin(pin), _value(0.f) {
  this->_pwm.begin(pin, channel, frequencyInput, dutyResolution, false, LEDC_USE_APB_CLK);
}

void PwmOutput::setValue(float power) {
  this->_value = max(min(power,100.f),0.f);
;
  this->_pwm.setDutyNormalized(this->_value / 100.f);
}

float PwmOutput::getValue() const {
  return this->_value;
}
