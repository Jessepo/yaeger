import "./style.css";
import van from "vanjs-core";
import { initializeChart, updateChart, updateProfileLines, highlightTime, resetChartZoom } from "./chart";
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
  profileName,
  ProfileControl,
  ProfileEditor,
  selectedPointTime,
  pointsFromProfile,
  profileFromPoints,
  roastToProfile,
} from "./profiling.ts";
import type { Profile } from "./model.ts";
import {
  lastMessage,
  lastUpdate,
  connectionStatus,
  reconnectTick,
  sendCommand,
} from "./websocket";

const { label, button, div, input, span, h1, h2, details, summary, header, img } = van.tags;

// State variables
export const slider1Value = van.state(50);
export const slider2Value = van.state(50);

// Guard against the "slider flicker" that happens when a status
// message arrives mid-drag: the WS handler used to unconditionally
// overwrite slider1/2Value from message.FanVal / BurnerVal, which
// would snap the thumb back to the last firmware-known position
// while the user was still dragging.  We now stamp the last time
// the user changed each slider and suppress the sync inside a
// short window.
let lastUserFanEditMs = 0;
let lastUserHeaterEditMs = 0;
const USER_SLIDER_LOCKOUT_MS = 2000;
function noteUserFanEdit() { lastUserFanEditMs = Date.now(); }
function noteUserHeaterEdit() { lastUserHeaterEditMs = Date.now(); }
export const state = van.state(new YaegerState());

const setpoint = van.state(20);
export const pidPFactor = van.state(1.0);
export const pidIFactor = van.state(0.1);
export const pidDFactor = van.state(0.01);

// Saved roasts storage
interface SavedRoast {
  name: string;
  size: number;
}
const savedRoasts = van.state<SavedRoast[]>([]);

// Dashboard state
const currentROR = van.state<number | null>(null);
export const currentMode = van.state<"Manual" | "PID">("Manual");
export const currentTarget = van.state<"BT" | "ET">("BT");
export const fanOffset = van.state(0);
const cooldownFanSpeed = van.state(50);
const roastName = van.state("");
const fanMode = van.state<"pwm" | "ssr">("pwm");
const fanModeChanged = van.state(false);  // shows reboot-needed notice when toggled
// Kept as a legacy chart-annotation state (auto-drop functionality was
// removed; the value survives in case we want to draw a target line on
// the chart later).
export const targetBT = van.state(220);

// Convenience predicates over the single RoasterStatus enum — reads
// cleaner at call-sites than repeating the tag comparison.
const isCooling = () => state.val.currentState.status === RoasterStatus.cooling;
const isRoasting = () => state.val.currentState.status === RoasterStatus.roasting;
const isIdle = () => state.val.currentState.status === RoasterStatus.idle;
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

// Explicit "loaded a fresh profile" path — call this instead of setting
// profile.val directly when the profile comes from outside the editor
// (file upload, device library, or → Profile from a saved roast).
// Resets the roast state and arms PID + BT so the user is one click
// from Start Roast.  Editor edits should set profile.val directly and
// SKIP this so they don't wipe measurements mid-tweak.
export function loadProfile(p: Profile | undefined) {
  resetRoast();
  profile.val = p;
  if (p) {
    setMode("PID");
    setTarget("BT");
  }
}

