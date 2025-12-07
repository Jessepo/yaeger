"use client"

import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { FanCurvePoint } from "@/lib/types"
import { generateFanCurvePoints } from "@/lib/bezier-utils"

interface FanCurveEditorProps {
  startFanSpeed: number
  endFanSpeed: number
  targetControlPoint: {x: number, y: number }
  targetTimeMinutes: number
  onCurveChange: (curve: FanCurvePoint[], control: {x: number, y: number}) => void
  currentTime?: number
  actualFanSpeed?: number
}

export function FanCurveEditor({
  startFanSpeed,
  endFanSpeed,
  targetControlPoint,
  targetTimeMinutes,
  onCurveChange,
  currentTime = 0,
  actualFanSpeed,
}: FanCurveEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [controlPoint, setControlPoint] = useState(targetControlPoint)
  const [isDragging, setIsDragging] = useState(false)
  const [dimensions, setDimensions] = useState({ width: 600, height: 300 })

  const onCurveChangeRef = useRef(onCurveChange)
  useEffect(() => {
    onCurveChangeRef.current = onCurveChange
  }, [onCurveChange])

  const padding = { top: 30, right: 40, bottom: 40, left: 50 }
  const chartWidth = dimensions.width - padding.left - padding.right
  const chartHeight = dimensions.height - padding.top - padding.bottom

  const totalTimeSeconds = targetTimeMinutes * 60

  useEffect(() => {
    const curve = generateFanCurvePoints(startFanSpeed, endFanSpeed, totalTimeSeconds, controlPoint)
    onCurveChangeRef.current(curve, controlPoint)
  }, [controlPoint, startFanSpeed, endFanSpeed, totalTimeSeconds])

  // Handle resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        setDimensions({
          width: Math.max(400, rect.width),
          height: Math.max(200, Math.min(300, rect.width * 0.4)),
        })
      }
    }

    updateDimensions()
    window.addEventListener("resize", updateDimensions)
    return () => window.removeEventListener("resize", updateDimensions)
  }, [])

  // Draw the curve
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = dimensions.width * dpr
    canvas.height = dimensions.height * dpr
    ctx.scale(dpr, dpr)

    // Clear canvas
    ctx.fillStyle = "hsl(240 10% 10%)"
    ctx.fillRect(0, 0, dimensions.width, dimensions.height)

    // Helper functions
    const timeToX = (time: number) => padding.left + (time / totalTimeSeconds) * chartWidth
    const speedToY = (speed: number) => padding.top + chartHeight - (speed / 100) * chartHeight

    // Draw grid
    ctx.strokeStyle = "hsl(240 10% 20%)"
    ctx.lineWidth = 1

    // Vertical grid lines (time)
    for (let i = 0; i <= targetTimeMinutes; i++) {
      const x = timeToX(i * 60)
      ctx.beginPath()
      ctx.moveTo(x, padding.top)
      ctx.lineTo(x, padding.top + chartHeight)
      ctx.stroke()
    }

    // Horizontal grid lines (fan speed)
    for (let speed = 0; speed <= 100; speed += 20) {
      const y = speedToY(speed)
      ctx.beginPath()
      ctx.moveTo(padding.left, y)
      ctx.lineTo(padding.left + chartWidth, y)
      ctx.stroke()
    }

    // Draw axes labels
    ctx.fillStyle = "hsl(0 0% 60%)"
    ctx.font = "11px Geist, sans-serif"
    ctx.textAlign = "center"

    // Time labels
    for (let i = 0; i <= targetTimeMinutes; i++) {
      const x = timeToX(i * 60)
      ctx.fillText(`${i}m`, x, dimensions.height - 10)
    }

    // Fan speed labels
    ctx.textAlign = "right"
    for (let speed = 0; speed <= 100; speed += 20) {
      const y = speedToY(speed)
      ctx.fillText(`${speed}%`, padding.left - 8, y + 4)
    }

    // Draw the bezier curve
    const p0 = { x: timeToX(0), y: speedToY(startFanSpeed) }
    const p2 = { x: timeToX(totalTimeSeconds), y: speedToY(endFanSpeed) }
    const p1 = {
      x: padding.left + controlPoint.x * chartWidth,
      y: padding.top + chartHeight - controlPoint.y * chartHeight,
    }

    // Curve fill
    ctx.beginPath()
    ctx.moveTo(p0.x, p0.y)
    ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y)
    ctx.lineTo(p2.x, padding.top + chartHeight)
    ctx.lineTo(p0.x, padding.top + chartHeight)
    ctx.closePath()
    ctx.fillStyle = "hsla(200, 70%, 50%, 0.1)"
    ctx.fill()

    // Curve line
    ctx.beginPath()
    ctx.moveTo(p0.x, p0.y)
    ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y)
    ctx.strokeStyle = "hsl(200, 70%, 50%)"
    ctx.lineWidth = 3
    ctx.stroke()

    // Draw control lines
    ctx.strokeStyle = "hsla(200, 70%, 50%, 0.3)"
    ctx.lineWidth = 1
    ctx.setLineDash([5, 5])
    ctx.beginPath()
    ctx.moveTo(p0.x, p0.y)
    ctx.lineTo(p1.x, p1.y)
    ctx.lineTo(p2.x, p2.y)
    ctx.stroke()
    ctx.setLineDash([])

    // Draw control point
    ctx.beginPath()
    ctx.arc(p1.x, p1.y, 10, 0, Math.PI * 2)
    ctx.fillStyle = isDragging ? "hsl(200, 70%, 60%)" : "hsl(200, 70%, 50%)"
    ctx.fill()
    ctx.strokeStyle = "hsl(0 0% 100%)"
    ctx.lineWidth = 2
    ctx.stroke()

    // Draw start and end points
    ctx.beginPath()
    ctx.arc(p0.x, p0.y, 5, 0, Math.PI * 2)
    ctx.fillStyle = "hsl(200, 60%, 40%)"
    ctx.fill()

    ctx.beginPath()
    ctx.arc(p2.x, p2.y, 5, 0, Math.PI * 2)
    ctx.fillStyle = "hsl(200, 60%, 70%)"
    ctx.fill()

    // Draw current time marker
    if (currentTime > 0 && currentTime <= totalTimeSeconds) {
      const currentX = timeToX(currentTime)
      ctx.strokeStyle = "hsl(140, 60%, 50%)"
      ctx.lineWidth = 2
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(currentX, padding.top)
      ctx.lineTo(currentX, padding.top + chartHeight)
      ctx.stroke()
      ctx.setLineDash([])

      // Draw actual fan speed point if available
      if (actualFanSpeed !== undefined) {
        const actualY = speedToY(actualFanSpeed)
        ctx.beginPath()
        ctx.arc(currentX, actualY, 6, 0, Math.PI * 2)
        ctx.fillStyle = "hsl(140, 60%, 50%)"
        ctx.fill()
        ctx.strokeStyle = "hsl(0 0% 100%)"
        ctx.lineWidth = 2
        ctx.stroke()
      }
    }

    // Axis labels
    ctx.fillStyle = "hsl(0 0% 70%)"
    ctx.font = "12px Geist, sans-serif"
    ctx.textAlign = "center"
    ctx.fillText("Time", dimensions.width / 2, dimensions.height - 2)

    ctx.save()
    ctx.translate(12, dimensions.height / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.fillText("Fan Speed (%)", 0, 0)
    ctx.restore()
  }, [
    controlPoint,
    dimensions,
    isDragging,
    currentTime,
    actualFanSpeed,
    startFanSpeed,
    endFanSpeed,
    targetTimeMinutes,
    totalTimeSeconds,
    chartWidth,
    chartHeight,
  ])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      const cpX = padding.left + controlPoint.x * chartWidth
      const cpY = padding.top + chartHeight - controlPoint.y * chartHeight

      const distance = Math.sqrt((x - cpX) ** 2 + (y - cpY) ** 2)
      if (distance < 20) {
        setIsDragging(true)
      }
    },
    [controlPoint, chartWidth, chartHeight],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDragging) return

      const canvas = canvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      const newX = Math.max(0.05, Math.min(0.95, (x - padding.left) / chartWidth))
      const newY = Math.max(0.05, Math.min(0.95, 1 - (y - padding.top) / chartHeight))

      setControlPoint({ x: newX, y: newY })
    },
    [isDragging, chartWidth, chartHeight],
  )

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  return (
    <div ref={containerRef} className="w-full">
      <canvas
        ref={canvasRef}
        style={{ width: dimensions.width, height: dimensions.height }}
        className="rounded-lg cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>Drag the control point to adjust the fan curve</span>
        <span className="font-mono">
          Control: ({(controlPoint.x * 100).toFixed(0)}%, {(controlPoint.y * 100).toFixed(0)}%)
        </span>
      </div>
    </div>
  )
}
