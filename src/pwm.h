#ifndef PWM_H
#define PWM_H
#include "vendor/ESP32_EnhancedPWM.h"


class PwmOutput {
private:
  ESP32_EnhancedPWM _pwm;
  int _pin;
  float _value;

public:
  PwmOutput(int pin,
            float frequency,
            int dutyResolution,
            int channel);

  ~PwmOutput() = default;

  void setValue(float power);

  float getValue() const;
};

#endif
