import van from "vanjs-core";
import { YaegerMessage } from "./model.ts";

// ============================================================================
// WebSocket transport with auto-reconnect.
//
// Architecture goal: the firmware owns the roast (profile execution, PID).
// The webapp is a *display* that issues occasional commands.  If the link
// is down when a user action fires, the command is dropped — the next
// periodic getData / status message will pull the operator's UI back
// in line with firmware truth within ~1s of reconnect.
// ============================================================================

export const connectionStatus = van.state("Disconnected");
export const lastMessage = van.state<YaegerMessage | null>(null);
export const lastUpdate = van.state<Date | null>(null);

// Fires once each time we successfully (re)connect.  Subscribers (e.g.
// roast.ts) use this to re-fetch state.
export const reconnectTick = van.state(0);

let socket: WebSocket | null = null;
let reconnectDelayMs = 500;
const MAX_RECONNECT_DELAY_MS = 5000;
let periodicTimer: ReturnType<typeof setInterval> | null = null;

function rawSend(ws: WebSocket, msg: object): boolean {
  try {
    ws.send(JSON.stringify(msg));
    return true;
  } catch (e) {
    console.error("WS send failed:", e);
    return false;
  }
}

// Public API.  Sends immediately if connected, otherwise silently drops.
// Callers should assume commands may not arrive; the periodic getData
// round-trip reconciles state within ~1s on reconnect.
export function sendCommand(msg: Record<string, unknown>) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    rawSend(socket, msg);
  }
}

function startPeriodicMessages(intervalMs: number) {
  if (periodicTimer != null) clearInterval(periodicTimer);
  periodicTimer = setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      rawSend(socket, { id: 1, command: "getData" });
    }
  }, intervalMs);
}

function connect() {
  connectionStatus.val = socket == null ? "Connecting" : "Reconnecting…";
  const url = "ws://" + location.host + "/ws";
  const ws = new WebSocket(url);
  socket = ws;

  ws.onopen = () => {
    console.log("WebSocket connected");
    connectionStatus.val = "Connected";
    reconnectDelayMs = 500;

    rawSend(ws, { id: 1, command: "getPreferences" });

    // Notify subscribers (so they can re-fetch state).
    reconnectTick.val = reconnectTick.val + 1;

    startPeriodicMessages(1000);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      const message = data.data as YaegerMessage | undefined;
      if (message != undefined) {
        lastMessage.val = message;
        lastUpdate.val = new Date();
      }
    } catch (e) {
      console.error("WS parse error:", e);
    }
  };

  ws.onclose = () => {
    console.log("WebSocket closed");
    if (socket === ws) socket = null;
    if (connectionStatus.val !== "Error") {
      connectionStatus.val = "Disconnected";
    }
    if (periodicTimer != null) {
      clearInterval(periodicTimer);
      periodicTimer = null;
    }
    scheduleReconnect();
  };

  ws.onerror = (e) => {
    console.error("WebSocket error:", e);
    connectionStatus.val = "Error";
    // onclose will fire after this, which schedules the reconnect.
  };
}

function scheduleReconnect() {
  const delay = reconnectDelayMs;
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
  setTimeout(connect, delay);
}

// Kick it off
connect();
