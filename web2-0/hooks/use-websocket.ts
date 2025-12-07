"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { RoasterData, YaegerCommand } from "@/lib/types"

interface UseWebSocketOptions {
  url: string
  onData?: (data: RoasterData) => void
  onError?: (error: Error) => void
  reconnectAttempts?: number
  reconnectInterval?: number
  pingInterval?: number // Added ping interval option
}

export function useWebSocket({
  url,
  onData,
  onError,
  reconnectAttempts = 5,
  reconnectInterval = 3000,
  pingInterval = 500, // Default 500ms ping interval
}: UseWebSocketOptions) {
  const [isConnected, setIsConnected] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<"disconnected" | "connecting" | "connected" | "error">(
    "disconnected",
  )
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectCountRef = useRef(0)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null) // Ping interval ref
  const commandIdRef = useRef(1) // Command ID counter

  const commandQueueRef = useRef<YaegerCommand[]>([])
  const lastCommandTimeRef = useRef(0)
  const commandThrottleRef = useRef<NodeJS.Timeout | null>(null)
  const COMMAND_THROTTLE_MS = 300

  const onDataRef = useRef(onData)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    onDataRef.current = onData
    onErrorRef.current = onError
  }, [onData, onError])

  const sendPing = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const command: YaegerCommand = {
        id: commandIdRef.current++,
        command: "getData",
      }
      queueCommand(command)
    }
  }, [])

  const startPinging = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current)
    }
    pingIntervalRef.current = setInterval(sendPing, pingInterval)
    // Send first ping immediately
    sendPing()
  }, [pingInterval])

  const stopPinging = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current)
      pingIntervalRef.current = null
    }
  }, [])

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    setConnectionStatus("connecting")

    try {
      const ws = new WebSocket(url)

      ws.onopen = () => {
        setIsConnected(true)
        setConnectionStatus("connected")
        reconnectCountRef.current = 0
        startPinging() // Start pinging when connected
      }

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)

          console.log("[v0] Raw WebSocket message:", event.data)
          console.log("[v0] Parsed message:", message)

          const yaegerData = message.data

          if (!yaegerData) {
            console.log("[v0] No data property in message, skipping")
            return
          }

          console.log("[v0] Yaeger data:", yaegerData)
          console.log("[v0] BT value:", yaegerData.BT, "ET value:", yaegerData.ET)

          // Convert Yaeger format to internal RoasterData format
          const roasterData: RoasterData = {
            timestamp: Date.now(),
            beanTemperature: yaegerData.BT,
            drumTemperature: yaegerData.ET,
            ambientTemperature: yaegerData.Amb,
            heaterPower: yaegerData.BurnerVal,
            fanSpeed: yaegerData.FanVal,
          }

          console.log("[v0] Converted roasterData:", roasterData)

          onDataRef.current?.(roasterData)
        } catch (e) {
          console.error("Failed to parse WebSocket message:", e)
        }
      }

      ws.onerror = () => {
        setConnectionStatus("error")
        onErrorRef.current?.(new Error("WebSocket connection error"))
      }

      ws.onclose = () => {
        setIsConnected(false)
        setConnectionStatus("disconnected")
        wsRef.current = null
        stopPinging() // Stop pinging when disconnected

        // Attempt reconnection
        if (reconnectCountRef.current < reconnectAttempts) {
          reconnectCountRef.current++
          reconnectTimeoutRef.current = setTimeout(connect, reconnectInterval)
        }
      }

      wsRef.current = ws
    } catch (e) {
      setConnectionStatus("error")
      onErrorRef.current?.(e instanceof Error ? e : new Error("Failed to connect"))
    }
  }, [url, reconnectAttempts, reconnectInterval, startPinging, stopPinging])

  const disconnect = useCallback(() => {
    stopPinging() // Stop pinging
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
    }
    if (commandThrottleRef.current) {
      clearTimeout(commandThrottleRef.current)
    }
    wsRef.current?.close()
    wsRef.current = null
    setIsConnected(false)
    setConnectionStatus("disconnected")
    reconnectCountRef.current = reconnectAttempts // Prevent auto-reconnect
  }, [reconnectAttempts, stopPinging])

  const processCommandQueue = useCallback(() => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return
    if (commandQueueRef.current.length === 0) return

    const now = Date.now()
    const timeSinceLastCommand = now - lastCommandTimeRef.current

    if (timeSinceLastCommand >= COMMAND_THROTTLE_MS) {
      // Send the next command in queue
      const command = commandQueueRef.current.shift()
      if (command) {
        wsRef.current.send(JSON.stringify(command))
        lastCommandTimeRef.current = now
      }

      // If more commands in queue, schedule next processing
      if (commandQueueRef.current.length > 0) {
        commandThrottleRef.current = setTimeout(processCommandQueue, COMMAND_THROTTLE_MS)
      }
    } else {
      // Schedule processing for when throttle period ends
      const delay = COMMAND_THROTTLE_MS - timeSinceLastCommand
      commandThrottleRef.current = setTimeout(processCommandQueue, delay)
    }
  }, [])

  const queueCommand = useCallback(
    (command: YaegerCommand) => {
      // For getData pings, replace any existing getData in queue to avoid buildup
      if (command.command === "getData") {
        commandQueueRef.current = commandQueueRef.current.filter((c) => c.command !== "getData")
      }

      // For heater/fan commands, replace existing same-type commands with latest value
      if (command.command === "setBurner" || command.command === "setFan") {
        commandQueueRef.current = commandQueueRef.current.filter((c) => c.command !== command.command)
      }

      commandQueueRef.current.push(command)
      processCommandQueue()
    },
    [processCommandQueue],
  )

  const sendCommand = useCallback(
    (command: YaegerCommand["command"], value?: number) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const message: YaegerCommand = {
          id: commandIdRef.current++,
          command,
          ...(value !== undefined && { value }),
        }
        queueCommand(message)
      }
    },
    [queueCommand],
  )

  const sendHeaterCommand = useCallback(
    (power: number) => {
      sendCommand("setBurner", Math.max(0, Math.min(100, Math.round(power))))
    },
    [sendCommand],
  )

  const sendFanCommand = useCallback(
    (speed: number) => {
      sendCommand("setFan", Math.max(0, Math.min(100, Math.round(speed))))
    },
    [sendCommand],
  )

  const startCooling = useCallback(() => {
    sendCommand("startCooling")
  }, [sendCommand])

  useEffect(() => {
    return () => {
      stopPinging()
      if (commandThrottleRef.current) {
        clearTimeout(commandThrottleRef.current)
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      wsRef.current?.close()
    }
  }, [stopPinging])

  return {
    isConnected,
    connectionStatus,
    connect,
    disconnect,
    sendCommand,
    sendHeaterCommand,
    sendFanCommand,
    startCooling, // Expose cooling command
  }
}
