// yaeger_modbus.cpp
#include "yaeger_modbus.h"
#include <ModbusRTU.h>

namespace {

ModbusRTU        mb;
YaegerModbusHooks hooks;

uint32_t lastPollMs      = 0;      // last time Artisan read/wrote anything
uint32_t lastTelemetryMs = 0;
bool     watchdogTripped = false;

// Comms watchdog: if Artisan was driving the heater manually and then the
// link dies (cable yanked, laptop sleeps), don't leave the element cooking.
// Mirrors the WebSocket safety watchdog, but tighter, since manual mode has
// no profile supervising it.
constexpr uint32_t MASTER_TIMEOUT_MS = 15000;   // 15 s of silence
constexpr uint32_t TELEMETRY_PERIOD_MS = 100;   // 10 Hz register refresh

inline uint16_t degC10(float v) {
  if (isnan(v)) return 0;
  v = constrain(v, 0.0f, 6000.0f);              // 0 .. 600.0 C
  return (uint16_t)lroundf(v * 10.0f);
}

// Any successful read from the master stamps the watchdog.
uint16_t cbAnyGet(TRegister* reg, uint16_t val) {
  lastPollMs = millis();
  watchdogTripped = false;
  return val;
}

uint16_t cbHeaterCmd(TRegister* reg, uint16_t val) {
  lastPollMs = millis();
  // Honor "don't mix flows": while the firmware profile owns the roast,
  // Artisan's burner writes are acknowledged but not applied.
  if (hooks.profileRunning && hooks.profileRunning()) return val;
  if (hooks.setHeaterPercent) hooks.setHeaterPercent((uint8_t)min<uint16_t>(val, 100));
  return val;
}

uint16_t cbFanCmd(TRegister* reg, uint16_t val) {
  lastPollMs = millis();
  if (hooks.profileRunning && hooks.profileRunning()) return val;
  if (hooks.setFanPercent) hooks.setFanPercent((uint8_t)min<uint16_t>(val, 100));
  return val;
}

uint16_t cbAllOff(TRegister* reg, uint16_t val) {
  lastPollMs = millis();
  if (val != 0 && hooks.allOff) hooks.allOff();
  return 0;                                     // self-clearing trigger
}

void refreshTelemetry() {
  mb.Hreg(MB_REG_BT,        hooks.getBT  ? degC10(hooks.getBT())  : 0);
  mb.Hreg(MB_REG_ET,        hooks.getET  ? degC10(hooks.getET())  : 0);
  mb.Hreg(MB_REG_HEATER_RB, hooks.getHeaterPercent ? hooks.getHeaterPercent() : 0);
  mb.Hreg(MB_REG_FAN_RB,    hooks.getFanPercent    ? hooks.getFanPercent()    : 0);

  uint16_t status = 0;
  if (hooks.profileRunning && hooks.profileRunning()) status |= 1 << 0;
  if (hooks.tcFault        && hooks.tcFault())        status |= 1 << 1;
  if (watchdogTripped)                                status |= 1 << 2;
  mb.Hreg(MB_REG_STATUS, status);
}

void runWatchdog() {
  if (watchdogTripped) return;
  if (lastPollMs == 0) return;                  // Artisan never connected
  if (hooks.profileRunning && hooks.profileRunning()) return;  // profile supervises itself
  const bool heaterOn = hooks.getHeaterPercent && hooks.getHeaterPercent() > 0;
  if (heaterOn && millis() - lastPollMs > MASTER_TIMEOUT_MS) {
    watchdogTripped = true;
    if (hooks.allOff) hooks.allOff();
  }
}

} // namespace

void yaegerModbusBegin(const YaegerModbusHooks& h) {
  hooks = h;

  YAEGER_MODBUS_PORT.begin(YAEGER_MODBUS_BAUD);
#if defined(ARDUINO_USB_CDC_ON_BOOT) && ARDUINO_USB_CDC_ON_BOOT
  // Native USB CDC is a Stream, not a HardwareSerial. RTU inter-frame timing
  // is emulated; pymodbus (Artisan) is tolerant of this.
  mb.begin((Stream*)&YAEGER_MODBUS_PORT);
#else
  mb.begin(&YAEGER_MODBUS_PORT);
#endif
  mb.slave(YAEGER_MODBUS_SLAVE_ID);

  mb.addHreg(MB_REG_BT);
  mb.addHreg(MB_REG_ET);
  mb.addHreg(MB_REG_HEATER_RB);
  mb.addHreg(MB_REG_FAN_RB);
  mb.addHreg(MB_REG_STATUS);
  mb.addHreg(MB_REG_HEATER_CMD);
  mb.addHreg(MB_REG_FAN_CMD);
  mb.addHreg(MB_REG_ALL_OFF);

  mb.onGetHreg(MB_REG_BT, cbAnyGet);            // poll heartbeat
  mb.onSetHreg(MB_REG_HEATER_CMD, cbHeaterCmd);
  mb.onSetHreg(MB_REG_FAN_CMD,    cbFanCmd);
  mb.onSetHreg(MB_REG_ALL_OFF,    cbAllOff);
}

void yaegerModbusTask() {
  mb.task();
  const uint32_t now = millis();
  if (now - lastTelemetryMs >= TELEMETRY_PERIOD_MS) {
    lastTelemetryMs = now;
    refreshTelemetry();
    runWatchdog();
  }
}

bool yaegerModbusMasterAlive() {
  return lastPollMs != 0 && millis() - lastPollMs < 5000;
}
