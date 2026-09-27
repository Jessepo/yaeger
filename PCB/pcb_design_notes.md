# PCB Design Notes — ESP32 Thermocouple + Motor Controller Board

## Microcontroller
- **ESP32** (S2 or S3 for native USB)
- 3.3V logic throughout

---

## 1. MAX31855KASA+ — K-Type Thermocouple

### IC Pinout (SOIC-8)
| Pin | Name | Connect to |
|-----|------|-----------|
| 1 | T- | FB2 → thermocouple − |
| 2 | T+ | FB1 → thermocouple + |
| 3 | GND | GND |
| 4 | VCC | 3.3V |
| 5 | SCK | ESP32 GPIO18 (via R4) |
| 6 | /CS | ESP32 GPIO5 (+ R3 pull-up to 3.3V) |
| 7 | SO | ESP32 GPIO19 (via R5) |
| 8 | OC | NC |

### SPI Pins (ESP32)
| Signal | GPIO |
|--------|------|
| SCK | 18 |
| /CS | 5 |
| SO (MISO) | 19 |

### BOM
| Ref | Component | Value | Package | LCSC # |
|-----|-----------|-------|---------|--------|
| U1 | MAX31855KASA+ | K-type thermocouple IC | SOIC-8 | C9438 |
| FB1, FB2 | Ferrite bead | 600Ω @ 100MHz | 0603 | C19330 (muRata BLM18AG601SN1D) |
| C1 | Capacitor — differential filter | 10nF ceramic, across T+ to T- | 0603 | C57112 |
| C2, C3 | Capacitor — common-mode filter | 100nF ceramic, T+/T- to GND | 0603 | C14663 |
| C4 | Capacitor — VCC bypass | 100nF ceramic, within 1mm of VCC pin | 0603 | C14663 |
| C5 | Capacitor — bulk decoupling | 10µF ceramic | 0603 | C19702 |
| R3 | Resistor — /CS pull-up | 10kΩ, 3.3V to /CS | 0603 | C25804 |
| R4 | Resistor — SCK pull-down | 10kΩ, SCK to GND | 0603 | C25804 |
| X1 | Screw terminal — thermocouple | 2-pin, 5.08mm pitch | THT | C395051 (WJ500V-5.08-2P) |
| JP1 | Pin header — ESP32 | 5-pin: SCK, CS, SO, 3.3V, GND | 2.54mm THT | C2337 |

### PCB Layout Notes
- Solid ground plane under the IC
- **No copper under thermocouple terminal pads** — interferes with cold-junction compensation
- Place C4 within 1mm of VCC pin, ground via on same side as cap
- Keep thermocouple traces away from SPI lines and switching supply traces

---

## 2. USB-C Connector — HRO TYPE-C-31-M-12 (LCSC C165948)

### Pinout
| Pin(s) | Name | Connect to |
|--------|------|-----------|
| A4B9, B4A9 | VBUS | +5V (both tied together) |
| A1B12, B1A12 | GND | GND (both tied together) |
| DP1, DP2 | D+ | Tied together → ESP32 GPIO20 |
| DN1, DN2 | D- | Tied together → ESP32 GPIO19 |
| CC1 | CC1 | R_CC1 (5.1kΩ) → GND |
| CC2 | CC2 | R_CC2 (5.1kΩ) → GND |
| SBU1, SBU2 | SBU | GND or NC (not needed) |
| EH x4 | Shield | GND |

### BOM
| Ref | Component | Value | Package | LCSC # |
|-----|-----------|-------|---------|--------|
| USBC1 | USB-C connector | TYPE-C-31-M-12 | SMD | C165948 |
| R_CC1, R_CC2 | Resistor — CC pull-down | 5.1kΩ | 0603 | C23186 |

### Notes
- CC resistors tell host charger to supply power
- D+/D- pairs must be joined before routing to ESP32
- EH pins provide mechanical retention — all four to GND

---

## 3. PWM Level Shifter — 74AHCT1G125 (Motor Controller)

### IC Pinout (SOT-353)
| Pin | Name | Connect to |
|-----|------|-----------|
| 1 | OE# | GND (always enabled) |
| 2 | A | ESP32 GPIO (PWM, 3.3V) |
| 3 | GND | GND |
| 4 | Y | PWM output → motor controller connector pin 3 |
| 5 | VCC | Board 5V rail |

### Connector — FAN (HC-HY-4A, 2.00mm pitch)
| Pin | Connect to |
|-----|-----------|
| 1 | NC |
| 2 | Motor controller 5V (+ solder jumper to board 5V) |
| 3 | GND |
| 4 | PWM output (from 74AHCT1G125 pin 4) |

### Solder Jumper
- **Open (default):** motor controller supplies its own 5V to the connector
- **Closed:** board 5V rail feeds the motor controller via connector
- Level shifter VCC is always powered from board 5V regardless of jumper state

### BOM
| Ref | Component | Value | Package | LCSC # |
|-----|-----------|-------|---------|--------|
| U2 | 74AHCT1G125GW | Single buffer, 3.3V→5V | SOT-353 | C12381 |
| C_U2 | Capacitor — VCC bypass | 100nF | 0603 | C14663 |
| J_5V | Solder jumper | 2-pad | — | — |
| FAN | Connector | HC-HY-4A, 4-pin 2.00mm | THT | — |

---

## 4. SSR Heater Control — Crydom D2425-01

- Input voltage: 3-32V DC — **ESP32 3.3V GPIO drives it directly, no level shifting needed**
- No series resistor needed (would drop below 3V turn-on threshold)
- Wire GPIO directly to SSR input+, GND to SSR input-

### Connector — SSR (HC-HY-4A, 2.00mm pitch)
| Pin | Connect to |
|-----|-----------|
| 1 | NC |
| 2 | NC |
| 3 | ESP32 GPIO → SSR input+ |
| 4 | GND → SSR input- |

### PCB Note
- Keep SSR connector physically separated from logic connectors
- Add silkscreen warning if mains voltage is present anywhere near the board

---

## Full GPIO Assignment
| GPIO | Function |
|------|----------|
| 5 | MAX31855 /CS |
| 18 | MAX31855 SCK |
| 19 | MAX31855 SO / USB D- |
| 20 | USB D+ |
| TBD | PWM out → motor controller |
| TBD | SSR heater control |

---

## Common Passives (consolidate order)
| Value | Package | LCSC # | Used for |
|-------|---------|--------|---------|
| 100nF | 0603 | C14663 | C2, C3, C4, C_U2 |
| 10nF | 0603 | C57112 | C1 |
| 10µF | 0603 | C19702 | C5 |
| 10kΩ | 0603 | C25804 | R3, R4 |
| 5.1kΩ | 0603 | C23186 | R_CC1, R_CC2 |
| 600Ω ferrite | 0603 | C19330 | FB1, FB2 |
