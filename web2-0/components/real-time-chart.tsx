"use client"

import { useEffect, useRef } from "react"
import type { CurvePoint, FanCurvePoint, RoasterData } from "@/lib/types"

interface RealTimeChartProps {
  dataHistory: RoasterData[]
  targetCurve: CurvePoint[]
  fanCurve?: FanCurvePoint[]
  totalTimeSeconds: number
  maxTemperature: number
  currentTime: number
}

export function RealTimeChart({
  dataHistory,
  targetCurve,
  fanCurve,
  totalTimeSeconds,
  maxTemperature,
  currentTime,
}: RealTimeChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1

    canvas.width = rect.width * dpr
    canvas.height = 300 * dpr
    canvas.style.width = `${rect.width}px`
    canvas.style.height = "300px"

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    ctx.scale(dpr, dpr)

    const width = rect.width
    const height = 300
    const padding = { top: 30, right: 50, bottom: 40, left: 50 } // Added right padding for fan axis
    const chartWidth = width - padding.left - padding.right
    const chartHeight = height - padding.top - padding.bottom

    // Clear
    ctx.fillStyle = "hsl(240 10% 12%)"
    ctx.fillRect(0, 0, width, height)

    const timeToX = (time: number) => padding.left + (time / totalTimeSeconds) * chartWidth
    const tempToY = (temp: number) => padding.top + chartHeight - (temp / (maxTemperature + 20)) * chartHeight
    const fanToY = (fan: number) => padding.top + chartHeight - (fan / 100) * chartHeight

    // Grid
    ctx.strokeStyle = "hsl(240 10% 18%)"
    ctx.lineWidth = 1

    // Vertical grid (every minute)
    const minutes = Math.ceil(totalTimeSeconds / 60)
    for (let i = 0; i <= minutes; i++) {
      const x = timeToX(i * 60)
      ctx.beginPath()
      ctx.moveTo(x, padding.top)
      ctx.lineTo(x, padding.top + chartHeight)
      ctx.stroke()
    }

    // Horizontal grid
    for (let temp = 50; temp <= maxTemperature + 20; temp += 25) {
      const y = tempToY(temp)
      ctx.beginPath()
      ctx.moveTo(padding.left, y)
      ctx.lineTo(padding.left + chartWidth, y)
      ctx.stroke()
    }

    // Labels - Left axis (Temperature)
    ctx.fillStyle = "hsl(0 0% 50%)"
    ctx.font = "11px Geist Mono, monospace"
    ctx.textAlign = "center"

    for (let i = 0; i <= minutes; i++) {
      ctx.fillText(`${i}m`, timeToX(i * 60), height - 15)
    }

    ctx.textAlign = "right"
    for (let temp = 50; temp <= maxTemperature + 20; temp += 50) {
      ctx.fillText(`${temp}°`, padding.left - 8, tempToY(temp) + 4)
    }

    ctx.textAlign = "left"
    ctx.fillStyle = "hsl(280 60% 60%)"
    for (let fan = 0; fan <= 100; fan += 25) {
      ctx.fillText(`${fan}%`, padding.left + chartWidth + 8, fanToY(fan) + 4)
    }

    if (fanCurve && fanCurve.length > 0) {
      ctx.beginPath()
      ctx.moveTo(timeToX(fanCurve[0].time), fanToY(fanCurve[0].fanSpeed))
      for (let i = 1; i < fanCurve.length; i++) {
        ctx.lineTo(timeToX(fanCurve[i].time), fanToY(fanCurve[i].fanSpeed))
      }
      ctx.strokeStyle = "hsla(280, 60%, 60%, 0.5)"
      ctx.lineWidth = 2
      ctx.setLineDash([5, 5])
      ctx.stroke()
      ctx.setLineDash([])
    }

    // Target temperature curve
    if (targetCurve.length > 0) {
      ctx.beginPath()
      ctx.moveTo(timeToX(targetCurve[0].time), tempToY(targetCurve[0].temperature))
      for (let i = 1; i < targetCurve.length; i++) {
        ctx.lineTo(timeToX(targetCurve[i].time), tempToY(targetCurve[i].temperature))
      }
      ctx.strokeStyle = "hsla(35, 80%, 55%, 0.5)"
      ctx.lineWidth = 2
      ctx.setLineDash([5, 5])
      ctx.stroke()
      ctx.setLineDash([])
    }

    if (dataHistory.length > 0) {
      ctx.beginPath()
      ctx.moveTo(timeToX(dataHistory[0].timestamp), fanToY(dataHistory[0].fanSpeed))
      for (let i = 1; i < dataHistory.length; i++) {
        ctx.lineTo(timeToX(dataHistory[i].timestamp), fanToY(dataHistory[i].fanSpeed))
      }
      ctx.strokeStyle = "hsl(280, 60%, 60%)"
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    // Actual bean temperature
    if (dataHistory.length > 0) {
      ctx.beginPath()
      ctx.moveTo(timeToX(dataHistory[0].timestamp), tempToY(dataHistory[0].beanTemperature))
      for (let i = 1; i < dataHistory.length; i++) {
        ctx.lineTo(timeToX(dataHistory[i].timestamp), tempToY(dataHistory[i].beanTemperature))
      }
      ctx.strokeStyle = "hsl(140, 60%, 50%)"
      ctx.lineWidth = 2
      ctx.stroke()

      // Current point
      const latest = dataHistory[dataHistory.length - 1]
      ctx.beginPath()
      ctx.arc(timeToX(latest.timestamp), tempToY(latest.beanTemperature), 5, 0, Math.PI * 2)
      ctx.fillStyle = "hsl(140, 60%, 50%)"
      ctx.fill()
    }

    // Drum temperature
    if (dataHistory.length > 0) {
      ctx.beginPath()
      ctx.moveTo(timeToX(dataHistory[0].timestamp), tempToY(dataHistory[0].drumTemperature))
      for (let i = 1; i < dataHistory.length; i++) {
        ctx.lineTo(timeToX(dataHistory[i].timestamp), tempToY(dataHistory[i].drumTemperature))
      }
      ctx.strokeStyle = "hsl(200, 60%, 50%)"
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    // Current time marker
    if (currentTime > 0) {
      ctx.strokeStyle = "hsla(0, 0%, 100%, 0.3)"
      ctx.lineWidth = 1
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(timeToX(currentTime), padding.top)
      ctx.lineTo(timeToX(currentTime), padding.top + chartHeight)
      ctx.stroke()
      ctx.setLineDash([])
    }

    ctx.font = "10px Geist, sans-serif"
    ctx.textAlign = "left"

    ctx.fillStyle = "hsl(140, 60%, 50%)"
    ctx.fillRect(padding.left + 10, padding.top + 10, 12, 3)
    ctx.fillStyle = "hsl(0 0% 70%)"
    ctx.fillText("Bean", padding.left + 28, padding.top + 14)

    ctx.fillStyle = "hsl(200, 60%, 50%)"
    ctx.fillRect(padding.left + 70, padding.top + 10, 12, 3)
    ctx.fillStyle = "hsl(0 0% 70%)"
    ctx.fillText("Drum", padding.left + 88, padding.top + 14)

    ctx.fillStyle = "hsla(35, 80%, 55%, 0.5)"
    ctx.fillRect(padding.left + 130, padding.top + 10, 12, 3)
    ctx.fillStyle = "hsl(0 0% 70%)"
    ctx.fillText("Target", padding.left + 148, padding.top + 14)

    ctx.fillStyle = "hsl(280, 60%, 60%)"
    ctx.fillRect(padding.left + 195, padding.top + 10, 12, 3)
    ctx.fillStyle = "hsl(0 0% 70%)"
    ctx.fillText("Fan", padding.left + 213, padding.top + 14)

    ctx.fillStyle = "hsla(280, 60%, 60%, 0.5)"
    ctx.fillRect(padding.left + 245, padding.top + 10, 12, 3)
    ctx.fillStyle = "hsl(0 0% 70%)"
    ctx.fillText("Fan Target", padding.left + 263, padding.top + 14)
  }, [dataHistory, targetCurve, fanCurve, totalTimeSeconds, maxTemperature, currentTime])

  return (
    <div ref={containerRef} className="w-full">
      <canvas ref={canvasRef} className="rounded-lg" />
    </div>
  )
}
