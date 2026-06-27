
Smaller screen optimization


12. After the cooling phase automatically ended at 50 degrees  I pressed "end roast" again and the fan turned back on for a moment and off again. It should automatically trigger "end roast" when the roast is in cooling mode
13. I added a lot of testing in miniweb/src/__tests__ and ran a number of tests and maybe fixed a number of things. run the tests again and try and see where we are. 

SPIWP:0xee
mode:DIO, clock div:1
load:0x3fce2820,len:0x1150
load:0x403c8700,len:0x4
load:0x403c8704,len:0xc24
load:0x403cb700,len:0x30b4
entry 0x403c88b8
[  1170][I][esp32-hal-i2c-ng.c:105] i2cInit(): Initializing I2C Master: num=0 sda=41 scl=42 freq=100000
[  1181][W][Wire.cpp:296] begin(): Bus already started in Master Mode.
[  4247][E][Preferences.cpp:526] getBytesLength(): nvs_get_blob len fail: pidK NOT_FOUND
[  4255][E][Preferences.cpp:526] getBytesLength(): nvs_get_blob len fail: pidI NOT_FOUND
[  4263][E][Preferences.cpp:526] getBytesLength(): nvs_get_blob len fail: pidD NOT_FOUND
[  4271][E][Preferences.cpp:506] getString(): nvs_get_str len fail: tempTarget NOT_FOUND
[  4279][E][Preferences.cpp:506] getString(): nvs_get_str len fail: fanMode NOT_FOUND
ESP-ROM:esp32s3-20210327
Build:Mar 27 2021
rst:0x8 (TG1WDT_SYS_RST),boot:0x8 (SPI_FAST_FLASH_BOOT)
Saved PC:0x40376b71
  #0  0x40376b71 in panicHandler at /home/runner/work/esp32-arduino-lib-builder/esp32-arduino-lib-builder/esp-idf/components/esp_system/port/panic_handler.c:294

SPIWP:0xee
mode:DIO, clock div:1
load:0x3fce2820,len:0x1150
load:0x403c8700,len:0x4
load:0x403c8704,len:0xc24
load:0x403cb700,len:0x30b4
entry 0x403c88b8
[  1169][I][esp32-hal-i2c-ng.c:105] i2cInit(): Initializing I2C Master: num=0 sda=41 scl=42 freq=100000
[  1179][W][Wire.cpp:296] begin(): Bus already started in Master Mode.
[  4245][E][Preferences.cpp:526] getBytesLength(): nvs_get_blob len fail: pidK NOT_FOUND
[  4253][E][Preferences.cpp:526] getBytesLength(): nvs_get_blob len fail: pidI NOT_FOUND
[  4261][E][Preferences.cpp:526] getBytesLength(): nvs_get_blob len fail: pidD NOT_FOUND
[  4269][E][Preferences.cpp:506] getString(): nvs_get_str len fail: tempTarget NOT_FOUND
[  4277][E][Preferences.cpp:506] getString(): nvs_get_str len fail: fanMode NOT_FOUND
ESP-ROM:esp32s3-20210327
Build:Mar 27 2021
rst:0x8 (TG1WDT_SYS_RST),boot:0x8 (SPI_FAST_FLASH_BOOT)
Saved PC:0x40376b71
  #0  0x40376b71 in panicHandler at /home/runner/work/esp32-arduino-lib-builder/esp32-arduino-lib-builder/esp-idf/components/esp_system/port/panic_handler.c:294

SPIWP:0xee
mode:DIO, clock div:1
load:0x3fce2820,len:0x1150
load:0x403c8700,len:0x4
load:0x403c8704,len:0xc24
load:0x403cb700,len:0x30b4
entry 0x403c88b8
[  1169][I][esp32-hal-i2c-ng.c:105] i2cInit(): Initializing I2C Master: num=0 sda=41 scl=42 freq=100000
[  1180][W][Wire.cpp:296] begin(): Bus already started in Master Mode.
[  4246][E][Preferences.cpp:526] getBytesLength(): nvs_get_blob len fail: pidK NOT_FOUND
[  4254][E][Preferences.cpp:526] getBytesLength(): nvs_get_blob len fail: pidI NOT_FOUND
[  4262][E][Preferences.cpp:526] getBytesLength(): nvs_get_blob len fail: pidD NOT_FOUND
[  4270][E][Preferences.cpp:506] getString(): nvs_get_str len fail: tempTarget NOT_FOUND
[  4278][E][Preferences.cpp:506] getString(): nvs_get_str len fail: fanMode NOT_FOUND
ESP-ROM:esp32s3-20210327
Build:Mar 27 2021
rst:0x8 (TG1WDT_SYS_RST),boot:0x8 (SPI_FAST_FLASH_BOOT)
Saved PC:0x40376b71
  #0  0x40376b71 in panicHandler at /home/runner/work/esp32-arduino-lib-builder/esp32-arduino-lib-builder/esp-idf/components/esp_system/port/panic_handler.c:294

