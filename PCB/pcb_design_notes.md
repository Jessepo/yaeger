# PCB Design Notes — ESP32 Thermocouple + Motor Controller Board


## Questions/Goals for The Pros:
Figure out net for TC blocks - shouldn't share CS1
Physical separation of logic and TC? 
General layout
routing


## Microcontroller
- **ESP32** S3
- 3.3V logic; actuator outputs buffered to 5V via U2

---

## 1. Power Input — 5VIN (WAGO 250-102)

| Ref | Function |
|-----|----------|
| 5VIN | 2-pin terminal: pin 2 = +5V in, pin 1 = GND |
| Q1 | AO3401A P-MOSFET reverse-polarity protection (high side): D → 5VIN pin 2, S → `+5V`, G → GND |
| C1 | 330µF bulk on `+5V` (after Q1, so it is protected from reverse polarity) |
| L1 + C3 | GZ2012D601TF ferrite + 10µF — filtered 5V feed to the MAX31855 breakouts |
| 0Ω (GNDAGND) | Single-point tie between GND and AGND at the input connector |

- `+5V` feeds the DevKit 5V pin, U2, ARGB/AUX connectors, and FAN via JP1. Worst-case load ≈ 1.1 A (8 WS2812 at full white ≈ 0.48 A + ESP32 ≈ 0.5 A); Q1 drops ≈ 0.06 V.
- Give Q1 copper on drain/source for heat spreading; keep the 5VIN → Q1 trace ≥ 1 mm.
- Q1 conducts both ways once on — it does not block USB backfeed. Check whether the DevKit has a diode between USB VBUS and its 5V pin before plugging USB in with 5VIN powered.
- Keep the ground pour continuous under the SPI traces; AGND is only separated at the 0Ω.

### BOM
| Ref | Component | Value | Package | LCSC # |
|-----|-----------|-------|---------|--------|
| Q1 | AO3401A | P-MOSFET, 30V 4A | SOT-23 | C15127 |
| C1 | Electrolytic | 330µF | — | — |
| L1 | GZ2012D601TF | 600Ω ferrite | 0805 | — |
| C3 | Ceramic | 10µF | — | — |
| R (GNDAGND) | Resistor | 0Ω | — | — |
| 5VIN | WAGO 250-102 | 2-pin terminal | THT | — |

---

## 2. Thermocouple Amplifiers — Adafruit MAX31855 Breakouts (U3, U4)

| Pin | Name | U3 (ET, exhaust) | U4 (BT, bean) |
|-----|------|------------------|---------------|
| 1 | VIN | Filtered 5V (L1) | Filtered 5V (L1) |
| 2 | 3VO | NC | NC |
| 3 | GND | AGND | AGND |
| 4 | DO | `SO` (GPIO 5) | `SO` (GPIO 5) |
| 5 | CS | `CS1` (GPIO 15) | `CS2` (GPIO 16) |
| 6 | CLK | `SCK` (GPIO 6) | `SCK` (GPIO 6) |
| 7 / 8 | TC+ / TC- | Thermocouple | Thermocouple |

- Breakouts have their own 3.3V regulator; DO is 3.3V and safe for the ESP32.
- Keep the breakouts away from the DevKit (module heat skews cold-junction compensation).

---

## 3. 5V Output Buffer — SN74AHCT125DR (FAN, SSR, AUX, ARGB)

One quad buffer level-shifts all 3.3V outputs to 5V. U2, RN1, R1, R2 and the bypass cap sit under the DevKit (keep the antenna end clear). AHCT inputs accept 3.3V logic (VIH = 2.0V).

### IC Pinout (SOIC-14)
| Pin | Name | Connect to |
|-----|------|-----------|
| 1, 4, 10, 13 | 1OE#–4OE# | GND (always enabled) |
| 2 → 3 | 1A → 1Y | `SSR` (GPIO 9) → `SSR5V` |
| 5 → 6 | 2A → 2Y | `FAN` (GPIO 8) → `FAN5V` |
| 9 → 8 | 3A → 3Y | `ARGB` (GPIO 4) → R1 330Ω → `ARGB5V` |
| 12 → 11 | 4A → 4Y | `AUX` (GPIO 18) → `AUX5V` |
| 7 | GND | GND |
| 14 | VCC | Board 5V rail, 100nF bypass placed directly across pins 14/7 |

- RN1 (10k ×4) pulls all four inputs to GND so outputs stay low while the ESP32 boots (SSR and fan off).
- AUX: use a **high-level trigger** relay module; active-low modules would switch on at boot. The buffer cannot drive a bare relay coil.

