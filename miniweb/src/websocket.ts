import van from "vanjs-core";
import { YaegerMessage } from "./model.ts";

// ============================================================================
// WebSocket transport with auto-reconnect + command queue.
//
// Architecture goal: the firmware owns the roast (profile execution, PID,
// history buffer). The webapp is a *display* that issues occasional
// commands. When the link drops we keep buffering user commands and
// drain them on reconnect. "allOff" is special: it goes to the front of
// the queue so it lands first.
// ============================================================================

export const connectionStatus = van.state("Disconnected");
export const lastMessage = van.state<YaegerMessage | null>(null);
export const lastUpdate = van.state<Date | null>(null);
export const pendingCommandCount = van.state(0);

// Fires once each time we successfully (re)connect.  Subscribers (e.g.
// roast.ts) use this to re-fetch state and history.
export const reconnectTick = van.state(0);

type QueuedCommand = { payload: Record<string, unknown>; priority: boolean };

let socket: WebSocket | null = null;
let reconnectDelayMs = 500;
const MAX_RECONNECT_DELAY_MS = 5000;
let pending: QueuedCommand[] = [];
let periodicTimer: ReturnType<typeof setInterval> | null = null;

function bumpPendingCount() {
  pendingCommandCount.val = pending.length;
}

function rawSend(ws: WebSocket, msg: object): boolean {
  try {
    ws.send(JSON.stringify(msg));
    return true;
  } catch (e) {
    console.error("WS send failed:", e);
    return false;
  }
}

function flushQueue(ws: WebSocket) {
  while (pending.length > 0) {
    const next = pending.shift()!;
    if (!rawSend(ws, next.payload)) {
      // Put it back if send failed; bail.
      pending.unshift(next);
      break;
    }
  }
  bumpPendingCount();
}

// Public API — replaces the previous direct `socket.send(...)` calls.
// Sends immediately if connected, otherwise queues.
export function sendCommand(msg: Record<string, unknown>) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    rawSend(socket, msg);
    return;
  }

  const isAllOff = msg.command === "allOff";
  if (isAllOff) {
    // Always at the front: safety command should fire ASAP on reconnect.
    pending = pending.filter((c) => c.payload.command !== "allOff");
    pending.unshift({ payload: msg, priority: true });
  } else {
    // Coalesce same-command-name entries (e.g., repeated Setpoint nudges
    // collapse to the latest value). Skip dedup if msg has no `command`
    // field (raw setpoint/fanval style — those also dedupe by field key).
    const cmd = msg.command as string | undefined;
    if (cmd) {
      pending = pending.filter((c) => c.payload.command !== cmd);
    } else {
      // Field-based dedup for the legacy direct-field protocol.
      const fieldKeys = ["Setpoint", "FanVal", "BurnerVal", "Mode", "Target"];
      const fieldsInMsg = fieldKeys.filter((k) => k in msg);
      if (fieldsInMsg.length > 0) {
        pending = pending.filter((c) => {
          // Drop entries that set only the same fields and no others.
          const payloadKeys = Object.keys(c.payload).filter((k) => k !== "id");
          return !payloadKeys.every((k) => fieldsInMsg.includes(k));
        });
      }
    }
    pending.push({ payload: msg, priority: false });
  }
  bumpPendingCount();
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

    // Initial state fetch on every (re)connect.
    rawSend(ws, { id: 1, command: "getPreferences" });
    rawSend(ws, { id: 1, command: "getRoastState" });

    // Notify subscribers (so they can fetch history etc).
    reconnectTick.val = reconnectTick.val + 1;

    // Send anything that was queued while we were offline.
    flushQueue(ws);

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
