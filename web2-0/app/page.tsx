"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { BezierCurveEditor } from "@/components/bezier-curve-editor"
import { FanCurveEditor } from "@/components/fan-curve-editor"
import { RealTimeChart } from "@/components/real-time-chart"
import { StatusDisplay } from "@/components/status-display"
import { ControlPanel } from "@/components/control-panel"
import { ProfilePanel } from "@/components/profile-panel"
import { RoastHistory } from "@/components/roast-history"
import { CoffeeInfoPanel } from "@/components/coffee-info-panel" // Import CoffeeInfoPanel
import { useWebSocket } from "@/hooks/use-websocket"
import { useRoasterState } from "@/hooks/use-roaster-state"
import { createDefaultProfile, createDefaultFanProfile } from "@/lib/bezier-utils"
import type { CurvePoint, FanCurvePoint, RoasterData, RoastProfile, CoffeeInfo } from "@/lib/types" // Import CoffeeInfo
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Coffee, LineChart, Sliders, History, Wind } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"

const DEFAULT_COFFEE_INFO: CoffeeInfo = {
  beanName: "",
  origin: "",
  producer: "", // Added producer field
  variety: "",
  process: "",
  weight: undefined,
  roastLevel: "",
  notes: "",
}

export default function RoasterControlPage() {
  const [wsUrl, setWsUrl] = useState("ws://localhost:8080")
  const [targetTemperature, setTargetTemperature] = useState(215)
  const [targetTimeMinutes, setTargetTimeMinutes] = useState(6)
  const [currentCurve, setCurrentCurve] = useState<CurvePoint[]>(() => createDefaultProfile(215, 6, { x: 0.4, y: 0.6 }))
  const [currentCurveControl, setCurrentCurveControl] = useState<{ x: number, y: number }>({ x: 0.4, y: 0.6 })
  const [currentData, setCurrentData] = useState<RoasterData | null>(null)
  const [currentFanCurve, setCurrentFanCurve] = useState<FanCurvePoint[]>(() => createDefaultFanProfile(30, 80, 6, { x: 0.5, y: 0.5 }))
  const [fanStartSpeed, setFanStartSpeed] = useState(30)
  const [fanEndSpeed, setFanEndSpeed] = useState(80)
  const [fanTargetControlPoint, setFanTargetControlPoint] = useState({ x: 0.5, y: 0.5 })
  const [coffeeInfo, setCoffeeInfoState] = useState<CoffeeInfo>(DEFAULT_COFFEE_INFO) // Add coffee info state

  const isInitializedRef = useRef(false)

  const {
    isRoasting,
    isAutoMode,
    elapsedTime,
    currentProfile,
    dataHistory,
    pidConfig,
    manualHeaterPower,
    manualFanSpeed,
    phase,
    completedRoasts,
    setIsAutoMode,
    setManualHeaterPower,
    setManualFanSpeed,
    setCoffeeInfo, // Get setCoffeeInfo from hook
    startRoast,
    stopRoast,
    startCoolingPhase,
    finishRoast,
    addDataPoint,
    calculateHeaterOutput,
    calculateFanOutput,
    isCoolingComplete,
    updateCurve,
    updateFanCurve,
    updatePidConfig,
    createProfile,
    setCurrentProfile,
    exportCompletedRoast,
    deleteCompletedRoast,
  } = useRoasterState()

  const handleCoffeeInfoChange = useCallback(
    (info: CoffeeInfo) => {
      setCoffeeInfoState(info)
      setCoffeeInfo(info)
    },
    [setCoffeeInfo],
  )

  const lastSentHeaterRef = useRef<number>(0)
  const lastSentFanRef = useRef<number>(0)

  const addDataPointRef = useRef(addDataPoint)
  const elapsedTimeRef = useRef(elapsedTime)

  useEffect(() => {
    addDataPointRef.current = addDataPoint
  }, [addDataPoint])

  useEffect(() => {
    elapsedTimeRef.current = elapsedTime
  }, [elapsedTime])

  const handleData = useCallback((data: RoasterData) => {
    console.log("[v0] Received data:", data)
    setCurrentData(data)
    addDataPointRef.current(data)
  }, [])

  const { isConnected, connectionStatus, connect, disconnect, sendHeaterCommand, sendFanCommand, startCooling } =
    useWebSocket({
      url: wsUrl,
      onData: handleData,
      pingInterval: 500,
    })

  useEffect(() => {
    if (isInitializedRef.current) return
    isInitializedRef.current = true

    const defaultCurve = createDefaultProfile(targetTemperature, targetTimeMinutes, currentCurveControl)
    const defaultFanCurve = createDefaultFanProfile(fanStartSpeed, fanEndSpeed, targetTimeMinutes, fanTargetControlPoint)
    console.log("creating default curves")
    createProfile(
      "Default Profile",
      targetTemperature,
      targetTimeMinutes * 60,
      defaultCurve,
      defaultFanCurve,
      fanStartSpeed,
      fanEndSpeed,
    )
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const createProfileRef = useRef(createProfile)
  useEffect(() => {
    createProfileRef.current = createProfile
  }, [createProfile])

  const handleTargetChange = useCallback(
    (temp: number, time: number) => {
      console.warn("changing target: ", temp, time)
      setTargetTemperature(temp)
      setTargetTimeMinutes(time)
      const newCurve = createDefaultProfile(temp, time, currentCurveControl)
      const newFanCurve = createDefaultFanProfile(fanStartSpeed, fanEndSpeed, time, fanTargetControlPoint)
      setCurrentCurve(newCurve)
      setCurrentFanCurve(newFanCurve)
      createProfileRef.current("Custom Profile", temp, time * 60, newCurve, newFanCurve, fanStartSpeed, fanEndSpeed)
    },
    [fanStartSpeed, fanEndSpeed],
  )

  const lastSentFanCurveRef = useRef<FanCurvePoint[]>([])

  const handleFanCurveChange = useCallback((curve: FanCurvePoint[], control: { x: number, y: number }) => {
    console.warn("fan curve chagne")
    setFanTargetControlPoint(control)
    setCurrentFanCurve(curve)
    updateFanCurveRef.current(curve)
  }, [])

  const handleFanTargetChange = useCallback(
    (start: number, end: number) => {
      setFanStartSpeed(start)
      setFanEndSpeed(end)
      const newFanCurve = createDefaultFanProfile(start, end, targetTimeMinutes, fanTargetControlPoint)
      setCurrentFanCurve(newFanCurve)
      handleFanCurveChange(newFanCurve, fanTargetControlPoint)
    },
    [targetTimeMinutes, handleFanCurveChange],
  )

  const updateCurveRef = useRef(updateCurve)
  useEffect(() => {
    updateCurveRef.current = updateCurve
  }, [updateCurve])

  const updateFanCurveRef = useRef(updateFanCurve)
  useEffect(() => {
    updateFanCurveRef.current = updateFanCurve
  }, [updateFanCurve])

  const handleCurveChange = useCallback((curve: CurvePoint[], control: { x: number, y: number }) => {
    console.warn("curve chagne")
    setCurrentCurveControl(control)
    setCurrentCurve(curve)
    updateCurveRef.current(curve)
  }, [])

  useEffect(() => {
    if (!isConnected || !currentData) return
    if (!isRoasting && phase !== "cooling") return

    const currentTemp = currentData.beanTemperature
    console.log("[v0] Processing temp for PID:", currentTemp, "Phase:", phase, "IsRoasting:", isRoasting)

    const heaterOutput = calculateHeaterOutput(currentTemp)
    console.log("[v0] Calculated heater output:", heaterOutput)
    if (Math.abs(heaterOutput - lastSentHeaterRef.current) > 1) {
      console.log("[v0] Sending heater command:", heaterOutput)
      sendHeaterCommand(heaterOutput)
      lastSentHeaterRef.current = heaterOutput
    }

    const fanOutput = calculateFanOutput(currentTemp)
    if (Math.abs(fanOutput - lastSentFanRef.current) > 1) {
      console.log("[v0] Sending fan command:", fanOutput)
      sendFanCommand(fanOutput)
      lastSentFanRef.current = fanOutput
    }

    if (isCoolingComplete(currentTemp)) {
      finishRoast(true)
    }
  }, [isRoasting, isConnected, currentData, phase, sendHeaterCommand, sendFanCommand, finishRoast])

  useEffect(() => {
    if (!isAutoMode && isConnected && phase !== "cooling") {
      sendHeaterCommand(manualHeaterPower)
    }
  }, [isAutoMode, manualHeaterPower, isConnected, sendHeaterCommand, phase])

  const handleStartCooling = useCallback(() => {
    startCooling()
    startCoolingPhase()
  }, [startCooling, startCoolingPhase])

  const handleFinishRoast = useCallback(() => {
    finishRoast(true)
  }, [finishRoast])

  const handleLoadProfile = useCallback(
    (profile: RoastProfile) => {
      setCurrentProfile(profile)
      setTargetTemperature(profile.targetTemperature)
      setTargetTimeMinutes(Math.round(profile.targetTime / 60))
      setCurrentCurve(profile.curve)
      if (profile.fanCurve) {
        setCurrentFanCurve(profile.fanCurve)
      }
      if (profile.fanStartSpeed !== undefined) {
        setFanStartSpeed(profile.fanStartSpeed)
      }
      if (profile.fanEndSpeed !== undefined) {
        setFanEndSpeed(profile.fanEndSpeed)
      }
      if (profile.coffeeInfo) {
        setCoffeeInfoState(profile.coffeeInfo)
      }
    },
    [setCurrentProfile, setCoffeeInfoState],
  )

  const handleSaveProfile = useCallback(
    (name: string) => {
      if (currentCurve.length > 0) {
        createProfileRef.current(
          name,
          targetTemperature,
          targetTimeMinutes * 60,
          currentCurve,
          currentFanCurve,
          fanStartSpeed,
          fanEndSpeed,
          coffeeInfo,
        )
      }
    },
    [currentCurve, currentFanCurve, targetTemperature, targetTimeMinutes, fanStartSpeed, fanEndSpeed, coffeeInfo],
  )

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Coffee className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-foreground">Roaster Control</h1>
                <p className="text-xs text-muted-foreground">Professional Coffee Roasting System</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${connectionStatus === "connected"
                  ? "bg-[hsl(var(--success))]/20 text-[hsl(var(--success))]"
                  : connectionStatus === "connecting"
                    ? "bg-[hsl(var(--warning))]/20 text-[hsl(var(--warning))]"
                    : "bg-secondary text-muted-foreground"
                  }`}
              >
                <div
                  className={`h-2 w-2 rounded-full ${connectionStatus === "connected"
                    ? "bg-[hsl(var(--success))] animate-pulse"
                    : connectionStatus === "connecting"
                      ? "bg-[hsl(var(--warning))] animate-pulse"
                      : "bg-muted-foreground"
                    }`}
                />
                <span className="capitalize">{connectionStatus}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="space-y-6">
            <StatusDisplay
              currentData={currentData}
              elapsedTime={elapsedTime}
              targetTemperature={targetTemperature}
              isConnected={isConnected}
              isRoasting={isRoasting || phase === "cooling"}
            />

            <Tabs defaultValue="editor" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="editor" className="flex items-center gap-2">
                  <Sliders className="h-4 w-4" />
                  <span className="hidden sm:inline">Temp Curve</span>
                  <span className="sm:hidden">Temp</span>
                </TabsTrigger>
                <TabsTrigger value="fan" className="flex items-center gap-2">
                  <Wind className="h-4 w-4" />
                  <span className="hidden sm:inline">Fan Curve</span>
                  <span className="sm:hidden">Fan</span>
                </TabsTrigger>
                <TabsTrigger value="realtime" className="flex items-center gap-2">
                  <LineChart className="h-4 w-4" />
                  <span className="hidden sm:inline">Real-time</span>
                  <span className="sm:hidden">Live</span>
                </TabsTrigger>
                <TabsTrigger value="history" className="flex items-center gap-2">
                  <History className="h-4 w-4" />
                  <span className="hidden sm:inline">History</span>
                  <span className="sm:hidden">Hist</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="editor" className="mt-4">
                <div className="rounded-lg bg-card p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                      Temperature Profile Curve
                    </h2>
                    <span className="text-xs text-muted-foreground font-mono">
                      {targetTemperature}°C in {targetTimeMinutes} min
                    </span>
                  </div>
                  <BezierCurveEditor
                    targetTemperature={targetTemperature}
                    targetTimeMinutes={targetTimeMinutes}
                    targetControl={currentCurveControl}
                    onCurveChange={handleCurveChange}
                    currentTime={elapsedTime}
                    actualTemperature={currentData?.beanTemperature}
                  />
                </div>
              </TabsContent>

              <TabsContent value="fan" className="mt-4">
                <div className="rounded-lg bg-card p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                      Fan Speed Profile Curve
                    </h2>
                    <span className="text-xs text-muted-foreground">
                      {fanStartSpeed}% → {fanEndSpeed}%
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="space-y-2">
                      <Label htmlFor="fanStart" className="text-xs text-muted-foreground">
                        Start Fan Speed (%)
                      </Label>
                      <Input
                        id="fanStart"
                        type="number"
                        min={0}
                        max={100}
                        value={fanStartSpeed}
                        onChange={(e) => handleFanTargetChange(Number(e.target.value), fanEndSpeed)}
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="fanEnd" className="text-xs text-muted-foreground">
                        End Fan Speed (%)
                      </Label>
                      <Input
                        id="fanEnd"
                        type="number"
                        min={0}
                        max={100}
                        value={fanEndSpeed}
                        onChange={(e) => handleFanTargetChange(fanStartSpeed, Number(e.target.value))}
                        className="h-9"
                      />
                    </div>
                  </div>
                  <FanCurveEditor
                    startFanSpeed={fanStartSpeed}
                    endFanSpeed={fanEndSpeed}
                    targetControlPoint={fanTargetControlPoint}
                    targetTimeMinutes={targetTimeMinutes}
                    onCurveChange={handleFanCurveChange}
                    currentTime={elapsedTime}
                    actualFanSpeed={currentData?.fanSpeed}
                  />
                </div>
              </TabsContent>

              <TabsContent value="realtime" className="mt-4">
                <div className="rounded-lg bg-card p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                      Live Temperature Data
                    </h2>
                    <span className="text-xs text-muted-foreground">{dataHistory.length} data points</span>
                  </div>
                  <RealTimeChart
                    dataHistory={dataHistory}
                    targetCurve={currentCurve}
                    fanCurve={currentFanCurve}
                    totalTimeSeconds={targetTimeMinutes * 60}
                    maxTemperature={targetTemperature}
                    currentTime={elapsedTime}
                  />
                </div>
              </TabsContent>

              <TabsContent value="history" className="mt-4">
                <RoastHistory
                  completedRoasts={completedRoasts}
                  onExport={exportCompletedRoast}
                  onDelete={deleteCompletedRoast}
                />
              </TabsContent>
            </Tabs>

            <CoffeeInfoPanel
              coffeeInfo={coffeeInfo}
              onChange={handleCoffeeInfoChange}
              disabled={isRoasting || phase === "cooling"}
            />

            <div className="lg:hidden">
              <ProfilePanel
                currentProfile={currentProfile}
                onSaveProfile={handleSaveProfile}
                onLoadProfile={handleLoadProfile}
              />
            </div>
          </div>

          <div className="space-y-6">
            <ControlPanel
              isConnected={isConnected}
              isRoasting={isRoasting}
              isAutoMode={isAutoMode}
              manualHeaterPower={manualHeaterPower}
              manualFanSpeed={manualFanSpeed}
              pidConfig={pidConfig}
              wsUrl={wsUrl}
              targetTemperature={targetTemperature}
              targetTimeMinutes={targetTimeMinutes}
              phase={phase}
              currentTemperature={currentData?.beanTemperature}
              onConnect={connect}
              onDisconnect={disconnect}
              onStartRoast={startRoast}
              onStopRoast={stopRoast}
              onStartCooling={handleStartCooling}
              onFinishRoast={handleFinishRoast}
              onAutoModeChange={setIsAutoMode}
              onManualHeaterChange={setManualHeaterPower}
              onManualFanChange={setManualFanSpeed}
              onPidConfigChange={updatePidConfig}
              onWsUrlChange={setWsUrl}
              onTargetChange={handleTargetChange}
            />

            <div className="hidden lg:block">
              <ProfilePanel
                currentProfile={currentProfile}
                onSaveProfile={handleSaveProfile}
                onLoadProfile={handleLoadProfile}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
