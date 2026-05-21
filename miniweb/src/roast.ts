import "./style.css";
import van from "vanjs-core";
import { initializeChart, updateChart, updateProfileLines, highlightTime } from "./chart";
import {
  YaegerState,
  Measurement,
  RoasterStatus,
  RoastState,
} from "./model.ts";
import { getFormattedTimeDifference } from "./util.ts";
import {
  followProfile,
  followProfileEnabled,
  profile,
  ProfileControl,
  ProfileEditor,
  selectedPointTime,
} from "./profiling.ts";
import { socket, lastMessage, lastUpdate, connectionStatus } from "./websocket";

const { label, button, div, input, span, h1, details, summary, header } = van.tags;

// State variables
const slider1Value = van.state(50);
const slider2Value = van.state(50);
const state = van.state(new YaegerState());

const setpoint = van.state(20);
const pidPFactor = van.state(1.0);
const pidIFactor = van.state(0.1);
const pidDFactor = van.state(0.01);

// Saved roasts storage
interface SavedRoast {
  name: string;
  size: number;
}
const savedRoasts = van.state<SavedRoast[]>([]);

// Dashboard state
const currentROR = van.state<number | null>(null);
const currentMode = van.state<"Manual" | "PID">("Manual");
const currentTarget = van.state<"BT" | "ET">("BT");
const fanOffset = van.state(0);
const cooldownFanSpeed = van.state(50);
const roastName = van.state("");
const fanMode = van.state<"pwm" | "ssr">("pwm");
const fanModeChanged = van.state(false);  // shows reboot-needed notice when toggled
const wifiSSID = van.state("");
const wifiPass = van.state("");
const wifiMessage = van.state("");

// ECharts setup
const chartElement = div({ id: "liveChart" });
const chart = initializeChart(chartElement);

// Redraw planned-profile lines whenever a profile is loaded/cleared
van.derive(() => {
  updateProfileLines(chart, profile.val);
});

// Move the chart's crosshair + tooltip to the selected profile point.
van.derive(() => {
  highlightTime(chart, selectedPointTime.val);
});

// Add a derived state for current message
const currentMessage = van.derive(() => {
  console.log("currentMessage derived state updated:", lastMessage.val);
  return lastMessage.val;
});
const currentUpdate = van.derive(() => {
  console.log("currentUpdate derived state updated:", lastUpdate.val);
  return lastUpdate.val;
});

