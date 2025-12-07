import type { CurvePoint, FanCurvePoint } from "./types"

// Calculate point on quadratic bezier curve
export function getQuadraticBezierPoint(
  t: number,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
): { x: number; y: number } {
  const oneMinusT = 1 - t
  return {
    x: oneMinusT * oneMinusT * p0.x + 2 * oneMinusT * t * p1.x + t * t * p2.x,
    y: oneMinusT * oneMinusT * p0.y + 2 * oneMinusT * t * p1.y + t * t * p2.y,
  }
}

// Calculate point on cubic bezier curve
export function getCubicBezierPoint(
  t: number,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
): { x: number; y: number } {
  const oneMinusT = 1 - t
  const oneMinusT2 = oneMinusT * oneMinusT
  const oneMinusT3 = oneMinusT2 * oneMinusT
  const t2 = t * t
  const t3 = t2 * t

  return {
    x: oneMinusT3 * p0.x + 3 * oneMinusT2 * t * p1.x + 3 * oneMinusT * t2 * p2.x + t3 * p3.x,
    y: oneMinusT3 * p0.y + 3 * oneMinusT2 * t * p1.y + 3 * oneMinusT * t2 * p2.y + t3 * p3.y,
  }
}

// Generate smooth curve points from control points
export function generateCurvePoints(
  startTemp: number,
  endTemp: number,
  totalTime: number,
  controlPoint: { x: number; y: number },
  resolution = 100,
): CurvePoint[] {
  const points: CurvePoint[] = []

  const p0 = { x: 0, y: startTemp }
  const p2 = { x: totalTime, y: endTemp }
  const p1 = {
    x: controlPoint.x * totalTime,
    y: startTemp + controlPoint.y * (endTemp - startTemp),
  }

  for (let i = 0; i <= resolution; i++) {
    const t = i / resolution
    const point = getQuadraticBezierPoint(t, p0, p1, p2)
    points.push({
      time: point.x,
      temperature: point.y,
    })
  }

  return points
}

// Get target temperature at a specific time
export function getTargetTemperature(curve: CurvePoint[], currentTime: number): number {
  if (curve.length === 0) return 0
  if (currentTime <= curve[0].time) return curve[0].temperature
  if (currentTime >= curve[curve.length - 1].time) return curve[curve.length - 1].temperature

  // Find surrounding points
  for (let i = 0; i < curve.length - 1; i++) {
    if (currentTime >= curve[i].time && currentTime <= curve[i + 1].time) {
      const t = (currentTime - curve[i].time) / (curve[i + 1].time - curve[i].time)
      return curve[i].temperature + t * (curve[i + 1].temperature - curve[i].temperature)
    }
  }

  return curve[curve.length - 1].temperature
}

export function generateFanCurvePoints(
  startFanSpeed: number,
  endFanSpeed: number,
  totalTime: number,
  controlPoint: { x: number; y: number },
  resolution = 100,
): FanCurvePoint[] {
  const points: FanCurvePoint[] = []

  const p0 = { x: 0, y: startFanSpeed }
  const p2 = { x: totalTime, y: endFanSpeed }
  const p1 = {
    x: controlPoint.x * totalTime,
    y: startFanSpeed + controlPoint.y * (endFanSpeed - startFanSpeed),
  }

  for (let i = 0; i <= resolution; i++) {
    const t = i / resolution
    const point = getQuadraticBezierPoint(t, p0, p1, p2)
    points.push({
      time: point.x,
      fanSpeed: Math.max(0, Math.min(100, point.y)), // Clamp to 0-100
    })
  }

  return points
}

export function getTargetFanSpeed(curve: FanCurvePoint[], currentTime: number): number {
  if (curve.length === 0) return 50
  if (currentTime <= curve[0].time) return curve[0].fanSpeed
  if (currentTime >= curve[curve.length - 1].time) return curve[curve.length - 1].fanSpeed

  // Find surrounding points
  for (let i = 0; i < curve.length - 1; i++) {
    if (currentTime >= curve[i].time && currentTime <= curve[i + 1].time) {
      const t = (currentTime - curve[i].time) / (curve[i + 1].time - curve[i].time)
      return curve[i].fanSpeed + t * (curve[i + 1].fanSpeed - curve[i].fanSpeed)
    }
  }

  return curve[curve.length - 1].fanSpeed
}

// Create default roast profile
export function createDefaultProfile(targetTemp = 215, targetTimeMinutes = 6, control: { x: number, y: number }): CurvePoint[] {
  const totalTimeSeconds = targetTimeMinutes * 60
  const startTemp = 25

  // Default control point creates a nice S-curve
  return generateCurvePoints(startTemp, targetTemp, totalTimeSeconds, control)
}

export function createDefaultFanProfile(startSpeed = 30, endSpeed = 80, targetTimeMinutes = 6, control: { x: number, y: number }): FanCurvePoint[] {
  const totalTimeSeconds = targetTimeMinutes * 60
  return generateFanCurvePoints(startSpeed, endSpeed, totalTimeSeconds, control)
}
