
// WebSocket message type
export type YaegerMessage = {
  ET: number;
  BT: number;
  Amb: number;
  FanVal: number;
  BurnerVal: number;
  id: number;
  Setpoint?: number;
  Target?: string;
  Mode?: string;
  pidKp?: number;
  pidKi?: number;
  pidKd?: number;
  wifiStrength?: number;
  type?: string;
  cooldownFanSpeed?: number;
  fanMode?: string;
}

export class YaegerState  {
	roast?: RoastState
	currentState: CurrentState =  {
		status: RoasterStatus.idle
	};
	profile?: Profile
}

// Single source of truth for where we are in the roast lifecycle.
// Was previously spread across:
//   - state.currentState.status (idle/roasting)
//   - cooling.val (bool)
//   - coolDownTriggered (module-level let)
// Consolidated to one enum so the guards can't drift out of sync.
export enum RoasterStatus {
	idle,       // no roast active
	roasting,   // charge → drop
	cooling,    // drop → BT<50; chart frozen, End Roast disabled
}

export type CurrentState = {
	lastMessage?: YaegerMessage 
	lastUpdate?: Date
	status: RoasterStatus 
}

export type Measurement = {
	timestamp: Date
	message: YaegerMessage
	extra?: MeasurementExtra
}

export type MeasurementExtra = {
	setpoint: number
	pidData?: PIDData
}

export type RoastState = {
	startDate: Date
	measurements: Measurement[] | []
	events: RoastEvent[] | []
	commands: RoastCommand[] | []
	profile?: Profile
}

export type RoastEvent = {
	label: String
	measurement: Measurement
}

export type RoastCommand = {
	type: 'fan' | 'heater'
	value: number
	timestamp: Date
}

export type PIDData = {
	enabled: boolean
	kp: number
	ki: number
	kd: number
}

export type Profile = {
	steps: ProfileStep[]
}

export type ProfileStep = {
	interpolation: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
	setpoint: number
	duration: number
  fanValue?: number
}
