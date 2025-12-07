// Core types for the roasting control system

export interface YaegerData {
  ET: number // Environment/Exhaust temperature
  BT: number // Bean temperature
  Amb: number // Ambient temperature
  FanVal: number // Fan value (0-100)
  BurnerVal: number // Burner/heater value (0-100)
}

export interface YaegerMessage {
  data: YaegerData
  id: number
}

export interface YaegerCommand {
  id: number
  command: "getData" | "setBurner" | "setFan" | "startCooling"
  value?: number
}

export interface RoasterData {
  timestamp: number
  beanTemperature: number
  drumTemperature: number // Maps to ET
  ambientTemperature: number // Maps to Amb
  heaterPower: number // Maps to BurnerVal
  fanSpeed: number // Maps to FanVal
}

export type RoastPhase = "idle" | "preheat" | "roasting" | "cooling" | "finished"

export interface CurvePoint {
  time: number // seconds
  temperature: number // celsius
  controlX?: number // bezier control point
  controlY?: number // bezier control point
}

export interface FanCurvePoint {
  time: number // seconds
  fanSpeed: number // 0-100%
}

export interface RoastProfile {
  id: string
  name: string
  targetTemperature: number
  targetTime: number // seconds
  curve: CurvePoint[]
  fanCurve?: FanCurvePoint[]
  fanStartSpeed?: number // 0-100%
  fanEndSpeed?: number // 0-100%
  createdAt: number
}

export interface CompletedRoast {
  id: string
  profileName: string
  profileId: string
  startTime: number
  endTime: number
  targetTemperature: number
  targetTime: number
  maxBeanTemperature: number
  totalDuration: number // seconds
  dataHistory: RoasterData[]
  curve: CurvePoint[]
  fanCurve?: FanCurvePoint[]
  notes?: string
  coffeeInfo?: CoffeeInfo // Add coffee info to completed roast
}

export interface PIDConfig {
  kp: number
  ki: number
  kd: number
  outputMin: number
  outputMax: number
}

export interface CoffeeInfo {
  beanName: string
  origin: string
  producer?: string // Added producer field
  variety?: string
  process?: string // washed, natural, honey, etc.
  weight?: number // grams
  roastLevel?: string // light, medium, dark, etc.
  notes?: string
}

export interface RoasterState {
  isConnected: boolean
  isRoasting: boolean
  isAutoMode: boolean
  currentProfile: RoastProfile | null
  elapsedTime: number
  dataHistory: RoasterData[]
  phase: RoastPhase
}

export interface WebSocketMessage {
  type: "data" | "command" | "status" | "error"
  payload: Record<string, unknown>
}
