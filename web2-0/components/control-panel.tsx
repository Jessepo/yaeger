"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Play, Square, Wifi, WifiOff, Settings, Wind, Thermometer } from "lucide-react"
import type { PIDConfig, RoastPhase } from "@/lib/types"

interface ControlPanelProps {
  isConnected: boolean
  isRoasting: boolean
  isAutoMode: boolean
  manualHeaterPower: number
  manualFanSpeed: number
  pidConfig: PIDConfig
  wsUrl: string
  targetTemperature: number
  targetTimeMinutes: number
  phase: RoastPhase
  currentTemperature?: number
  onConnect: () => void
  onDisconnect: () => void
  onStartRoast: () => void
  onStopRoast: () => void
  onStartCooling: () => void
  onFinishRoast: () => void
  onAutoModeChange: (auto: boolean) => void
  onManualHeaterChange: (power: number) => void
  onManualFanChange: (speed: number) => void
  onPidConfigChange: (config: Partial<PIDConfig>) => void
  onWsUrlChange: (url: string) => void
  onTargetChange: (temp: number, time: number) => void
}

export function ControlPanel({
  isConnected,
  isRoasting,
  isAutoMode,
  manualHeaterPower,
  manualFanSpeed,
  pidConfig,
  wsUrl,
  targetTemperature,
  targetTimeMinutes,
  phase,
  currentTemperature,
  onConnect,
  onDisconnect,
  onStartRoast,
  onStopRoast,
  onStartCooling,
  onFinishRoast,
  onAutoModeChange,
  onManualHeaterChange,
  onManualFanChange,
  onPidConfigChange,
  onWsUrlChange,
  onTargetChange,
}: ControlPanelProps) {
  const [showPidSettings, setShowPidSettings] = useState(false)
  const [localWsUrl, setLocalWsUrl] = useState(wsUrl)

  const getPhaseInfo = () => {
    switch (phase) {
      case "roasting":
        return { label: "Roasting", color: "text-orange-500", bgColor: "bg-orange-500/20" }
      case "cooling":
        return { label: "Cooling", color: "text-blue-500", bgColor: "bg-blue-500/20" }
      case "finished":
        return { label: "Finished", color: "text-green-500", bgColor: "bg-green-500/20" }
      default:
        return { label: "Idle", color: "text-muted-foreground", bgColor: "bg-secondary" }
    }
  }

  const phaseInfo = getPhaseInfo()

  return (
    <div className="space-y-6">
      {/* Connection */}
      <div className="rounded-lg bg-card p-4">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-4">Connection</h3>
        <div className="space-y-3">
          <div>
            <Label htmlFor="ws-url" className="text-xs text-muted-foreground">
              WebSocket URL
            </Label>
            <Input
              id="ws-url"
              value={localWsUrl}
              onChange={(e) => setLocalWsUrl(e.target.value)}
              onBlur={() => onWsUrlChange(localWsUrl)}
              placeholder="ws://192.168.1.100:8080"
              className="mt-1 font-mono text-sm"
              disabled={isConnected}
            />
          </div>
          <Button
            onClick={isConnected ? onDisconnect : onConnect}
            variant={isConnected ? "destructive" : "default"}
            className="w-full"
          >
            {isConnected ? (
              <>
                <WifiOff className="mr-2 h-4 w-4" />
                Disconnect
              </>
            ) : (
              <>
                <Wifi className="mr-2 h-4 w-4" />
                Connect
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="rounded-lg bg-card p-4">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-4">Roast Phase</h3>
        <div className={`flex items-center justify-center gap-3 p-4 rounded-lg ${phaseInfo.bgColor}`}>
          {phase === "cooling" ? (
            <Wind className={`h-6 w-6 ${phaseInfo.color} animate-pulse`} />
          ) : phase === "roasting" ? (
            <Thermometer className={`h-6 w-6 ${phaseInfo.color}`} />
          ) : null}
          <span className={`text-lg font-semibold ${phaseInfo.color}`}>{phaseInfo.label}</span>
          {phase === "cooling" && currentTemperature !== undefined && (
            <span className="text-sm text-muted-foreground ml-2">({Math.round(currentTemperature)}°C → 40°C)</span>
          )}
        </div>
      </div>

      {/* Roast Target */}
      <div className="rounded-lg bg-card p-4">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-4">Roast Target</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="target-temp" className="text-xs text-muted-foreground">
              Target Temperature (°C)
            </Label>
            <Input
              id="target-temp"
              type="number"
              value={targetTemperature}
              onChange={(e) => onTargetChange(Number(e.target.value), targetTimeMinutes)}
              className="mt-1 font-mono"
              disabled={isRoasting || phase === "cooling"}
            />
          </div>
          <div>
            <Label htmlFor="target-time" className="text-xs text-muted-foreground">
              Target Time (minutes)
            </Label>
            <Input
              id="target-time"
              type="number"
              value={targetTimeMinutes}
              onChange={(e) => onTargetChange(targetTemperature, Number(e.target.value))}
              className="mt-1 font-mono"
              disabled={isRoasting || phase === "cooling"}
            />
          </div>
        </div>
      </div>

      {/* Control Mode */}
      <div className="rounded-lg bg-card p-4">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-4">Control Mode</h3>
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="font-medium">Automatic Control</p>
            <p className="text-xs text-muted-foreground">PID follows the curves automatically</p>
          </div>
          <Switch checked={isAutoMode} onCheckedChange={onAutoModeChange} disabled={phase === "cooling"} />
        </div>

        {!isAutoMode && phase !== "cooling" && (
          <div className="pt-4 border-t border-border space-y-4">
            <div>
              <div className="flex items-center gap-2">
                <Thermometer className="h-4 w-4 text-orange-500" />
                <Label className="text-xs text-muted-foreground">Manual Heater Power: {manualHeaterPower}%</Label>
              </div>
              <Slider
                value={[manualHeaterPower]}
                onValueChange={([value]) => onManualHeaterChange(value)}
                max={100}
                step={1}
                className="mt-2"
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <Wind className="h-4 w-4 text-blue-500" />
                <Label className="text-xs text-muted-foreground">Manual Fan Speed: {manualFanSpeed}%</Label>
              </div>
              <Slider
                value={[manualFanSpeed]}
                onValueChange={([value]) => onManualFanChange(value)}
                max={100}
                step={1}
                className="mt-2"
              />
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg bg-card p-4">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-4">Roast Control</h3>
        <div className="space-y-3">
          {phase === "idle" || phase === "finished" ? (
            <Button onClick={onStartRoast} variant="default" className="w-full h-12 text-lg" disabled={!isConnected}>
              <Play className="mr-2 h-5 w-5" />
              Start Roast
            </Button>
          ) : phase === "roasting" ? (
            <>
              <Button
                onClick={onStartCooling}
                variant="secondary"
                className="w-full h-12 text-lg bg-blue-600 hover:bg-blue-700 text-white"
              >
                <Wind className="mr-2 h-5 w-5" />
                Start Cooling
              </Button>
              <Button onClick={onStopRoast} variant="destructive" className="w-full">
                <Square className="mr-2 h-4 w-4" />
                Emergency Stop
              </Button>
            </>
          ) : phase === "cooling" ? (
            <>
              <Button
                onClick={onFinishRoast}
                variant="default"
                className="w-full h-12 text-lg bg-green-600 hover:bg-green-700"
              >
                Finish & Save Roast
              </Button>
              <Button onClick={onStopRoast} variant="destructive" className="w-full">
                <Square className="mr-2 h-4 w-4" />
                Emergency Stop
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {/* PID Settings */}
      <div className="rounded-lg bg-card p-4">
        <button
          onClick={() => setShowPidSettings(!showPidSettings)}
          className="w-full flex items-center justify-between"
        >
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">PID Settings</h3>
          <Settings
            className={`h-4 w-4 text-muted-foreground transition-transform ${showPidSettings ? "rotate-90" : ""}`}
          />
        </button>

        {showPidSettings && (
          <div className="mt-4 space-y-4">
            <div>
              <Label className="text-xs text-muted-foreground">Proportional (Kp): {pidConfig.kp.toFixed(2)}</Label>
              <Slider
                value={[pidConfig.kp]}
                onValueChange={([value]) => onPidConfigChange({ kp: value })}
                max={10}
                step={0.1}
                className="mt-2"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Integral (Ki): {pidConfig.ki.toFixed(2)}</Label>
              <Slider
                value={[pidConfig.ki]}
                onValueChange={([value]) => onPidConfigChange({ ki: value })}
                max={2}
                step={0.01}
                className="mt-2"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Derivative (Kd): {pidConfig.kd.toFixed(2)}</Label>
              <Slider
                value={[pidConfig.kd]}
                onValueChange={([value]) => onPidConfigChange({ kd: value })}
                max={5}
                step={0.01}
                className="mt-2"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