// Reactive effect to handle state updates from lastMessage and lastUpdate
van.derive(() => {
  console.log("Reactive effect triggered");
  const message = currentMessage.val;
  const timestamp = currentUpdate.val;
  
  console.log("Current state:", {
    message,
    timestamp,
    slider1Value: slider1Value.val,
    slider2Value: slider2Value.val,
    state: state.val
  });
  
  if (message != undefined && timestamp != null) {
    // Preferences response: just absorb the values, don't run status-update logic
    if (message.type === "preferences") {
      if (typeof message.pidKp === "number") { pidPFactor.val = message.pidKp; tempP = message.pidKp; }
      if (typeof message.pidKi === "number") { pidIFactor.val = message.pidKi; tempI = message.pidKi; }
      if (typeof message.pidKd === "number") { pidDFactor.val = message.pidKd; tempD = message.pidKd; }
      if (typeof message.cooldownFanSpeed === "number") {
        cooldownFanSpeed.val = message.cooldownFanSpeed;
        tempCooldownFan = message.cooldownFanSpeed;
      }
      if (message.fanMode === "pwm" || message.fanMode === "ssr") {
        fanMode.val = message.fanMode;
        // Server is source of truth on boot; clear the "reboot needed" flag.
        fanModeChanged.val = false;
      }
      return;
    }

    console.log("Processing new message:", message);

    // Update UI elements directly
    console.log("Updating sliders:", {
      fan: message.FanVal,
      heater: message.BurnerVal
    });
    slider1Value.val = message.FanVal;
    slider2Value.val = message.BurnerVal;

    // Sync mode/target/setpoint from firmware
    if (message.Mode === "PID" || message.Mode === "Auto") currentMode.val = "PID";
    else if (message.Mode === "Manual") currentMode.val = "Manual";
    if (message.Target === "BT" || message.Target === "ET") currentTarget.val = message.Target;
    if (typeof message.Setpoint === "number") setpoint.val = message.Setpoint;

    // Create a new state object to ensure reactivity
    const newState = {
      ...state.val,
      currentState: {
        ...state.val.currentState,
        lastMessage: message,
        lastUpdate: timestamp,
      },
    };

    console.log("New state object created:", newState);

    if (
      state.val.roast != null &&
      (state.val.currentState.status == RoasterStatus.roasting || state.val.roast.measurements.length > 0)
    ) {
      console.log("Processing roast state update");
      const newMeasurement: [Measurement] = [
        {
          timestamp: timestamp,
          message: message,
          extra: {
            setpoint: setpoint.val,
            pidData: {
              enabled: currentMode.val === "PID",
              kp: pidPFactor.val,
              ki: pidIFactor.val,
              kd: pidDFactor.val,
            },
          },
        },
      ];

      // Update roast state with new measurement
      newState.roast = {
        ...state.val.roast,
        measurements: [...state.val.roast.measurements, ...newMeasurement],
      };

      // Compute current ROR from last 30s of BT history
      const meas = newState.roast.measurements;
      if (meas.length >= 5) {
        const last = meas[meas.length - 1];
        const cutoffMs = last.timestamp.getTime() - 30_000;
        let firstIdx = meas.findIndex((m) => m.timestamp.getTime() >= cutoffMs);
        if (firstIdx < 0) firstIdx = 0;
        const first = meas[firstIdx];
        const dt = (last.timestamp.getTime() - first.timestamp.getTime()) / 1000;
        const dT = last.message.BT - first.message.BT;
        currentROR.val = dt > 0 ? (dT / dt) * 60 : null;
      }

      console.log("Updated roast state:", newState.roast);

      // Update chart with new data
      updateChart(chart, newState.roast);

      // Check profile following
      if (
        state.val.profile != undefined &&
        followProfileEnabled.val == true
      ) {
        const profileUpdate = followProfile(
          state.val.profile!,
          newState.roast,
        );
        if (profileUpdate != undefined) {
          console.log("Updating setpoint from profile:", profileUpdate.setPoint);
          setpoint.val = profileUpdate.setPoint;
          // Push the new setpoint to firmware so the PID has something to
          // track. Without this, fan would follow the profile (because
          // updateFanPower below sends FanVal) but the heater would stay at
          // 0 because firmware's setpoint never moves off its initial 0.
          sendCommand({ id: 1, Setpoint: profileUpdate.setPoint });
          if (profileUpdate.fanValue != undefined) {
            const adjusted = Math.max(
              0,
              Math.min(100, profileUpdate.fanValue + fanOffset.val),
            );
            slider1Value.val = adjusted;
            updateFanPower(adjusted);
          }
        }
      }
    }

    // Update state atomically
    console.log("Applying state update");
    state.val = newState;
    console.log("State updated:", state.val);
  }
});

export function updateFanPower(value: number) {
  sendCommand({ id: 1, FanVal: value });
  appendCommand("fan", value);
}

export function updateHeaterPower(value: number) {
  sendCommand({ id: 1, BurnerVal: value });
  appendCommand("heater", value);
}

function appendCommand(label: "fan" | "heater", value: number) {
  if (state.val.currentState.status == RoasterStatus.idle) {
    return;
  }
  const roast = state.val.roast;
  if (!roast) return;
  
  state.val = {
    ...state.val,
    roast: {
      ...roast,
      startDate: roast.startDate,
      commands: [
        ...(roast.commands || []),
        {
          type: label,
          value: value,
          timestamp: new Date(),
        },
      ],
    },
  };
}

function appendEvent(label: string) {
  if (state.val.currentState.status == RoasterStatus.idle) {
    return;
  }
  const roast = state.val.roast;
  if (!roast) return;

  const lastMessage = state.val.currentState.lastMessage;
  const lastUpdate = state.val.currentState.lastUpdate;
  if (!lastMessage || !lastUpdate) return;

  state.val = {
    ...state.val,
    roast: {
      ...roast,
      startDate: roast.startDate,
      events: [
        ...(roast.events || []),
        {
          label: label,
          measurement: {
            message: lastMessage,
            timestamp: lastUpdate,
          },
        },
      ],
    },
  };
}

function sendCommand(data: any) {
  let msg = JSON.stringify(data);
  console.log("sending command: ", msg);
  socket?.send(msg);
}

