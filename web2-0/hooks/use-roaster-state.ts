"use client"

import { useCallback, useRef, useState } from "react"
import type {
  CurvePoint,
  FanCurvePoint,
  PIDConfig,
  RoasterData,
  RoastProfile,
  RoastPhase,
  CompletedRoast,
  CoffeeInfo,
} from "@/lib/types"
import { PIDController } from "@/lib/pid-controller"
import { getTargetTemperature, getTargetFanSpeed } from "@/lib/bezier-utils"
import { v4 as uuidv4 } from 'uuid';

const DEFAULT_PID_CONFIG: PIDConfig = {
  kp: 1.0,
  ki: 0.1,
  kd: 0.01,
  outputMin: 0,
  outputMax: 100,
}

const COOLING_TARGET_TEMP = 40 // Target temp to end cooling
const COOLING_FAN_SPEED = 100 // Full fan during cooling

let currentCoffeeInfoRef: CoffeeInfo | null = null

export function useRoasterState() {
  const [isRoasting, setIsRoasting] = useState(false)
  const [isAutoMode, setIsAutoMode] = useState(true)
  const [elapsedTime, setElapsedTime] = useState(0)
  const [currentProfile, setCurrentProfile] = useState<RoastProfile | null>(null)
  const [dataHistory, setDataHistory] = useState<RoasterData[]>([])
  const [pidConfig, setPidConfig] = useState<PIDConfig>(DEFAULT_PID_CONFIG)
  const [manualHeaterPower, setManualHeaterPower] = useState(0)
  const [manualFanSpeed, setManualFanSpeed] = useState(50)
  const [phase, setPhase] = useState<RoastPhase>("idle")
  const [completedRoasts, setCompletedRoasts] = useState<CompletedRoast[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("completed-roasts")
      return saved ? JSON.parse(saved) : []
    }
    return []
  })

  const pidControllerRef = useRef(new PIDController(DEFAULT_PID_CONFIG))
  const startTimeRef = useRef<number | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const roastStartTimeRef = useRef<number | null>(null)
  const elapsedTimeRef = useRef(0)

  const startRoast = useCallback(() => {
    if (!currentProfile) return

    setIsRoasting(true)
    setPhase("roasting")
    setElapsedTime(0)
    elapsedTimeRef.current = 0
    setDataHistory([])
    pidControllerRef.current.reset()
    startTimeRef.current = Date.now()
    roastStartTimeRef.current = Date.now()

    timerRef.current = setInterval(() => {
      if (startTimeRef.current) {
        const newElapsed = Math.floor((Date.now() - startTimeRef.current) / 1000)
        setElapsedTime(newElapsed)
        elapsedTimeRef.current = newElapsed
      }
    }, 100)
  }, [currentProfile])

  const startCoolingPhase = useCallback(() => {
    setPhase("cooling")
    pidControllerRef.current.reset()
  }, [])

  const completeRoast = useCallback(() => {
    if (!currentProfile || !roastStartTimeRef.current) return null

    const maxTemp = Math.max(...dataHistory.map((d) => d.beanTemperature), 0)

    const completedRoast: CompletedRoast = {
      id: uuidv4(),
      profileName: currentProfile.name,
      profileId: currentProfile.id,
      startTime: roastStartTimeRef.current,
      endTime: Date.now(),
      targetTemperature: currentProfile.targetTemperature,
      targetTime: currentProfile.targetTime,
      maxBeanTemperature: maxTemp,
      totalDuration: elapsedTime,
      dataHistory: [...dataHistory],
      curve: [...currentProfile.curve],
      fanCurve: currentProfile.fanCurve ? [...currentProfile.fanCurve] : undefined,
      coffeeInfo: currentCoffeeInfoRef || undefined, // Include coffee info in completed roast
    }

    const newCompletedRoasts = [completedRoast, ...completedRoasts].slice(0, 50)
    setCompletedRoasts(newCompletedRoasts)
    localStorage.setItem("completed-roasts", JSON.stringify(newCompletedRoasts))

    return completedRoast
  }, [currentProfile, dataHistory, elapsedTime, completedRoasts])

  const stopRoast = useCallback(() => {
    setIsRoasting(false)
    setPhase("idle")
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    startTimeRef.current = null
  }, [])

  const finishRoast = useCallback(
    (saveRoast = true) => {
      let savedRoast: CompletedRoast | null = null

      if (saveRoast && phase !== "idle") {
        savedRoast = completeRoast()
      }

      setPhase("finished")
      setIsRoasting(false)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      startTimeRef.current = null
      roastStartTimeRef.current = null

      return savedRoast
    },
    [phase, completeRoast],
  )

  const addDataPoint = useCallback((data: RoasterData) => {
    setDataHistory((prev) => {
      const newHistory = [...prev, { ...data, timestamp: elapsedTimeRef.current }]
      return newHistory.slice(-2000)
    })
  }, [])

  const currentProfileRef = useRef(currentProfile)
  currentProfileRef.current = currentProfile

  const calculateHeaterOutput = useCallback(
    (currentTemp: number): number => {
      if (!isAutoMode) return manualHeaterPower
      if (phase === "cooling") return 0

      const profile = currentProfileRef.current
      if (!profile || !isRoasting) return 0

      const targetTemp = getTargetTemperature(profile.curve, elapsedTimeRef.current)
      return pidControllerRef.current.update(targetTemp, currentTemp, Date.now())
    },
    [isAutoMode, manualHeaterPower, isRoasting, phase],
  )

  const calculateFanOutput = useCallback(
    (_currentTemp: number): number => {
      if (phase === "cooling") {
        return COOLING_FAN_SPEED
      }

      if (!isAutoMode) return manualFanSpeed

      const profile = currentProfileRef.current
      if (!profile || !isRoasting) return manualFanSpeed

      if (profile.fanCurve && profile.fanCurve.length > 0) {
        return getTargetFanSpeed(profile.fanCurve, elapsedTimeRef.current)
      }

      return manualFanSpeed
    },
    [phase, isAutoMode, manualFanSpeed, isRoasting],
  )

  const isCoolingComplete = useCallback(
    (currentTemp: number): boolean => {
      return phase === "cooling" && currentTemp <= COOLING_TARGET_TEMP
    },
    [phase],
  )

  const updateCurve = useCallback(
    (newCurve: CurvePoint[]) => {
      if (currentProfile) {
        setCurrentProfile({
          ...currentProfile,
          curve: newCurve,
        })
      }
    },
    [currentProfile],
  )

  const updateFanCurve = useCallback(
    (newFanCurve: FanCurvePoint[]) => {
      if (currentProfile) {
        setCurrentProfile({
          ...currentProfile,
          fanCurve: newFanCurve,
        })
      }
    },
    [currentProfile],
  )

  const updatePidConfig = useCallback(
    (config: Partial<PIDConfig>) => {
      const newConfig = { ...pidConfig, ...config }
      setPidConfig(newConfig)
      pidControllerRef.current.setTunings(newConfig.kp, newConfig.ki, newConfig.kd)
    },
    [pidConfig],
  )

  const createProfile = useCallback(
    (
      name: string,
      targetTemp: number,
      targetTime: number,
      curve: CurvePoint[],
      fanCurve?: FanCurvePoint[],
      fanStartSpeed?: number,
      fanEndSpeed?: number,
    ) => {
      const profile: RoastProfile = {
        id: uuidv4(),
        name,
        targetTemperature: targetTemp,
        targetTime,
        curve,
        fanCurve,
        fanStartSpeed,
        fanEndSpeed,
        createdAt: Date.now(),
      }
      setCurrentProfile(profile)
      return profile
    },
    [],
  )

  const exportCompletedRoast = useCallback((roast: CompletedRoast) => {
    const dataStr = JSON.stringify(roast, null, 2)
    const blob = new Blob([dataStr], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `roast-${roast.profileName.replace(/\s+/g, "-").toLowerCase()}-${new Date(roast.startTime).toISOString().split("T")[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  const deleteCompletedRoast = useCallback(
    (id: string) => {
      const newRoasts = completedRoasts.filter((r) => r.id !== id)
      setCompletedRoasts(newRoasts)
      localStorage.setItem("completed-roasts", JSON.stringify(newRoasts))
    },
    [completedRoasts],
  )

  const setCoffeeInfo = useCallback((info: CoffeeInfo) => {
    currentCoffeeInfoRef = info
  }, [])

  return {
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
    setCoffeeInfo, // Export setCoffeeInfo
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
  }
}
