
Smaller screen optimization
1. 10080 pixels wide pi screen in kiosk mode. Readings fixed width, setpoint only 2 places after decimal. Should show on left with Controls and events on right. 30% or so width should be readings and the rest controls/events. 
2. Top bar buttons should be half as wide, perhaps wrap text into two lines? Smaller text is ok, just 15% or so though. Move PID toggle to the PID container at the bottom, automatically enable PID when loading prfile. Add a "Clear Reset" button between cool down and all off. This would clear the screen, stop data collection, and be prepared to start following the profile once "start roast" is pressed. 
3. The profile modification bar should always stay below the graph. at this smaller width is is below the readings/controls/events cell
4. Loading a profile again should trigger a reset, roast data is cleared and machine is ready to follow the profile with "start roast"
5. End roast button should trigger "drop" event and start cool down process. at 50 BT cool down should end and trigger popup to save roast .json to device along with image. Also set roast name if it hasn't been set. 
6. There is no way to clear the screen or stop data collection/display after start roast has been pressed. 


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