var DownloadButton = () => {
  const shouldShowButton = van.derive(() => {
    return (state.val.roast?.measurements.length ?? 0) === 0;
  });
  return button(
    {
      onclick: () => {
        console.log("download");
        const blob = new Blob([JSON.stringify(state.val.roast!)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = "roast.json";
        a.click();

        URL.revokeObjectURL(url);
      },
      disabled: () => shouldShowButton.val,
    },
    "Download",
  );
};

const SaveToDeviceButton = () => {
  const saveStatus = van.state("");
  return div(
    button(
      {
        onclick: async () => {
          if (!state.val.roast || state.val.roast.measurements.length === 0) {
            alert("No roast data to save");
            return;
          }
          
          const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, "-");
          const roastName = `roast-${timestamp}`;
          
          saveStatus.val = "Saving...";
          
          try {
            const response = await fetch(`/api/roast/save?name=${encodeURIComponent(roastName)}`, {
              method: "POST",
              body: JSON.stringify(state.val.roast),
              headers: { "Content-Type": "application/json" },
            });
            
            if (response.ok) {
              saveStatus.val = "✓ Saved!";
              loadSavedRoasts();
              setTimeout(() => { saveStatus.val = ""; }, 2000);
            } else {
              saveStatus.val = "✗ Save failed";
              setTimeout(() => { saveStatus.val = ""; }, 2000);
            }
          } catch (error) {
            console.error("Save error:", error);
            saveStatus.val = "✗ Error";
            setTimeout(() => { saveStatus.val = ""; }, 2000);
          }
        },
        disabled: () => (state.val.roast?.measurements.length ?? 0) === 0,
      },
      "💾 Save to Device",
    ),
    () => saveStatus.val ? div({ style: "font-size: 0.75rem; color: #14b8a6; margin-top: 0.25rem;" }, saveStatus.val) : null,
  );
};

const UploadButton = () => {
  return button(
    {
      onclick: () => {
        const fileInput = document.getElementById("fileInput");
        fileInput?.click();
      },
      disabled: () => state.val.currentState.status == RoasterStatus.roasting,
    },
    "Upload",
  );
};

const RoastTime = () => {
  const start = state.val.roast?.startDate ?? new Date();
  const last =
    state.val.roast!.measurements[state.val.roast!.measurements.length - 1]
      .timestamp;
  return getFormattedTimeDifference(start, last);
};

function dateReviver(key: string, value: any): any {
  if (typeof value === "string") {
    // Match ISO 8601 dates with various formats
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
      return new Date(value);
    }
  }
  return value;
}

