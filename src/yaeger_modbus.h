// yaeger_modbus.h
// Modbus RTU slave for Artisan Roaster-Scope over USB serial.
//
// Library: emelianov/modbus-esp8266 (works fine on ESP32/S3)
//   platformio.ini ->  lib_deps = ... emelianov/modbus-esp8266
//
// Port selection on the S3:
//   - DevKitC-1: has TWO USB ports. "COM" = CP210x bridge on UART0 (Serial),
//     "USB" = native USB CDC. Pick one for Modbus, keep the other for logs.
//   - Lolin S3 Mini (ARDUINO_USB_CDC_ON_BOOT=1): `Serial` IS the native CDC.
//     Debug log output also lands there, so build with -D CORE_DEBUG_LEVEL=0
//     (or route your logging to WebSerial, which you already have) or Modbus
//     frames will get corrupted by log text.
//
// Override the port with a build flag if needed, e.g.:
//   -D YAEGER_MODBUS_PORT=Serial0
#pragma once

#include <Arduino.h>
#include <functional>

#ifndef YAEGER_MODBUS_PORT
#define YAEGER_MODBUS_PORT Serial
#endif

#ifndef YAEGER_MODBUS_BAUD
#define YAEGER_MODBUS_BAUD 115200
#endif

#ifndef YAEGER_MODBUS_SLAVE_ID
#define YAEGER_MODBUS_SLAVE_ID 1
#endif

// ---------------------------------------------------------------------------
// Register map (all holding registers, Modbus function 3 read / 6 or 16 write)
// Artisan reads with fn 3; slider actions use write([slave,reg,value]).
// Temperatures are transported as int = degC * 10  ->  set "/10" (or x/10.0)
// in Artisan so 2137 renders as 213.7 C.
// ---------------------------------------------------------------------------
enum YaegerModbusReg : uint16_t {
  // -- read-only telemetry (writes ignored) --
  MB_REG_BT          = 100,  // bean temp, degC x10
  MB_REG_ET          = 101,  // environment temp, degC x10
  MB_REG_HEATER_RB   = 102,  // heater duty readback, 0-100
  MB_REG_FAN_RB      = 103,  // fan readback, 0-100
  MB_REG_STATUS      = 104,  // bit0: firmware profile running
                             // bit1: TC fault  bit2: watchdog tripped

  // -- commands (Artisan sliders / buttons write here) --
  MB_REG_HEATER_CMD  = 200,  // heater %, 0-100 (ignored while profile runs)
  MB_REG_FAN_CMD     = 201,  // fan %, 0-100    (ignored while profile runs)
  MB_REG_ALL_OFF     = 202,  // write 1 -> heater 0, fan to cooldown, stop follow
};

// Wire these to your existing firmware functions in setup(); no renaming
// of yaeger internals required.
struct YaegerModbusHooks {
  std::function<float()>        getBT;              // degC
  std::function<float()>        getET;              // degC
  std::function<uint8_t()>      getHeaterPercent;   // 0-100 actual duty
  std::function<uint8_t()>      getFanPercent;      // 0-100 actual
  std::function<bool()>         profileRunning;     // firmware-owned roast?
  std::function<bool()>         tcFault;            // thermocouple fault flag
  std::function<void(uint8_t)>  setHeaterPercent;   // 0-100
  std::function<void(uint8_t)>  setFanPercent;      // 0-100
  std::function<void()>         allOff;             // your existing All-Off path
};

// Call once in setup(). Starts the serial port and registers the slave.
void yaegerModbusBegin(const YaegerModbusHooks& hooks);

// Call every loop() iteration (non-blocking; also refreshes telemetry
// registers at 10 Hz and runs the comms watchdog).
void yaegerModbusTask();

// True if Artisan has polled us within the last few seconds.
bool yaegerModbusMasterAlive();
