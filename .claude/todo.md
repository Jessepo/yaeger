
Smaller screen optimization

11. The slider for Fan and Heater are slightly out of alignment - the fan is slightly lower
12. The roast failed.. Connected to the local hotspot yaeger.local (flaky for some reason, my computer issues likely) It appears to have frozen and the PID continued for maintain temperature. OLED temperatures worked, possibly also on the web interface but the PID following broke. 
13. The heater readout gets super weird, bounces around.. Something after I started a roast, stopped it, and cleared all. I don't think it was actually on (the fan was off) but the readout slider was moving around. Scary




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