### Connectors
| Connector | Pins |
|-----------|------|
| FAN (PH-3) | 1: +5V via JP1, 2: `FAN5V`, 3: GND |
| AUX (PH-3) | 1: +5V, 2: `AUX5V`, 3: GND |
| ARGB (PH-3) | 1: +5V, 2: `ARGB5V`, 3: GND |
| SSR (PH-2) | 1: GND → SSR input-, 2: `SSR5V` → SSR input+ |

### Solder Jumper (JP1, FAN only)
- **Open (default):** motor controller supplies its own 5V to the connector
- **Closed:** board 5V rail feeds the motor controller via connector
- Buffer VCC is always powered from board 5V regardless of jumper state

### BOM
| Ref | Component | Value | Package | LCSC # |
|-----|-----------|-------|---------|--------|
| U2 | SN74AHCT125DR | Quad buffer, 3.3V→5V | SOIC-14 | C155176 |
| U10_3 | Capacitor — VCC bypass | 100nF | 0603 | C14663 |
| RN1 | Resistor array — input pull-downs | 10k ×4 | 0603×4 | C29718 |
| R1 | ARGB series resistor | 330Ω | — | — |
| JP1 | Solder jumper | 2-pad | — | — |

### SSR (Crydom D2425-01) PCB Note
- Input 3-32V DC; driven at 5V through the buffer for margin over the ~3V turn-on threshold
- Keep SSR connector physically separated from logic connectors
- Add silkscreen warning if mains voltage is present anywhere near the board

---

## Current Firmware GPIO Assignment (v2 — ESP32-S3 DevKitC-1 N16R8)

Authoritative source is `src/config.h`.

| GPIO | Signal | Notes |
|------|--------|-------|
| 4 | ARGB data | WS2812B status LED |
| 5 | SPI MISO | Shared by both MAX31855s |
| 6 | SPI CLK | Shared by both MAX31855s |
| 7 | DHT22 data | Inlet temp (IT, CH5) + humidity (RH) via 1k series R2; optional — firmware detects presence at boot |
| 8 | Fan PWM | 20 kHz (`FAN_FREQUENCY`); level-shifted to 5V via U2 (74AHCT125) |
| 9 | Heater PWM | 50 Hz SSR control (`HEATER_FREQUENCY`), capped at `MAX_HEATER_POWER` = 65%; level-shifted to 5V via U2 |
| 13 | I2S_MIC_SD | INMP441 / ICS-43434 MEMS mic serial data |
| 14 | I2S_MIC_SCK | INMP441 / ICS-43434 MEMS mic bit clock |
| 15 | ET /CS | MAX31855 — exhaust/inlet thermocouple |
| 16 | BT /CS | MAX31855 — bean thermocouple |
| 17 | I2S_MIC_WS | INMP441 / ICS-43434 MEMS mic word select |
| 18 | AUX | Spare 5V output via U2 (relay module etc.); not used by firmware yet |
| 41 | I2C SDA | MLX90614 IR probe (0x5A) + SH1107 OLED (0x3C) + EXP connector |
| 42 | I2C SCL | MLX90614 + SH1107 + EXP shared bus |
| 43 | USB CDC TX | Debug serial (native USB) |
| 44 | USB CDC RX | Debug serial |
| 48 | Onboard NeoPixel | DevKit status LED |

### WebSocket data channels
| Channel | Source | Condition |
|---------|--------|-----------|
| ET / CH1 | MAX31855 GPIO 15 CS | Always |
| BT / CH2 | MAX31855 GPIO 16 CS | Always |
| CH3 | MLX90614 object temp | Only if sensor detected at boot (`_irPresent`) |
| CH4 | MLX90614 ambient temp | Only if sensor detected at boot |
| CH5 | DHT22 temperature | Only if sensor detected at boot (`_dhtPresent`) |
| RH | DHT22 humidity | Only if sensor detected at boot |

Optional sensors return `0` when absent — Artisan will receive 0°C for those channels.

### PWM parameters
- **Heater:** 50 Hz, software-limited to 65% duty max (`MAX_HEATER_POWER`). Safety interlock: output forced to 0 if fan is off.
- **Fan:** 20 kHz. Level-shifted 3.3V→5V via U2 (74AHCT125) before the fan controller connector.

### NVS-stored preferences
| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `ssid` / `pass` | string | — | Wi-Fi credentials |
| `fanMode` | string | `"pwm"` | Fan control mode |
| `btSource` | string | `"bt"` | Artisan BT source: `bt` / `ir` / `avg` |
| `coolingFan` | int | — | Cooling fan % |

---

## Common Passives (consolidate order)
| Value | Package | LCSC # | Used for |
|-------|---------|--------|---------|
| 100nF | 0603 | C14663 | U10_3 (U2 bypass) |
| 10kΩ ×4 array | 0603×4 | C29718 | RN1 |
| 330Ω | — | — | R1 |
| 1kΩ | — | — | R2 |
