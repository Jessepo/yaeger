#ifndef CRACK_DETECTOR_H
#define CRACK_DETECTOR_H

#include <Arduino.h>

class CrackDetector {
public:
  static void begin();
  static bool popCrackEvent();
  static bool isMonitorMode();
  static void setMonitorMode(bool enabled);
  static void processSerialCommand(const String &cmd);
  static void updateLed();

  // Parameter access
  static int getLoFreq();
  static int getHiFreq();
  static int getThreshold();
  static void setParams(int lo, int hi, int thresh);

private:
  static void taskEntry(void *pvParameters);
};

#endif // CRACK_DETECTOR_H
