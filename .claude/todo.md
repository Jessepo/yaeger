
Smaller screen optimization
1. Clear reset button returns it to freshly booted state. Look at all states, variables, etc. Sometimes the event markers stay, etc. 
2. Y axis on the plot should go to 400, not 300. Or maybe start at 300 and autoscale if it goes above
3. Fan setpoints should be interpolated, not steps. Just like BT
4. When I tried to mofify a roast as it was going, the whole roast data part of the plot disappeared. 
5. Can we try putting the readings to the right of the plot? Reading width stays fixed, whatever fits the current width of the readings and then stretch the plot to fill the rest. 



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