SPIWP:0xee
mode:DIO, clock div:1
load:0x3fce2820,len:0x1150
load:0x403c8700,len:0x4
load:0x403c8704,len:0xc24
load:0x403cb700,len:0x30b4
entry 0x403c88b8
[  1170][I][esp32-hal-i2c-ng.c:105] i2cInit(): Initializing I2C Master: num=0 sda=41 scl=42 freq=100000
[  1180][W][Wire.cpp:296] begin(): Bus already started in Master Mode.
[  4246][E][Preferences.cpp:526] getBytesLength(): nvs_get_blob len fail: pidK NOT_FOUND
[  4254][E][Preferences.cpp:526] getBytesLength(): nvs_get_blob len fail: pidI NOT_FOUND
[  4262][E][Preferences.cpp:526] getBytesLength(): nvs_get_blob len fail: pidD NOT_FOUND
[  4270][E][Preferences.cpp:506] getString(): nvs_get_str len fail: tempTarget NOT_FOUND
[  4278][E][Preferences.cpp:506] getString(): nvs_get_str len fail: fanMode NOT_FOUND
ESP-ROM:esp32s3-20210327
Build:Mar 27 2021
rst:0x8 (TG1WDT_SYS_RST),boot:0x8 (SPI_FAST_FLASH_BOOT)
Saved PC:0x40376b71
  #0  0x40376b71 in panicHandler at /home/runner/work/esp32-arduino-lib-builder/esp32-arduino-lib-builder/esp-idf/components/esp_system/port/panic_handler.c:294

SPIWP:0xee
mode:DIO, clock div:1
load:0x3fce2820,len:0x1150
load:0x403c8700,len:0x4
load:0x403c8704,len:0xc24
load:0x403cb700,len:0x30b4
entry 0x403c88b8
[  1169][I][esp32-hal-i2c-ng.c:105] i2cInit(): Initializing I2C Master: num=0 sda=41 scl=42 freq=100000
[  1180][W][Wire.cpp:296] begin(): Bus already started in Master Mode.
[  4246][E][Preferences.cpp:526] getBytesLength(): nvs_get_blob len fail: pidK NOT_FOUND
[  4254][E][Preferences.cpp:526] getBytesLength(): nvs_get_blob len fail: pidI NOT_FOUND
[  4262][E][Preferences.cpp:526] getBytesLength(): nvs_get_blob len fail: pidD NOT_FOUND
[  4270][E][Preferences.cpp:506] getString(): nvs_get_str len fail: tempTarget NOT_FOUND
[  4278][E][Preferences.cpp:506] getString(): nvs_get_str len fail: fanMode NOT_FOUND
ESP-ROM:esp32s3-20210327
Build:Mar 27 2021
rst:0x8 (TG1WDT_SYS_RST),boot:0x8 (SPI_FAST_FLASH_BOOT)
Saved PC:0x40376b71
  #0  0x40376b71 in panicHandler at /home/runner/work/esp32-arduino-lib-builder/esp32-arduino-lib-builder/esp-idf/components/esp_system/port/panic_handler.c:294

SPIWP:0xee
mode:DIO, clock div:1
load:0x3fce2820,len:0x1150
load:0x403c8700,len:0x4
load:0x403c8704,len:0xc24
load:0x403cb700,len:0x30b4
entry 0x403c88b8
[  1168][I][esp32-hal-i2c-ng.c:105] i2cInit(): Initializing I2C Master: num=0 sda=41 scl=42 freq=100000
[  1178][W][Wire.cpp:296] begin(): Bus already started in Master Mode.
[  4244][E][Preferences.cpp:526] getBytesLength(): nvs_get_blob len fail: pidK NOT_FOUND
[  4252][E][Preferences.cpp:526] getBytesLength(): nvs_get_blob len fail: pidI NOT_FOUND
[  4260][E][Preferences.cpp:526] getBytesLength(): nvs_get_blob len fail: pidD NOT_FOUND
[  4268][E][Preferences.cpp:506] getString(): nvs_get_str len fail: tempTarget NOT_FOUND
[  4276][E][Preferences.cpp:506] getString(): nvs_get_str len fail: fanMode NOT_FOUND
