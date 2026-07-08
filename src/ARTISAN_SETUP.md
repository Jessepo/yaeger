# Yaeger ↔ Artisan over Modbus RTU (USB serial)

## 1. Firmware integration

Drop `yaeger_modbus.h` / `yaeger_modbus.cpp` into `src/`, then add the library
to `platformio.ini`:

```ini
[core]
lib_deps =
    ; ...existing deps...
    emelianov/modbus-esp8266
```

Wire it up in your main file:

```cpp
#include "yaeger_modbus.h"

void setup() {
  // ...existing setup...

  YaegerModbusHooks h;
  h.getBT            = []() { return currentBT; };          // your BT float
  h.getET            = []() { return currentET; };          // your ET float
  h.getHeaterPercent = []() { return heaterDuty; };         // 0-100
  h.getFanPercent    = []() { return fanSpeed; };           // 0-100
  h.profileRunning   = []() { return roastFollowActive; };  // firmware-owned roast flag
  h.tcFault          = []() { return max31855Fault; };
  h.setHeaterPercent = [](uint8_t v) { setHeater(v); };     // same path setBurner uses
  h.setFanPercent    = [](uint8_t v) { setFan(v); };
  h.allOff           = []()          { allOff(); };
  yaegerModbusBegin(h);
}

void loop() {
  // ...existing loop...
  yaegerModbusTask();   // non-blocking
}
```

### Serial port — read this or nothing will work

Modbus needs a **quiet** serial port. `CORE_DEBUG_LEVEL=3` prints text into
the same stream and will corrupt frames.

| Board            | Recommended setup |
|------------------|-------------------|
| DevKitC-1 N16R8  | Use the **native USB** port for Modbus and keep the CP210x "COM" port (UART0) for logs/flashing. Build with `-D ARDUINO_USB_CDC_ON_BOOT=1` and `-D YAEGER_MODBUS_PORT=Serial` — logs stay on `Serial0`/UART0 depending on your console config; verify no log text appears on the Modbus port. |
| Lolin S3 Mini    | Only one USB port (native CDC). Build the roasting firmware with `-D CORE_DEBUG_LEVEL=0` and keep runtime logging on WebSerial (already in your deps). |

Sanity check before touching Artisan: open a Modbus poll tool (e.g. `mbpoll`,
QModMaster, or Modbus Poll) at 115200 8N1, slave 1, fn 3, address 100, count 5.
You should see BT×10, ET×10, heater, fan, status ticking.

```
mbpoll -m rtu -a 1 -r 101 -c 5 -t 4 -b 115200 -P none /dev/ttyACM0
```
(`-r 101` because mbpoll is 1-based; register 100 = "address 101" there.)

## 2. Artisan configuration

**Config » Device » Meter tab:** select `MODBUS`.

**Config » Port (MODBUS tab):**
- Comm port: your ESP32's port (COMx / /dev/ttyACM0 / /dev/cu.usbmodem…)
- Baud 115200, 8N1, timeout ~0.4 s
- Input 1: Slave `1`, Register `100`, Function `3`, Divider `1/10` → BT
- Input 2: Slave `1`, Register `101`, Function `3`, Divider `1/10` → ET
- (Optional) Input 3/4: Registers `102` / `103`, no divider → chart the
  actual heater duty and fan speed as extra curves.

If your Artisan version lacks the divider dropdown, use formula `x/10.0` in
Config » Device » Symb ET/BT instead.

Note Artisan maps Input 1 → ET and Input 2 → BT by default in some setups —
if your curves look swapped, either swap the registers or tick the BT/ET swap.

**Config » Events » Sliders:**
| Slider | Action | Command | Range |
|--------|--------|---------|-------|
| Burner | MODBUS Command | `write([1,200,{}])` | 0–100 |
| Air    | MODBUS Command | `write([1,201,{}])` | 0–100 |

**Config » Events » Buttons:** add an emergency stop:
- Label `ALL OFF`, Action `MODBUS Command`, Command `write([1,202,1])`

**Optional — let Artisan's PID drive the burner:** Config » Curves » PID,
set the control output to the Burner slider. Leave the Yaeger dashboard PID
off and don't press Start Roast (same "don't mix flows" rule as the
WebSocket path).

## 3. Behavior notes

- While a firmware-owned profile is running (dashboard "Start Roast"),
  Artisan's burner/fan writes are ignored; Artisan still charts temps.
  Status register 104 bit 0 tells you which mode you're in.
- Comms watchdog: if Artisan is manually driving the heater and then goes
  silent for 15 s (cable pulled, laptop asleep), the module fires your
  All-Off. It never interferes while a profile is supervising the roast.
- Register 202 is self-clearing; writing 1 always executes All-Off,
  regardless of mode.
- WebSocket/webapp keeps working in parallel — this adds a wired path, it
  doesn't replace anything.