// Mirror profile edits to firmware while a roast is running.  Skip the
// initial mount (profile.val is undefined then) and don't bother when
// the roast isn't active — Start Roast will push the full profile.
let lastMirroredProfile: typeof profile.val | undefined = undefined;
van.derive(() => {
  const p = profile.val;
  if (p === lastMirroredProfile) return;
  lastMirroredProfile = p;
  if (!p) return;
  if (state.val.currentState.status !== RoasterStatus.roasting) return;
  const pts = pointsFromProfile(p).map((q) => ({
    time: q.time,
    setpoint: q.setpoint,
    fan: q.fan,
  }));
  sendCommand({ id: 1, command: "updateActiveProfile", points: pts });
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

    // Roast state snapshot: sent on (re)connect via getRoastState.  If
    // firmware says it's actively following a profile, sync our local
    // state machine so the dashboard reflects the live roast.
    if (message.type === "roastState") {
      const m = message as unknown as {
        following: boolean;
        roastElapsedSec: number;
        fanOffset?: number;
        profile?: Array<{ time: number; setpoint: number; fan?: number }>;
      };
      if (typeof m.fanOffset === "number") fanOffset.val = m.fanOffset;
      if (m.profile && m.profile.length > 0) {
        // Convert firmware's absolute-time points back to the local
        // {steps: [...]} Profile shape so updateProfileLines + UI work.
        const points = m.profile.map((p) => ({
          time: p.time,
          setpoint: p.setpoint,
          fan: p.fan,
        }));
        profile.val = profileFromPoints(points);
      }
      if (m.following && state.val.currentState.status !== RoasterStatus.roasting) {
        const startMs = timestamp.getTime() - Math.round(m.roastElapsedSec * 1000);
        state.val = {
          ...state.val,
          currentState: { ...state.val.currentState, status: RoasterStatus.roasting },
          roast: {
            startDate: new Date(startMs),
            measurements: [],
            events: [],
            commands: [],
          },
          profile: profile.val,
        };
      } else if (!m.following && state.val.currentState.status === RoasterStatus.roasting) {
        // Firmware ended the roast while we were away.
        state.val = {
          ...state.val,
          currentState: { ...state.val.currentState, status: RoasterStatus.idle },
        };
      }
      return;
    }

    console.log("Processing new message:", message);

    // Update UI elements directly, but honour the lockout window so
    // status echoes don't fight active user drags.  Guard on the field
    // actually being a number — the Artisan-compat `getData` response
    // only carries ET/BT, so unconditional writes would poke `undefined`
    // into the sliders once a second and show "undefined%" in the UI.
    const now = Date.now();
    if (
      typeof message.FanVal === "number" &&
      now - lastUserFanEditMs > USER_SLIDER_LOCKOUT_MS
    ) {
      slider1Value.val = message.FanVal;
    }
    if (
      typeof message.BurnerVal === "number" &&
      now - lastUserHeaterEditMs > USER_SLIDER_LOCKOUT_MS
    ) {
      slider2Value.val = message.BurnerVal;
    }

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

    if (state.val.roast != null && isRoasting()) {
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
      // Firmware now drives the profile autonomously, so no client-side
      // followProfile() call here.  Setpoint/fan changes arrive via
      // status messages (handled above by the message.Setpoint sync).
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

function downloadFilename(ext: string): string {
  const baseName = roastName.val.trim() || "roast";
  const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  return `${baseName.replace(/\s+/g, "-")}-${ts}.${ext}`;
}

var DownloadButton = () => {
  const shouldShowButton = van.derive(() => {
    return (state.val.roast?.measurements.length ?? 0) === 0;
  });
  return button(
    {
      onclick: () => {
        const blob = new Blob([JSON.stringify(state.val.roast!)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = downloadFilename("json");
        a.click();

        URL.revokeObjectURL(url);
      },
      disabled: () => shouldShowButton.val,
    },
    "Download JSON",
  );
};

const DownloadChartButton = () => {
  const disabled = van.derive(() => {
    return (state.val.roast?.measurements.length ?? 0) === 0;
  });
  return button(
    {
      onclick: () => {
        // ECharts emits a PNG data URL of the current chart at the requested
        // pixel ratio.  2x for a crisp screenshot.
        const dataUrl = (chart as unknown as {
          getDataURL: (opts: object) => string;
        }).getDataURL({
          type: "png",
          pixelRatio: 2,
          backgroundColor: "#38424e",
        });
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = downloadFilename("png");
        a.click();
      },
      disabled: () => disabled.val,
    },
    "Download PNG",
  );
};

// Keep the first measurement that lands in each 1-second window.  Used to
// shrink the on-device save: ~10x smaller files for the same wallclock
// duration, since LittleFS partition space is the tightest resource.
// The local browser buffer (Download JSON, chart) keeps full 10 Hz fidelity.
function downsampleTo1Hz(roast: RoastState): RoastState {
  if (!roast.measurements || roast.measurements.length === 0) return roast;
  const startMs = roast.startDate.getTime();
  const seen = new Set<number>();
  const downsampled: Measurement[] = [];
  for (const m of roast.measurements) {
    const sec = Math.floor((m.timestamp.getTime() - startMs) / 1000);
    if (!seen.has(sec)) {
      seen.add(sec);
      downsampled.push(m);
    }
  }
  return { ...roast, measurements: downsampled };
}

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
          const baseName = roastName.val.trim() || "roast";
          const saveName = `${baseName.replace(/\s+/g, "-")}-${timestamp}`;

          saveStatus.val = "Saving...";

          const payload = downsampleTo1Hz(state.val.roast);

          try {
            const response = await fetch(`/api/roast/save?name=${encodeURIComponent(saveName)}`, {
              method: "POST",
              body: JSON.stringify(payload),
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
  const measurements = state.val.roast?.measurements;
  const last =
    measurements && measurements.length > 0
      ? measurements[measurements.length - 1].timestamp
      : start;
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

// Fetch a saved roast and convert it into a playable profile (smoothed BT
// curve simplified via RDP + fan timeline from commands).  The new profile
// becomes the active one immediately; user can tweak it in the editor and
// either Start Roast or Save to Device to keep it.
async function loadRoastAsProfileFromDevice(roastName: string) {
  const clean = cleanRoastName(roastName);
  try {
    const response = await fetch(
      `/api/roast/load?name=${encodeURIComponent(clean)}`,
    );
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      alert(`Failed to load roast (${response.status}): ${text || "no detail"}`);
      return;
    }
    const jsonData = await response.json();
    // Revive Date objects so roastToProfile() can do arithmetic on them.
    if (jsonData.measurements) {
      jsonData.measurements = jsonData.measurements.map((m: any) => ({
        ...m,
        timestamp: new Date(m.timestamp),
      }));
    }
    if (jsonData.events) {
      jsonData.events = jsonData.events.map((e: any) => ({
        ...e,
        measurement: {
          ...e.measurement,
          timestamp: new Date(e.measurement.timestamp),
        },
      }));
    }
    if (jsonData.commands) {
      jsonData.commands = jsonData.commands.map((c: any) => ({
        ...c,
        timestamp: new Date(c.timestamp),
      }));
    }
    if (jsonData.startDate) {
      jsonData.startDate = new Date(jsonData.startDate);
    }

    const points = roastToProfile(jsonData);
    if (points.length === 0) {
      alert("Couldn't derive a profile from this roast (no measurements).");
      return;
    }
    const newProfile = profileFromPoints(points);
    loadProfile(newProfile);
    profileName.val = `${clean}-from-roast`;
    console.log(`Converted "${clean}" to a ${points.length}-point profile.`);
  } catch (error) {
    console.error("Failed to convert roast to profile:", error);
    alert(`Error converting roast: ${(error as Error).message}`);
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
                    style: "flex: 1; padding: 0.375rem; font-size: 0.75rem; text-align: left;",
                  },
                  cleanRoastName(roast.name),
                ),
                button(
                  {
                    onclick: () => loadRoastAsProfileFromDevice(roast.name),
                    style: "padding: 0.375rem 0.5rem; font-size: 0.75rem;",
                    title: "Convert smoothed BT curve to a follow-able profile",
                  },
                  "→ Profile",
                ),
                button(
                  {
                    onclick: () => {
                      deleteRoastFromDevice(roast.name);
                    },
                    style: "padding: 0.375rem 0.5rem; background: var(--danger); color: var(--bg-0); border-color: var(--danger); font-size: 0.75rem;",
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
    // PID On/Off (moved here from the top bar so the top bar can stay
    // tight and operational on the smaller touchscreen).
    div(
      { class: "fan-mode-row" },
      span({ class: "toggle-row-label" }, "PID"),
      button({
        class: () => `toggle ${currentMode.val === "PID" ? "active" : ""}`,
        onclick: () =>
          setMode(currentMode.val === "PID" ? "Manual" : "PID"),
      }),
      span(
        { class: "toggle-state-label" },
        () => (currentMode.val === "PID" ? "ON" : "OFF"),
      ),
    ),
    div(
      { class: "fan-mode-row" },
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

export function setMode(m: "Manual" | "PID") {
  currentMode.val = m;
  followProfileEnabled.val = m === "PID";
  sendCommand({ id: 1, Mode: m });
}

function allOff() {
  // The firmware-side allOff handler atomically: stops profile following,
  // switches to Manual, zeros heater and fan.  sendCommand() puts this
  // at the front of the queue if we're disconnected, so it's the first
  // thing to land when the link returns.
  sendCommand({ id: 1, command: "allOff" });
  // Optimistic local update so the UI reflects it immediately.
  currentMode.val = "Manual";
  followProfileEnabled.val = false;
  slider1Value.val = 0;
  slider2Value.val = 0;
  // If we're mid-cool-down when the user smashes All Off, jump straight
  // to idle.  The BT<50 watcher's early-exit will handle the rest.
  if (isCooling()) {
    state.val = {
      ...state.val,
      currentState: { ...state.val.currentState, status: RoasterStatus.idle },
    };
  }
}

// Clear the local roast state and tell firmware to end any running roast.
// Used by the "Clear Reset" top-bar button and by every profile-load path
// so the chart is fresh and ready for the next Start Roast.
export function resetRoast() {
  if (!isIdle()) {
    sendCommand({ id: 1, command: "endRoast" });
  }
  state.val = {
    ...state.val,
    currentState: { ...state.val.currentState, status: RoasterStatus.idle },
    roast: undefined,
  };
  // Empty chart — updateChart's measurements-empty branch wipes BT/ET/ROR/
  // Setpoint/Burner data AND the BT series' markLine+markPoint (where the
  // event markers live), so charge/dry/crack/drop annotations don't carry
  // over to the next roast.  Profile lines stay (configuration, not state).
  updateChart(chart, {
    startDate: new Date(),
    measurements: [],
    events: [],
    commands: [],
  });
  // Wipe any pan/zoom the user did on the previous roast so the fresh
  // chart starts at the full default view.
  resetChartZoom(chart);
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

// In Manual mode the heater is disarmed unless (a) Start Roast has been
// pressed (status === roasting) AND (b) the fan is on.  Mirrors a
// belt-and-suspenders check on the firmware side so a stale command can
// never dry-fire the element.
function canRunHeater(): boolean {
  return (
    state.val.currentState.status === RoasterStatus.roasting &&
    slider1Value.val > 0
  );
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
        "Start\nRoast",
      ),
      button(
        {
          class: "btn-action btn-end",
          disabled: () =>
            state.val.currentState.status === RoasterStatus.idle,
          onclick: toggleRoastStart,
        },
        "End\nRoast",
      ),
      button(
        { class: "btn-action btn-cool", onclick: coolDown },
        "Cool\nDown",
      ),
      button(
        { class: "btn-action btn-reset", onclick: () => resetRoast() },
        "Clear\nReset",
      ),
      button(
        { class: "btn-action btn-alloff", onclick: allOff },
        "All\nOff",
      ),
    ),
  ),

  // --- Top row: chart fills the rest + readings/events fixed-width column
  div(
    { class: "dashboard-top" },
    div({ class: "chart-area" }, chartElement),
    div(
      { class: "dashboard-card side-readings" },
      div(
        { class: "panel-section" },
        div({ class: "panel-title" }, "Readings"),
        div(
          { class: "readings-grid" },
          ReadingCard("Inlet Air", () => fmtTemp(currentMessage.val?.ET), "C"),
          ReadingCard("Bean", () => fmtTemp(currentMessage.val?.BT), "C"),
          ReadingCard(
            "ROR",
            () => (currentROR.val != null ? currentROR.val.toFixed(1) : "—"),
            "°C/min",
          ),
          ReadingCard("Setpoint", () => setpoint.val.toFixed(1), "°C"),
        ),
      ),
    ),
  ),

  // --- Profile point editor (full-width row under the chart row) -------
  div({ class: "profile-strip" }, ProfileEditor),

  // --- Controls row (full width) ---------------------------------------
  div(
    { class: "dashboard-card controls-area" },
      div(
        { class: "panel-section" },
        // Heater + Fan side by side.  Heater is also disabled in Manual
        // mode until a roast has been Started AND the fan is on — see
        // canRunHeater() — to prevent dry-heating the element.
        div(
          { class: "controls-row" },
          Slider({
            label: "Heater Power",
            unit: "%",
            state: slider2Value,
            min: 0,
            max: 100,
            step: 5,
            disabled: () =>
              currentMode.val === "PID" || !canRunHeater(),
            onChange: (v) => {
              noteUserHeaterEdit();
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
                    noteUserFanEdit();
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
                    sendCommand({
                      id: 1,
                      command: "setFanOffset",
                      value: v,
                    });
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
                    noteUserFanEdit();
                    slider1Value.val = v;
                    updateFanPower(v);
                  },
                });
          },
        ),
        Slider({
          label: "Setpoint",
          unit: "°C",
          state: setpoint,
          min: 0,
          max: 300,
          step: 1,
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
    ),

  // --- Roast name row (full width, between controls and events) -------
  // Moved out of the topbar so vertical space up there isn't crowded in
  // portrait orientation, and so the name + timestamp sit next to the
  // controls the operator is touching most.
  div(
    { class: "dashboard-card roast-name-row" },
    RoastTitle,
    div(
      { class: "roast-name-actions" },
      DownloadButton,
      DownloadChartButton,
      SaveToDeviceButton,
    ),
  ),

  // --- Events row (full width, under controls) -------------------------
  // Color-coded along the bean-color progression (green raw -> brown
  // medium -> near-black post-drop).  Pulled out of the readings sidebar
  // when we went portrait so readings can stack 4-tall next to the chart.
  div(
    { class: "dashboard-card events-area" },
    div(
      { class: "panel-section" },
      div({ class: "panel-title" }, "Events"),
      div(
        { class: "event-grid" },
        button(
          {
            class: "event-btn event-charge",
            onclick: () => appendEvent("charge"),
          },
          "Charge",
        ),
        button(
          {
            class: "event-btn event-dry",
            onclick: () => appendEvent("dry-end"),
          },
          "Dry End",
        ),
        button(
          {
            class: "event-btn event-crack1",
            onclick: () => appendEvent("first-crack-start"),
          },
          "1st Crack",
        ),
        button(
          {
            class: "event-btn event-crack1-end",
            onclick: () => appendEvent("first-crack-end"),
          },
          "1st End",
        ),
        button(
          {
            class: "event-btn event-crack2",
            onclick: () => appendEvent("second-crack-start"),
          },
          "2nd Crack",
        ),
        button(
          {
            class: "event-btn event-drop",
            onclick: () => appendEvent("drop"),
          },
          "Drop",
        ),
      ),
    ),
  ),

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
      // Push the active profile to firmware, then ask it to start.  Firmware
      // owns the roast clock + setpoint interpolation from here on; the web
      // just optimistically mirrors the state.
      if (profile.val) {
        const pts = pointsFromProfile(profile.val).map((p) => ({
          time: p.time,
          setpoint: p.setpoint,
          fan: p.fan,
        }));
        sendCommand({ id: 1, command: "setActiveProfile", points: pts });
      }
      sendCommand({ id: 1, command: "startRoast" });
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
      // Auto-record the "charge" event so the chart marker lands at t=0.
      // The empty roast above is already in place, so appendEvent's
      // status / roast guards both pass.
      appendEvent("charge");
      break;
    case RoasterStatus.roasting:
      triggerDrop();
      break;
  }
}

// Drop sequence: record event, ask firmware to stop following, transition
// to cool-down phase, and set outputs for cool-down (Manual, heater 0,
// fan to cooldownFanSpeed).  The measurement-append gate in the WS
// handler checks isRoasting(), so the chart + timer freeze the moment
// we enter cooling.  Called from the End Roast button.
function triggerDrop() {
  if (!isRoasting()) return; // only meaningful while actively roasting
  appendEvent("drop");
  sendCommand({ id: 1, command: "endRoast" });
  state.val = {
    ...state.val,
    currentState: {
      ...state.val.currentState,
      status: RoasterStatus.cooling,
    },
  };
  setMode("Manual");
  updateFanPower(cooldownFanSpeed.val);
  updateHeaterPower(0);
  slider1Value.val = cooldownFanSpeed.val;
  slider2Value.val = 0;
}

// Watch BT during cool-down: once it drops below 50 °C, exit cool-down
// and return to idle (all off, sliders zeroed).
van.derive(() => {
  const m = lastMessage.val;
  if (!isCooling()) return;
  if (m && typeof m.BT === "number" && m.BT < 50) {
    sendCommand({ id: 1, command: "allOff" });
    currentMode.val = "Manual";
    followProfileEnabled.val = false;
    slider1Value.val = 0;
    slider2Value.val = 0;
    state.val = {
      ...state.val,
      currentState: {
        ...state.val.currentState,
        status: RoasterStatus.idle,
      },
    };
  }
});

// Export the app for use in main.ts
export const roastApp = createApp; 
