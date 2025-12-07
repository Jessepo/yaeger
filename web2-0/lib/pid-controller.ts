import type { PIDConfig } from "./types"

export class PIDController {
  private kp: number
  private ki: number
  private kd: number
  private outputMin: number
  private outputMax: number

  private integral = 0
  private previousError = 0
  private lastTime = 0

  constructor(config: PIDConfig) {
    this.kp = config.kp
    this.ki = config.ki
    this.kd = config.kd
    this.outputMin = config.outputMin
    this.outputMax = config.outputMax
  }

  update(setpoint: number, measured: number, currentTime: number): number {
    const dt = this.lastTime === 0 ? 0.1 : (currentTime - this.lastTime) / 1000
    this.lastTime = currentTime

    const error = setpoint - measured

    // Proportional term
    const pTerm = this.kp * error

    // Integral term with anti-windup
    this.integral += error * dt
    this.integral = Math.max(-100, Math.min(100, this.integral))
    const iTerm = this.ki * this.integral

    // Derivative term
    const derivative = dt > 0 ? (error - this.previousError) / dt : 0
    const dTerm = this.kd * derivative

    this.previousError = error

    // Calculate output
    let output = pTerm + iTerm + dTerm
    output = Math.max(this.outputMin, Math.min(this.outputMax, output))

    return output
  }

  reset(): void {
    this.integral = 0
    this.previousError = 0
    this.lastTime = 0
  }

  setTunings(kp: number, ki: number, kd: number): void {
    this.kp = kp
    this.ki = ki
    this.kd = kd
  }
}
