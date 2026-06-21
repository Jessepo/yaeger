
Smaller screen optimization

11. The slider for Fan and Heater are slightly out of alignment - the fan is slightly lower
12. After the cooling phase automatically ended at 50 degrees  I pressed "end roast" again and the fan turned back on for a moment and off again. It should automatically trigger "end roast" when the roast is in cooling mode
13. I added a lot of testing in miniweb/src/__tests__ and ran a number of tests and maybe fixed a number of things. run the tests again and try and see where we are. 




when disconnected and reconnected this was the  serial output. Is there anything I should worry about there?:
Roast started
1] Disconnected!
ge(): [/ws][1] Too many messages queued: closing connection
2] Connected!
 nvs_get_blob len fail: pidK NOT_FOUND
en fail: pidI NOT_FOUND
en fail: pidD NOT_FOUND
l: fanMode NOT_FOUND
hermocouple fault(s) detected on sensor Exhaust! Error: 4
[Exhaust]: Thermocouple is short-circuited to VCC.
hermocouple fault(s) detected on sensor Exhaust! Error: 4
[Exhaust]: Thermocouple is short-circuited to VCC.
oast ended
ll off
2] Disconnected!
ge(): [/ws][2] Too many messages queued: closing connection
