"use client"

import { Thermometer, Fan, Flame, Clock, Activity } from "lucide-react"
import type { RoasterData } from "@/lib/types"

interface StatusDisplayProps {
  currentData: RoasterData | null
  elapsedTime: number
  targetTemperature: number
  isConnected: boolean
  isRoasting: boolean
}

export function StatusDisplay({
  currentData,
  elapsedTime,
  targetTemperature,
  isConnected,
  isRoasting,
}: StatusDisplayProps) {
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
  }

  const getTemperatureColor = (temp: number | null | undefined) => {
    if (temp == null) return "text-muted-foreground"
    if (temp > 200) return "text-[hsl(var(--temperature-hot))]"
    if (temp > 150) return "text-[hsl(var(--temperature-warm))]"
    return "text-[hsl(var(--temperature-cool))]"
  }

  const formatNumber = (value: number | null | undefined, decimals = 1): string => {
    if (value == null || isNaN(value)) return "--"
    return value.toFixed(decimals)
  }

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div className="rounded-lg bg-card p-4">
        <div className="flex items-center gap-2 text-muted-foreground mb-2">
          <Thermometer className="h-4 w-4" />
          <span className="text-xs uppercase tracking-wide">Bean Temp</span>
        </div>
        <div className={`text-3xl font-mono font-bold ${getTemperatureColor(currentData?.beanTemperature)}`}>
          {formatNumber(currentData?.beanTemperature)}
          <span className="text-lg ml-1">°C</span>
        </div>
        <div className="text-xs text-muted-foreground mt-1">Target: {targetTemperature}°C</div>
      </div>

      <div className="rounded-lg bg-card p-4">
        <div className="flex items-center gap-2 text-muted-foreground mb-2">
          <Thermometer className="h-4 w-4" />
          <span className="text-xs uppercase tracking-wide">Drum Temp</span>
        </div>
        <div className={`text-3xl font-mono font-bold ${getTemperatureColor(currentData?.drumTemperature)}`}>
          {formatNumber(currentData?.drumTemperature)}
          <span className="text-lg ml-1">°C</span>
        </div>
      </div>

      <div className="rounded-lg bg-card p-4">
        <div className="flex items-center gap-2 text-muted-foreground mb-2">
          <Flame className="h-4 w-4" />
          <span className="text-xs uppercase tracking-wide">Heater</span>
        </div>
        <div className="text-3xl font-mono font-bold text-primary">
          {formatNumber(currentData?.heaterPower, 0)}
          <span className="text-lg ml-1">%</span>
        </div>
        <div className="mt-2 h-2 rounded-full bg-secondary overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${currentData?.heaterPower ?? 0}%` }}
          />
        </div>
      </div>

      <div className="rounded-lg bg-card p-4">
        <div className="flex items-center gap-2 text-muted-foreground mb-2">
          <Fan className="h-4 w-4" />
          <span className="text-xs uppercase tracking-wide">Fan Speed</span>
        </div>
        <div className="text-3xl font-mono font-bold text-chart-3">
          {formatNumber(currentData?.fanSpeed, 0)}
          <span className="text-lg ml-1">%</span>
        </div>
        <div className="mt-2 h-2 rounded-full bg-secondary overflow-hidden">
          <div
            className="h-full bg-chart-3 transition-all duration-300"
            style={{ width: `${currentData?.fanSpeed ?? 0}%` }}
          />
        </div>
      </div>

      <div className="rounded-lg bg-card p-4 col-span-2">
        <div className="flex items-center gap-2 text-muted-foreground mb-2">
          <Clock className="h-4 w-4" />
          <span className="text-xs uppercase tracking-wide">Elapsed Time</span>
        </div>
        <div className="text-4xl font-mono font-bold text-foreground">{formatTime(elapsedTime)}</div>
      </div>

      <div className="rounded-lg bg-card p-4 col-span-2">
        <div className="flex items-center gap-2 text-muted-foreground mb-2">
          <Activity className="h-4 w-4" />
          <span className="text-xs uppercase tracking-wide">Status</span>
        </div>
        <div className="flex items-center gap-3">
          <div
            className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm ${
              isConnected
                ? "bg-[hsl(var(--success))]/20 text-[hsl(var(--success))]"
                : "bg-destructive/20 text-destructive"
            }`}
          >
            <div
              className={`h-2 w-2 rounded-full ${isConnected ? "bg-[hsl(var(--success))] animate-pulse" : "bg-destructive"}`}
            />
            {isConnected ? "Connected" : "Disconnected"}
          </div>
          <div
            className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm ${
              isRoasting ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground"
            }`}
          >
            <div
              className={`h-2 w-2 rounded-full ${isRoasting ? "bg-primary animate-pulse" : "bg-muted-foreground"}`}
            />
            {isRoasting ? "Roasting" : "Idle"}
          </div>
        </div>
      </div>
    </div>
  )
}
