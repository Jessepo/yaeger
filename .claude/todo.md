
Smaller screen optimization


12. After the cooling phase automatically ended at 50 degrees  I pressed "end roast" again and the fan turned back on for a moment and off again. It should automatically trigger "end roast" when the roast is in cooling mode
13. I added a lot of testing in miniweb/src/__tests__ and ran a number of tests and maybe fixed a number of things. run the tests again and try and see where we are. 

ort/panic_handler.c:294

SPIWP:0xee
mode:DIO, clock div:1
load:0x3fce2820,len:0x1150
load:0x403c8700,len:0x4
load:0x403c8704,len:0xc24
load:0x403cb700,len:0x30b4
entry 0x403c88b8
[  1167][I][esp32-hal-i2c-ng.c:105] i2cInit(): Initializing I2C Master: num=0 sda=41 scl=42 freq=100000
[  1177][W][Wire.cpp:296] begin(): Bus already started in Master Mode.
[  4243][E][Preferences.cpp:526] getBytesLength(): nvs_get_blob len fail: pidK NOT_FOUND
[  4251][E][Preferences.cpp:526] getBytesLength(): nvs_get_blob len fail: pidI NOT_FOUND
[  4259][E][Preferences.cpp:526] getBytesLength(): nvs_get_blob len fail: pidD NOT_FOUND
[  4267][E][Preferences.cpp:506] getString(): nvs_get_str len fail: tempTarget NOT_FOUND
[  4275][E][Preferences.cpp:506] getString(): nvs_get_str len fail: fanMode NOT_FOUND
E (4281) ledc: requested frequency 50 and duty resolution 8 can not be achieved, try reducing freq_hz or duty_resolution. div_param=0