const UploadRoastInput = () => {
  const fileInput = input({
    type: "file",
    id: "fileInput",
    accept: "application/json",
    style: "display: none;",
  });
  fileInput.addEventListener("change", (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        console.log("reading: ", e.target?.result);
        const jsonData = JSON.parse(e.target?.result as string, dateReviver) as RoastState;
        
        // Ensure all timestamps are Date objects
        if (jsonData.measurements) {
          jsonData.measurements = jsonData.measurements.map((m) => ({
            ...m,
            timestamp: new Date(m.timestamp),
          }));
        }
        if (jsonData.startDate) {
          jsonData.startDate = new Date(jsonData.startDate);
        }
        
        console.log("Loaded roast data:", jsonData);
        state.val = {
          ...state.val,
          roast: jsonData,
        };
        console.log("Updating chart with loaded data");
        updateChart(chart, state.val.roast!);
        console.log("Chart updated");
      } catch (error) {
        console.error("upload failed:", error);
        alert(`Failed to load roast file: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    };
    reader.readAsText(file);
  });

  return fileInput;
};

let tempP = pidPFactor.val;
let tempI = pidIFactor.val;
let tempD = pidDFactor.val;
let tempCooldownFan = cooldownFanSpeed.val;


// Load saved roasts from device
async function loadSavedRoasts() {
  try {
    const response = await fetch("/api/roast/list");
    if (response.ok) {
      const data = await response.json();
      savedRoasts.val = data.roasts || [];
    }
  } catch (error) {
    console.error("Failed to load saved roasts:", error);
  }
}

// Load a roast from device storage
// Strip any "/path/" prefix and ".json" suffix so we always send a clean
// basename to the firmware — covers older firmware that returns full paths
// in /api/roast/list.
function cleanRoastName(n: string): string {
  return n.replace(/^.*\//, "").replace(/\.json$/i, "");
}

async function loadRoastFromDevice(roastName: string) {
  const clean = cleanRoastName(roastName);
  try {
    const response = await fetch(`/api/roast/load?name=${encodeURIComponent(clean)}`);
    if (response.ok) {
      const jsonData = await response.json();
      
      // Ensure all timestamps are Date objects
      if (jsonData.measurements) {
        jsonData.measurements = jsonData.measurements.map((m: any) => ({
          ...m,
          timestamp: new Date(m.timestamp),
        }));
      }
      if (jsonData.startDate) {
        jsonData.startDate = new Date(jsonData.startDate);
      }
      
      state.val = {
        ...state.val,
        roast: jsonData,
      };
      updateChart(chart, state.val.roast!);
      console.log("Loaded roast from device:", roastName);
    } else {
      const text = await response.text().catch(() => "");
      alert(`Failed to load roast (${response.status}): ${text || "no detail"}`);
    }
  } catch (error) {
    console.error("Failed to load roast:", error);
    alert(`Error loading roast: ${(error as Error).message}`);
  }
}

// Delete a roast from device storage
async function deleteRoastFromDevice(roastName: string) {
  const clean = cleanRoastName(roastName);
  if (!confirm(`Delete "${clean}"?`)) return;

  try {
    const response = await fetch(`/api/roast/delete?name=${encodeURIComponent(clean)}`, {
      method: "DELETE",
    });
    
    if (response.ok) {
      loadSavedRoasts();
      console.log("Deleted roast:", roastName);
    } else {
      alert("Failed to delete roast");
    }
  } catch (error) {
    console.error("Failed to delete roast:", error);
  }
}

// Component to display saved roasts
const SavedRoastsList = () => {
  van.derive(() => {
    // Load roasts on mount
    if (savedRoasts.val.length === 0) {
      loadSavedRoasts();
    }
  });
  
  return div(
    { class: "sidebar-section" },
    div({ class: "sidebar-title" }, "Saved Roasts"),
    () => 
      savedRoasts.val.length === 0
        ? div({ style: "font-size: 0.875rem; color: var(--text-muted);" }, "No saved roasts")
        : div(
            { style: "display: flex; flex-direction: column; gap: 0.5rem;" },
            ...savedRoasts.val.map((roast) =>
              div(
                { style: "display: flex; gap: 0.5rem; font-size: 0.8125rem;" },
                button(
                  {
                    onclick: () => loadRoastFromDevice(roast.name),
                    style: "flex: 1; padding: 0.375rem; font-size: 0.75rem;",
                  },
                  cleanRoastName(roast.name),
                ),
                button(
                  {
                    onclick: () => {
                      deleteRoastFromDevice(roast.name);
                    },
                    style: "padding: 0.375rem 0.5rem; background: #ef4444; font-size: 0.75rem;",
                  },
                  "✕",
                ),
              ),
            ),
          ),
  );
};

const PIDConfig = () =>
  div(
    div(
      {
        class: "fan-mode-row",
      },
      span({ class: "toggle-row-label" }, "Fan Control"),
      button({
        class: () => `toggle ${fanMode.val === "ssr" ? "active" : ""}`,
        onclick: () => {
          fanMode.val = fanMode.val === "ssr" ? "pwm" : "ssr";
          fanModeChanged.val = true;
        },
      }),
      span(
        { class: "toggle-state-label" },
        () => (fanMode.val === "ssr" ? "SSR" : "PWM"),
      ),
      () =>
        fanModeChanged.val
          ? span({ class: "reboot-notice" }, "reboot to apply")
          : null,
    ),
    div(
      { class: "pid-form" },
      div(
        { class: "pid-field" },
        label({ class: "pid-label" }, "Kp"),
      input({
        type: "number",
        class: "pid-input",
        step: "0.01",
        value: () => pidPFactor.val,
        oninput: (e: Event) => {
          tempP = parseFloat((e.target as HTMLInputElement).value) || 0;
        },
      }),
    ),
    div(
      { class: "pid-field" },
      label({ class: "pid-label" }, "Ki"),
      input({
        type: "number",
        class: "pid-input",
        step: "0.01",
        value: () => pidIFactor.val,
        oninput: (e: Event) => {
          tempI = parseFloat((e.target as HTMLInputElement).value) || 0;
        },
      }),
    ),
    div(
      { class: "pid-field" },
      label({ class: "pid-label" }, "Kd"),
      input({
        type: "number",
        class: "pid-input",
        step: "0.001",
        value: () => pidDFactor.val,
        oninput: (e: Event) => {
          tempD = parseFloat((e.target as HTMLInputElement).value) || 0;
        },
      }),
    ),
    div(
      { class: "pid-field" },
      label({ class: "pid-label" }, "Cool Fan %"),
      input({
        type: "number",
        class: "pid-input",
        step: "5",
        min: "0",
        max: "100",
        disabled: () => fanMode.val === "ssr",
        value: () => cooldownFanSpeed.val,
        oninput: (e: Event) => {
          tempCooldownFan =
            parseInt((e.target as HTMLInputElement).value, 10) || 0;
        },
      }),
    ),
    button(
      {
        class: "pid-apply",
        onclick: () => {
          pidPFactor.val = tempP;
          pidIFactor.val = tempI;
          pidDFactor.val = tempD;
          cooldownFanSpeed.val = tempCooldownFan;
          sendCommand({
            id: 1,
            command: "setPreferences",
            pidKp: tempP,
            pidKi: tempI,
            pidKd: tempD,
            cooldownFanSpeed: tempCooldownFan,
            fanMode: fanMode.val,
          });
        },
      },
      "Apply",
    ),
    ),
  );

// ============================================================================
// Dashboard helpers
// ============================================================================

async function updateWifi() {
  const ssid = wifiSSID.val;
  const pass = wifiPass.val;
  if (!ssid.trim()) {
    wifiMessage.val = "SSID required";
    return;
  }
  wifiMessage.val = "Saving…";
  try {
    const r = await fetch(
      `/api/wifi?ssid=${encodeURIComponent(ssid)}&pass=${encodeURIComponent(pass)}`,
    );
    wifiMessage.val = r.ok
      ? "Saved. Restart device to apply."
      : `Error ${r.status}`;
    if (r.ok) setTimeout(() => (wifiMessage.val = ""), 4000);
  } catch (e) {
    wifiMessage.val = `Error: ${(e as Error).message}`;
  }
}

function condensedTs(d: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const M = months[d.getMonth()];
  const D = d.getDate();
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${M} ${D} · ${hh}:${mm}`;
}

// Roast title: a plain-looking inline input + a reactive timestamp span.
// No reactive scope at the outer level — the <input> is created once and
// never re-rendered, so focus survives state changes during a roast.
// The input commits to roastName.val only on blur or Enter, so typing
// doesn't fire keystroke-level state changes either.
const RoastTitle = () =>
  div(
    { class: "topbar-roast-title" },
    input({
      type: "text",
      class: "title-input-inline",
      placeholder: "Roast name…",
      value: () => roastName.val,
      onblur: (e: Event) => {
        roastName.val = (e.target as HTMLInputElement).value.trim();
      },
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          (e.target as HTMLInputElement).value = roastName.val;
          (e.target as HTMLInputElement).blur();
        }
      },
    }),
    span(
      { class: "title-ts" },
      () =>
        " · " +
        condensedTs(state.val.roast?.startDate ?? new Date()),
    ),
  );

function setMode(m: "Manual" | "PID") {
  currentMode.val = m;
  followProfileEnabled.val = m === "PID";
  sendCommand({ id: 1, Mode: m });
}

function allOff() {
  setMode("Manual");
  updateFanPower(0);
  updateHeaterPower(0);
  slider1Value.val = 0;
  slider2Value.val = 0;
}

function setTarget(t: "BT" | "ET") {
  currentTarget.val = t;
  sendCommand({ id: 1, Target: t });
}

function coolDown() {
  const fanSpeed = cooldownFanSpeed.val;
  setMode("Manual");
  updateFanPower(fanSpeed);
  updateHeaterPower(0);
  slider1Value.val = fanSpeed;
  slider2Value.val = 0;
}

function fmtTemp(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${v.toFixed(1)}°`;
}

const ReadingCard = (labelText: string, value: () => string, unit?: string) =>
  div(
    { class: "reading-card" },
    div({ class: "reading-label" }, labelText),
    div(
      { class: "reading-value" },
      value,
      unit ? span({ class: "reading-unit" }, unit) : null,
    ),
  );

const Slider = (opts: {
  label: string;
  unit: string;
  state: any;
  min: number;
  max: number;
  step: number;
  disabled?: () => boolean;
  onChange: (v: number) => void;
}) =>
  div(
    { class: "control" },
    div(
      { class: "control-header" },
      span({ class: "control-label" }, opts.label),
      span(
        { class: "control-value" },
        () => `${opts.state.val}${opts.unit}`,
      ),
    ),
    input({
      type: "range",
      min: opts.min,
      max: opts.max,
      step: opts.step,
      disabled: opts.disabled ?? false,
      value: () => opts.state.val,
      style: () => {
        const pct = ((opts.state.val - opts.min) / (opts.max - opts.min)) * 100;
        return `--fill: ${Math.min(100, Math.max(0, pct))}%`;
      },
      oninput: (e: Event) =>
        opts.onChange(parseFloat((e.target as HTMLInputElement).value)),
    }),
  );

// ============================================================================
// Dashboard layout
// ============================================================================

const createApp = () => div(
  { class: "dashboard" },

  // --- Top bar ----------------------------------------------------------
  header(
    { class: "topbar" },
    div(
      { class: "topbar-brand" },
      span({ class: "topbar-logo" }, "☕"),
      h1({ class: "topbar-title" }, "Yaeger"),
    ),
    div(
      { class: "topbar-status" },
      span({
        class: "conn-dot",
        style: () =>
          `background:${
            connectionStatus.val === "Connected"
              ? "var(--success)"
              : connectionStatus.val === "Error"
              ? "var(--danger)"
              : "var(--warning)"
          }`,
      }),
      span({ class: "conn-text" }, () => connectionStatus.val),
    ),
    RoastTitle,
    div(
      { class: "topbar-clock" },
      () => (state.val.roast ? RoastTime() : "00:00"),
    ),
    div(
      { class: "topbar-actions" },
      button(
        {
          class: "btn-action btn-start",
          disabled: () =>
            state.val.currentState.status !== RoasterStatus.idle,
          onclick: toggleRoastStart,
        },
        "Start Roast",
      ),
      button(
        {
          class: "btn-action btn-end",
          disabled: () =>
            state.val.currentState.status === RoasterStatus.idle,
          onclick: toggleRoastStart,
        },
        "End Roast",
      ),
      button(
        { class: "btn-action btn-cool", onclick: coolDown },
        "Cool Down",
      ),
      button(
        { class: "btn-action btn-alloff", onclick: allOff },
        "All Off",
      ),
      div(
        { class: "toggle-row" },
        span({ class: "toggle-row-label" }, "PID"),
        button({
          class: () => `toggle ${currentMode.val === "PID" ? "active" : ""}`,
          onclick: () =>
            setMode(currentMode.val === "PID" ? "Manual" : "PID"),
        }),
      ),
    ),
  ),

  // --- Main content: chart + right panel --------------------------------
  div(
    { class: "dashboard-main" },
    div({ class: "chart-area" }, chartElement),
    div(
      { class: "side-panel" },
      div(
        { class: "panel-section" },
        div({ class: "panel-title" }, "Readings"),
        div(
          { class: "readings-grid" },
          ReadingCard("Exhaust", () => fmtTemp(currentMessage.val?.ET), "C"),
          ReadingCard("Bean", () => fmtTemp(currentMessage.val?.BT), "C"),
          ReadingCard(
            "ROR",
            () => (currentROR.val != null ? currentROR.val.toFixed(1) : "—"),
            "°C/min",
          ),
          ReadingCard("Setpoint", () => `${setpoint.val}`, "°C"),
        ),
      ),
      div(
        { class: "panel-section" },
        div({ class: "panel-title" }, "Controls"),
        Slider({
          label: "Heater Power",
          unit: "%",
          state: slider2Value,
          min: 0,
          max: 100,
          step: 5,
          disabled: () => currentMode.val === "PID",
          onChange: (v) => {
            slider2Value.val = v;
            updateHeaterPower(v);
          },
        }),
        () => {
          // SSR fan: simple on/off toggle, no offset
          if (fanMode.val === "ssr") {
            return div(
              { class: "control" },
              div(
                { class: "control-header" },
                span({ class: "control-label" }, "Fan"),
                span(
                  { class: "control-value" },
                  () => (slider1Value.val > 0 ? "ON" : "OFF"),
                ),
              ),
              button({
                class: () =>
                  `toggle ${slider1Value.val > 0 ? "active" : ""}`,
                onclick: () => {
                  const next = slider1Value.val > 0 ? 0 : 100;
                  slider1Value.val = next;
                  updateFanPower(next);
                },
              }),
            );
          }
          // PWM fan: existing behaviour
          const followingFan =
            followProfileEnabled.val &&
            profile.val != null &&
            profile.val.steps.some((s) => s.fanValue != null);
          return followingFan
            ? Slider({
                label: "Fan offset (vs profile)",
                unit: "%",
                state: fanOffset,
                min: -25,
                max: 25,
                step: 5,
                onChange: (v) => {
                  fanOffset.val = v;
                },
              })
            : Slider({
                label: "Fan Power",
                unit: "%",
                state: slider1Value,
                min: 0,
                max: 100,
                step: 5,
                onChange: (v) => {
                  slider1Value.val = v;
                  updateFanPower(v);
                },
              });
        },
        Slider({
          label: "Setpoint",
          unit: "°C",
          state: setpoint,
          min: 0,
          max: 300,
          step: 1,
          disabled: () => followProfileEnabled.val,
          onChange: (v) => {
            setpoint.val = v;
            sendCommand({ id: 1, Setpoint: v });
          },
        }),
        div(
          { class: "target-toggle" },
          span({ class: "target-label" }, "Target"),
          button(
            {
              class: () =>
                `target-btn ${currentTarget.val === "BT" ? "active" : ""}`,
              onclick: () => setTarget("BT"),
            },
            "BT",
          ),
          button(
            {
              class: () =>
                `target-btn ${currentTarget.val === "ET" ? "active" : ""}`,
              onclick: () => setTarget("ET"),
            },
            "ET",
          ),
        ),
      ),
      div(
        { class: "panel-section" },
        div({ class: "panel-title" }, "Events"),
        div(
          { class: "event-grid" },
          button({ onclick: () => appendEvent("charge") }, "Charge"),
          button({ onclick: () => appendEvent("dry-end") }, "Dry End"),
          button(
            { onclick: () => appendEvent("first-crack-start") },
            "1st Crack",
          ),
          button(
            { onclick: () => appendEvent("first-crack-end") },
            "1st End",
          ),
          button(
            { onclick: () => appendEvent("second-crack-start") },
            "2nd Crack",
          ),
          button({ onclick: () => appendEvent("drop") }, "Drop"),
        ),
      ),
    ),
  ),

  // --- Profile point editor (full-width row under the chart) ------------
  div({ class: "profile-strip" }, ProfileEditor),

  // --- Collapsible settings ---------------------------------------------
  div(
    { class: "settings-row" },
    details(
      { class: "settings-panel" },
      summary({ class: "settings-summary" }, "PID Settings"),
      PIDConfig,
    ),
    details(
      { class: "settings-panel" },
      summary({ class: "settings-summary" }, "WiFi"),
      div(
        { class: "wifi-form" },
        input({
          type: "text",
          class: "form-input",
          placeholder: "SSID",
          oninput: (e: Event) =>
            (wifiSSID.val = (e.target as HTMLInputElement).value),
        }),
        input({
          type: "password",
          class: "form-input",
          placeholder: "Password",
          oninput: (e: Event) =>
            (wifiPass.val = (e.target as HTMLInputElement).value),
        }),
        button({ onclick: updateWifi }, "Save"),
      ),
      () =>
        wifiMessage.val
          ? div(
              {
                class: `status-message ${wifiMessage.val.startsWith("Error") ? "error" : "success"}`,
              },
              wifiMessage.val,
            )
          : null,
    ),
    details(
      { class: "settings-panel" },
      summary({ class: "settings-summary" }, "Profile"),
      ProfileControl,
    ),
    details(
      { class: "settings-panel" },
      summary({ class: "settings-summary" }, "Saved Roasts"),
      div(
        { class: "roast-io" },
        DownloadButton,
        SaveToDeviceButton,
        UploadButton,
      ),
      SavedRoastsList,
      UploadRoastInput,
    ),
  ),
);

function toggleRoastStart() {
  switch (state.val.currentState.status) {
    case RoasterStatus.idle:
      state.val = {
        ...state.val,
        currentState: {
          ...state.val.currentState,
          status: RoasterStatus.roasting,
        },
        roast: {
          startDate: new Date(),
          measurements: [],
          events: [],
          commands: [],
        },
        profile: profile.val,
      };
      break;
    case RoasterStatus.roasting:
      state.val = {
        ...state.val,
        currentState: {
          ...state.val.currentState,
          status: RoasterStatus.idle,
        },
        roast: {
          ...state.val.roast!,
          profile: state.val.profile,
        },
      };
      break;
  }
}

// Export the app for use in main.ts
export const roastApp = createApp; 
