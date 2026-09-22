
// WebSocket message type
export type YaegerMessage = {
  ET: number;
  BT: number;
  Amb: number;
  FanVal: number;
  BurnerVal: number;
  CH3?: number;  // MLX90614 object temp (IR surface)
  CH4?: number;  // MLX90614 ambient temp
  id: number;
  wifiStrength?: number;
  type?: string;
  fanMode?: string;
  btSource?: string;
}

export class YaegerState  {
	roast?: RoastState
	currentState: CurrentState =  {
		status: RoasterStatus.idle
	};
}

export enum RoasterStatus {
	idle,
	roasting,
	cooling,
}

export type CurrentState = {
	lastMessage?: YaegerMessage
	lastUpdate?: Date
	status: RoasterStatus
}

export type Measurement = {
	timestamp: Date
	message: YaegerMessage
}

export type RoastState = {
	startDate: Date
	measurements: Measurement[] | []
	events: RoastEvent[] | []
	commands: RoastCommand[] | []
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

// Kept for chart.ts profile-line drawing and profiling.ts
export type Profile = {
	steps: ProfileStep[]
}

export type ProfileStep = {
	interpolation: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
	setpoint: number
	duration: number
	fanValue?: number
}
