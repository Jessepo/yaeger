# Yaeger PCB Connector & Signal Placement Guide

This guide details the connector selection, pin assignments, physical board edge placement, and routing strategies for the **Yaeger ESP32-S3 Coffee Roaster Controller**.

Reference sources:
- Firmware configuration: [`src/config.h`](file:///c:/Users/User/Documents/GitHub/yaeger/src/config.h)
- Schematic: [`PCB/SCH_yaeger_2_2026-09-27.pdf`](file:///c:/Users/User/Documents/GitHub/yaeger/PCB/SCH_yaeger_2_2026-09-27.pdf)
- Design notes: [`PCB/pcb_design_notes.md`](file:///c:/Users/User/Documents/GitHub/yaeger/PCB/pcb_design_notes.md)

---

## 1. PCB Edge & Zone Floorplan

In a mixed-signal coffee roaster controller, layout success depends on **zoning by noise and thermal sensitivity**. Ultra-sensitive microvolt thermocouple inputs must be isolated from heat sources and switching noise, while high-frequency digital audio (I2S) and high-current/switching outputs (SSR & Fan PWM) must have dedicated paths.

```
                    ┌─────────────────────────────────────────────────────┐
                    │      ZONE 1: QUIET ANALOG / THERMOCOUPLES           │
                    │  [ ET Screw Term ]          [ BT Screw Term ]       │
                    │  (MAX1: GPIO 15 CS)         (MAX2: GPIO 16 CS)      │
                    │   Isolated ground, no copper under pads, no heat    │
 ┌──────────────────┴─────────────────────────────────────────────────────┴──────────────────┐
 │                                                                                           │
 │ ZONE 2: ACTUATORS / NOISE                                      ZONE 3: ROASTER SENSORS    │
 │ (High switching current)                                       (Chassis & Drum probes)    │
 │                                                                                           │
 │ [ FAN ] (JST-PH 4p)                                            [ Crack Mic ] (JST-PH 6p)  │
 │  • GPIO 8 (20 kHz PWM 5V)                                       • I2S: GPIO 13, 14, 17    │
 │  • 5V + GND                                                     • 3.3V + GND + L/R        │
 │                                        ┌──────────────┐                                   │
 │ [ SSR ] (JST-PH 4p/2p)                 │   ESP32-S3   │        [ IRTemp MLX ] (JST-PH 4p) │
 │  • GPIO 3 (50 Hz PWM 3.3V)             │   DevKit     │         • I2C: GPIO 41 & 42       │
 │  • GND                                 └──────────────┘         • 3.3V + GND              │
 │                                                                                           │
 │                                                                 [ DHT22 ] (JST-PH 4p/3p)  │
 │                                                                 • GPIO 7 (Data)           │
 │                                                                 • 3.3V + GND              │
 │                                                                                           │
 └──────────────────┬─────────────────────────────────────────────────────┬──────────────────┘
                    │        ZONE 4: FRONT PANEL & HOST CONNECTIVITY      │
                    │  [ USB-C ]          [ OLED ]          [ ARGB ]      │
                    │  (Chassis Port)   (JST-PH 4p)       (JST-PH 4p/3p)  │
                    │                  (GPIO 41 & 42)      (GPIO 4, 5V)   │
                    └─────────────────────────────────────────────────────┘
```

---

## 2. Complete Signal-to-Plug Matrix

| Plug Name | Physical Connector | Pins Used | Signal & GPIO (`config.h`) | Voltage Rail | Destination / Cable Route |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **ET (Exhaust)** | Screw Terminal (3.81/5.08mm) | 2-pin | T+, T- (`MAX1CS` = GPIO 15, `CLK` = 6, `DO` = 5) | Passive (µV) | Exhaust / Inlet thermocouple probe |
| **BT (Bean)** | Screw Terminal (3.81/5.08mm) | 2-pin | T+, T- (`MAX2CS` = GPIO 16, `CLK` = 6, `DO` = 5) | Passive (µV) | Bean drum thermocouple probe |
| **FAN** | JST-PH 4-pin | 1: NC<br>2: +5V<br>3: GND<br>4: PWM | `FAN_PIN` = GPIO 8 (level-shifted to 5V via 74AHCT1G125) | 5V | Blower / Fan motor controller |
| **SSR** | JST-PH 4-pin (or 2-pin) | 1: NC<br>2: NC<br>3: Signal (+)<br>4: GND (-) | `HEATER_PIN` = GPIO 3 (50 Hz SSR drive) | 3.3V Logic | Crydom D2425-01 SSR control input |
| **Crack** | JST-PH 6-pin | 1: VDD (3.3V)<br>2: GND<br>3: L/R (GND)<br>4: WS<br>5: SCK<br>6: SD | `I2S_MIC_WS_PIN` = 17<br>`I2S_MIC_SCK_PIN` = 14<br>`I2S_MIC_SD_PIN` = 13 | 3.3V | INMP441 / ICS-43434 acoustic mic probe |
| **IRTemp** | JST-PH 4-pin | 1: 3.3V<br>2: SDA<br>3: SCL<br>4: GND | `DISPLAY_DA` = GPIO 41<br>`DISPLAY_CL` = GPIO 42 | 3.3V | MLX90614 infrared bean drum sensor |
| **DHT22** | JST-PH 4-pin (or 3-pin) | 1: 3.3V<br>2: DATA<br>3: NC<br>4: GND | `DHT_PIN` = GPIO 7 | 3.3V | Ambient roaster room intake sensor |
| **OLED** | JST-PH 4-pin | 1: 3.3V<br>2: GND<br>3: SCL<br>4: SDA | `DISPLAY_CL` = GPIO 42<br>`DISPLAY_DA` = GPIO 41 | 3.3V | 0.96" SSD1306 front-panel display |
| **ARGB** | JST-PH 4-pin (or 3-pin) | 1: +5V<br>2: DIN<br>3: NC<br>4: GND | `ARGB_PIN` = GPIO 4 | 5V Rail | Front-panel WS2812B ring / status LED |
| **USB-C** | Type-C Receptacle | Edge mount | USB D+ (GPIO 20), D- (GPIO 19), VBUS, GND | 5V Input | Enclosure exterior port |

---

## 3. Placement & Routing Advice by Zone

### Zone 1: Top Edge — Thermocouple Cold Zone (Quiet Analog)
- **Cold-Junction Thermal Integrity:** The MAX31855 measures temperature relative to its internal cold-junction compensation (CJC) diode. Place the MAX31855 ICs right beside the screw terminals (within 5–10 mm) and keep them far away from heat sources (ESP32 SoC, linear LDOs, switching regulators).
- **Copper Keep-Out:** Do not route solid copper pours directly under the thermocouple screw terminal pads. Ground pours conduct heat unevenly across terminals and introduce offset errors into the microvolt reading.
- **Silkscreen Labels:** Clearly print `ET (+ / -)` and `BT (+ / -)`. Remember that ANSI K-type cables use Yellow for `(+)` and Red for `(-)`.

### Zone 2: Bottom-Left Edge — Power & Actuators (FAN & SSR)
- **Switching Noise Containment:** The fan PWM (20 kHz) and SSR drive connect to external motor controllers and relays that switch significant inductive or resistive power. Placing their connectors together at the bottom-left isolates their return currents.
- **Physical Separation:** The SSR plug only outputs low-voltage 3.3V DC logic to the Crydom relay. Ensure the harness runs straight out to the high-voltage/mains compartment where the SSR is mounted to a heatsink.

### Zone 3: Right Edge — Roaster Sensors (Crack Mic, MLX90614, DHT22)
- **Acoustic Mic (I2S):** The I2S clock line (`SCK`, GPIO 14) toggles at high speed. Placing the 6-pin `Crack` connector along the right edge minimizes trace length to ESP32 pins 13, 14, and 17.
- **MLX90614 IR Probe:** Uses I2C alongside the OLED. Keep SDA/SCL lines away from the 20 kHz Fan PWM trace to avoid capacitive noise coupling onto the open-drain bus.

### Zone 4: Bottom / Front Edge — User Interface & Host Connectivity (USB-C, OLED, ARGB)
- **Front Panel Harnesses:** OLED, ARGB status LED, and USB-C all face the front panel or outer wall of the enclosure. Placing their connectors on this edge eliminates cables crossing over the microcontroller or analog circuits.

---

## 4. Critical Gotchas & Practical Tips

1. **OLED Pinout Swap Hazard:**
   - In the schematic (`SCH_yaeger_2_2026-09-27.pdf`), the OLED connector order is:
     `Pin 1: VCC | Pin 2: GND | Pin 3: SCL | Pin 4: SDA`
   - Common 0.96" SSD1306 breakout boards come in two conflicting pinouts: `VCC-GND-SCL-SDA` and `GND-VCC-SCL-SDA`. Always check the silkscreen on your physical display module before crimping the JST harness to avoid reverse-biasing the module.
2. **Preventing Accidental Misplugs:**
   - Currently, `FAN`, `SSR`, `DHT22`, and `ARGB` all use 4-pin `HC-HY-4A` connectors with unused/dummy pins.
   - Accidental cross-plugging (e.g., plugging 5V `ARGB` into 3.3V `DHT22` or `SSR`) can damage pins or sensors.
   - **Recommended improvement:** Use **2-pin JST-PH for SSR**, **3-pin JST-PH for ARGB and DHT22**, and **4-pin JST-PH for I2C and FAN**. This provides physical keying so cables cannot fit into the wrong socket.
3. **INMP441 / ICS-43434 6-Pin Sequence:**
   - Standard MEMS microphone breakout boards follow the header order:
     `SCK - SD - WS - L/R - GND - VDD`
   - Matching this pin sequence on the board's 6-pin JST-PH plug enables crimping a 1:1 straight ribbon cable without crossed wires.
4. **I2C Pull-Up Resistors:**
   - Both `IRTemp` (MLX90614) and `OLED` share GPIO 41 (`DISPLAY_DA`) and GPIO 42 (`DISPLAY_CL`). Most off-the-shelf breakout boards have integrated 4.7kΩ or 10kΩ pull-up resistors, which operate well in parallel (~2.3k–5kΩ total pull-up) without requiring extra resistors on the PCB.
