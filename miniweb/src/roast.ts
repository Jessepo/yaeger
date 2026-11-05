import "./style.css";
import van from "vanjs-core";
import { initializeChart, updateChart, resetChartZoom } from "./chart";
import {
  YaegerState,
  Measurement,
  RoasterStatus,
  RoastState,
} from "./model.ts";
import { getFormattedTimeDifference } from "./util.ts";
import {
  lastMessage,
  lastUpdate,
  connectionStatus,
  sendCommand,
} from "./websocket";
import { CrackTuner } from "./crack-serial";

const { label, button, div, input, span, header, select, option } = van.tags;

// Slider state + drag-lockout (suppress WS echo while user is dragging)
export const slider1Value = van.state(50);
export const slider2Value = van.state(50);
let lastUserFanEditMs = 0;
let lastUserHeaterEditMs = 0;
const USER_SLIDER_LOCKOUT_MS = 2000;
function noteUserFanEdit()    { lastUserFanEditMs    = Date.now(); }
function noteUserHeaterEdit() { lastUserHeaterEditMs = Date.now(); }

export const state = van.state(new YaegerState());

const savedRoasts = van.state<{ name: string; size: number }[]>([]);
const currentROR  = van.state<number | null>(null);
const roastName   = van.state("");
const fanMode     = van.state<"pwm" | "ssr">("pwm");
const fanModeChanged = van.state(false);
const btSource    = van.state<"bt" | "ir" | "avg">("bt");
const cooldownFanSpeed = van.state(50); // local only — not synced to firmware
const wifiSSID  = van.state("");
const wifiPass  = van.state("");
const wifiMessage = van.state("");

const isCooling  = () => state.val.currentState.status === RoasterStatus.cooling;
const isRoasting = () => state.val.currentState.status === RoasterStatus.roasting;
const isIdle     = () => state.val.currentState.status === RoasterStatus.idle;

// Chart
const chartElement = div({ id: "liveChart" });
const chart = initializeChart(chartElement);

// Derived current message (logged for debugging)
const currentMessage = van.derive(() => lastMessage.val);
const currentUpdate  = van.derive(() => lastUpdate.val);

// ============================================================================
// WebSocket message handler
// ============================================================================
van.derive(() => {
  const message = currentMessage.val;
  const timestamp = currentUpdate.val;
  if (message == undefined || timestamp == null) return;

  // Preferences response: absorb fanMode
  if (message.type === "preferences") {
    if (message.fanMode === "pwm" || message.fanMode === "ssr") {
      fanMode.val = message.fanMode;
      fanModeChanged.val = false;
    }
    if (message.btSource === "bt" || message.btSource === "ir" || message.btSource === "avg") {
      btSource.val = message.btSource;
    }
    return;
  }

  // Sync sliders from firmware readback, honouring drag-lockout window
  const now = Date.now();
  if (typeof message.FanVal === "number" && now - lastUserFanEditMs > USER_SLIDER_LOCKOUT_MS) {
    slider1Value.val = message.FanVal;
  }
  if (typeof message.BurnerVal === "number" && now - lastUserHeaterEditMs > USER_SLIDER_LOCKOUT_MS) {
    slider2Value.val = message.BurnerVal;
  }

  const newState = {
    ...state.val,
    currentState: {
      ...state.val.currentState,
      lastMessage: message,
      lastUpdate: timestamp,
    },
  };

  if (state.val.roast != null && isRoasting()) {
    const newMeasurement: [Measurement] = [{ timestamp, message }];
    newState.roast = {
      ...state.val.roast,
      measurements: [...state.val.roast.measurements, ...newMeasurement],
    };

    // ROR: 30-second rolling window
    const meas = newState.roast.measurements;
    if (meas.length >= 5) {
      const last  = meas[meas.length - 1];
      const cutoffMs = last.timestamp.getTime() - 30_000;
      let firstIdx = meas.findIndex((m) => m.timestamp.getTime() >= cutoffMs);
      if (firstIdx < 0) firstIdx = 0;
      const first = meas[firstIdx];
      const dt = (last.timestamp.getTime() - first.timestamp.getTime()) / 1000;
      const dT = last.message.BT - first.message.BT;
      currentROR.val = dt > 0 ? (dT / dt) * 60 : null;
    }

    updateChart(chart, newState.roast);
  }

  state.val = newState;
});

// ============================================================================
// Commands
// ============================================================================
export function updateFanPower(value: number) {
  sendCommand({ id: 1, FanVal: value });
  appendCommand("fan", value);
}

export function updateHeaterPower(value: number) {
  sendCommand({ id: 1, BurnerVal: value });
  appendCommand("heater", value);
}

function appendCommand(label: "fan" | "heater", value: number) {
  if (isIdle()) return;
  const roast = state.val.roast;
  if (!roast) return;
  state.val = {
    ...state.val,
    roast: {
      ...roast,
      startDate: roast.startDate,
      commands: [...(roast.commands || []), { type: label, value, timestamp: new Date() }],
    },
  };
}

function appendEvent(label: string) {
  if (isIdle()) return;
  const roast = state.val.roast;
  if (!roast) return;
  const msg  = state.val.currentState.lastMessage;
  const upd  = state.val.currentState.lastUpdate;
  if (!msg || !upd) return;
  state.val = {
    ...state.val,
    roast: {
      ...roast,
      startDate: roast.startDate,
      events: [...(roast.events || []), { label, measurement: { message: msg, timestamp: upd } }],
    },
  };
}

function allOff() {
  sendCommand({ id: 1, command: "allOff" });
  slider1Value.val = 0;
  slider2Value.val = 0;
  if (isCooling()) {
    state.val = {
      ...state.val,
      currentState: { ...state.val.currentState, status: RoasterStatus.idle },
    };
  }
}

export function resetRoast() {
  state.val = {
    ...state.val,
    currentState: { ...state.val.currentState, status: RoasterStatus.idle },
    roast: undefined,
  };
  updateChart(chart, { startDate: new Date(), measurements: [], events: [], commands: [] });
  resetChartZoom(chart);
}

function coolDown() {
  updateFanPower(cooldownFanSpeed.val);
  updateHeaterPower(0);
  slider1Value.val = cooldownFanSpeed.val;
  slider2Value.val = 0;
}

// Heater only allowed when fan is on (mirrors firmware-side safety rule)
function canRunHeater(): boolean {
  return slider1Value.val > 0;
}

// ============================================================================
// Download / save
// ============================================================================
function downloadFilename(ext: string): string {
  const baseName = roastName.val.trim() || "roast";
  const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  return `${baseName.replace(/\s+/g, "-")}-${ts}.${ext}`;
}

const DownloadButton = () => {
  const disabled = van.derive(() => (state.val.roast?.measurements.length ?? 0) === 0);
  return button(
    {
      onclick: () => {
        const blob = new Blob([JSON.stringify(state.val.roast!)], { type: "application/json" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href = url; a.download = downloadFilename("json"); a.click();
        URL.revokeObjectURL(url);
      },
      disabled: () => disabled.val,
    },
    "Download JSON",
  );
};

const DownloadChartButton = () => {
  const disabled = van.derive(() => (state.val.roast?.measurements.length ?? 0) === 0);
  return button(
    {
      onclick: () => {
        const dataUrl = (chart as unknown as { getDataURL: (opts: object) => string }).getDataURL({
          type: "png", pixelRatio: 2, backgroundColor: "#38424e",
        });
        const a = document.createElement("a");
        a.href = dataUrl; a.download = downloadFilename("png"); a.click();
      },
      disabled: () => disabled.val,
    },
    "Download PNG",
  );
};

function downsampleTo1Hz(roast: RoastState): RoastState {
  if (!roast.measurements || roast.measurements.length === 0) return roast;
  const startMs = roast.startDate.getTime();
  const seen = new Set<number>();
  const downsampled: Measurement[] = [];
  for (const m of roast.measurements) {
    const sec = Math.floor((m.timestamp.getTime() - startMs) / 1000);
    if (!seen.has(sec)) { seen.add(sec); downsampled.push(m); }
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
            alert("No roast data to save"); return;
          }
          const ts       = new Date().toISOString().slice(0, 19).replace(/[:-]/g, "-");
          const baseName = roastName.val.trim() || "roast";
          const saveName = `${baseName.replace(/\s+/g, "-")}-${ts}`;
          saveStatus.val = "Saving...";
          try {
            const response = await fetch(`/api/roast/save?name=${encodeURIComponent(saveName)}`, {
              method: "POST",
              body: JSON.stringify(downsampleTo1Hz(state.val.roast)),
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

const UploadButton = () =>
  button(
    {
      onclick: () => document.getElementById("fileInput")?.click(),
      disabled: () => isRoasting(),
    },
    "Upload",
  );

function dateReviver(_key: string, value: any): any {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
    return new Date(value);
  }
  return value;
}

const UploadRoastInput = () => {
  const fileInput = input({ type: "file", id: "fileInput", accept: "application/json", style: "display: none;" });
  fileInput.addEventListener("change", (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const jsonData = JSON.parse(e.target?.result as string, dateReviver) as RoastState;
        if (jsonData.measurements) {
          jsonData.measurements = jsonData.measurements.map((m) => ({ ...m, timestamp: new Date(m.timestamp) }));
        }
        if (jsonData.startDate) jsonData.startDate = new Date(jsonData.startDate);
        state.val = { ...state.val, roast: jsonData };
        updateChart(chart, state.val.roast!);
      } catch (error) {
        alert(`Failed to load roast file: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    };
    reader.readAsText(file);
  });
  return fileInput;
};

// ============================================================================
// Saved roasts
// ============================================================================
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

function cleanRoastName(n: string): string {
  return n.replace(/^.*\//, "").replace(/\.json$/i, "");
}

async function loadRoastFromDevice(name: string) {
  const clean = cleanRoastName(name);
  try {
    const response = await fetch(`/api/roast/load?name=${encodeURIComponent(clean)}`);
    if (response.ok) {
      const jsonData = await response.json();
      if (jsonData.measurements) {
        jsonData.measurements = jsonData.measurements.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }));
      }
      if (jsonData.startDate) jsonData.startDate = new Date(jsonData.startDate);
      state.val = { ...state.val, roast: jsonData };
      updateChart(chart, state.val.roast!);
    } else {
      const text = await response.text().catch(() => "");
      alert(`Failed to load roast (${response.status}): ${text || "no detail"}`);
    }
  } catch (error) {
    alert(`Error loading roast: ${(error as Error).message}`);
  }
}

async function deleteRoastFromDevice(name: string) {
  const clean = cleanRoastName(name);
  if (!confirm(`Delete "${clean}"?`)) return;
  try {
    const response = await fetch(`/api/roast/delete?name=${encodeURIComponent(clean)}`, { method: "DELETE" });
    if (response.ok) loadSavedRoasts();
    else alert("Failed to delete roast");
  } catch (error) {
    console.error("Failed to delete roast:", error);
  }
}

const SavedRoastsList = () => {
  van.derive(() => { if (savedRoasts.val.length === 0) loadSavedRoasts(); });
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
                  { onclick: () => loadRoastFromDevice(roast.name), style: "flex: 1; padding: 0.375rem; font-size: 0.75rem; text-align: left;" },
                  cleanRoastName(roast.name),
                ),
                button(
                  {
                    onclick: () => deleteRoastFromDevice(roast.name),
                    style: "padding: 0.375rem 0.5rem; background: var(--danger); color: var(--bg-0); border-color: var(--danger); font-size: 0.75rem;",
                  },
                  "✕",
                ),
              ),
            ),
          ),
  );
};

// ============================================================================
// Settings panel
// ============================================================================
const DeviceSettings = () =>
  div(
    div(
      { class: "fan-mode-row" },
      span({ class: "toggle-row-label" }, "Fan Control"),
      button({
        class: () => `toggle ${fanMode.val === "ssr" ? "active" : ""}`,
        onclick: () => { fanMode.val = fanMode.val === "ssr" ? "pwm" : "ssr"; fanModeChanged.val = true; },
      }),
      span({ class: "toggle-state-label" }, () => fanMode.val === "ssr" ? "SSR" : "PWM"),
      () => fanModeChanged.val ? span({ class: "reboot-notice" }, "reboot to apply") : null,
    ),
    div(
      { class: "pid-form" },
      div(
        { class: "pid-field" },
        label({ class: "pid-label" }, "Cool Fan %"),
        input({
          type: "number", class: "pid-input", step: "5", min: "0", max: "100",
          disabled: () => fanMode.val === "ssr",
          value: () => cooldownFanSpeed.val,
          oninput: (e: Event) => { cooldownFanSpeed.val = parseInt((e.target as HTMLInputElement).value, 10) || 0; },
        }),
      ),
      div(
        { class: "pid-field" },
        label({ class: "pid-label" }, "BT Source"),
        select({
          class: "pid-input",
          value: () => btSource.val,
          onchange: (e: Event) => { btSource.val = (e.target as HTMLSelectElement).value as "bt" | "ir" | "avg"; },
        },
          option({ value: "bt" }, "BT Thermocouple"),
          option({ value: "ir" }, "IR Object (MLX90614)"),
          option({ value: "avg" }, "Avg BT + IR"),
        ),
      ),
      button({
        class: "pid-apply",
        onclick: () => sendCommand({ id: 1, command: "setPreferences", fanMode: fanMode.val, btSource: btSource.val }),
      }, "Apply"),
    ),
  );

// ============================================================================
// WiFi
// ============================================================================
async function updateWifi() {
  const ssid = wifiSSID.val;
  if (!ssid.trim()) { wifiMessage.val = "SSID required"; return; }
  wifiMessage.val = "Saving…";
  try {
    const r = await fetch(`/api/wifi?ssid=${encodeURIComponent(ssid)}&pass=${encodeURIComponent(wifiPass.val)}`);
    wifiMessage.val = r.ok ? "Saved. Restart device to apply." : `Error ${r.status}`;
    if (r.ok) setTimeout(() => (wifiMessage.val = ""), 4000);
  } catch (e) {
    wifiMessage.val = `Error: ${(e as Error).message}`;
  }
}

// ============================================================================
// Layout helpers
// ============================================================================
function fmtTemp(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${v.toFixed(1)}°`;
}

const RoastTime = () => {
  const start = state.val.roast?.startDate ?? new Date();
  const meas  = state.val.roast?.measurements;
  const last  = meas && meas.length > 0 ? meas[meas.length - 1].timestamp : start;
  return getFormattedTimeDifference(start, last);
};

function condensedTs(d: Date): string {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${months[d.getMonth()]} ${d.getDate()} · ${hh}:${mm}`;
}

const RoastTitle = () =>
  div(
    { class: "topbar-roast-title" },
    input({
      type: "text", class: "title-input-inline", placeholder: "Roast name…",
      value: () => roastName.val,
      onblur:   (e: Event)     => { roastName.val = (e.target as HTMLInputElement).value.trim(); },
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === "Enter")  (e.target as HTMLInputElement).blur();
        else if (e.key === "Escape") { (e.target as HTMLInputElement).value = roastName.val; (e.target as HTMLInputElement).blur(); }
      },
    }),
    span({ class: "title-ts" }, () => " · " + condensedTs(state.val.roast?.startDate ?? new Date())),
  );

const ReadingCard = (labelText: string, value: () => string, unit?: string) =>
  div(
    { class: "reading-card" },
    div({ class: "reading-label" }, labelText),
    div({ class: "reading-value" }, value, unit ? span({ class: "reading-unit" }, unit) : null),
  );

const Slider = (opts: {
  label: string; unit: string; state: any; min: number; max: number; step: number;
  disabled?: () => boolean; onChange: (v: number) => void;
}) =>
  div(
    { class: "control" },
    div(
      { class: "control-header" },
      span({ class: "control-label" }, opts.label),
      span({ class: "control-value" }, () => `${opts.state.val}${opts.unit}`),
    ),
    input({
      type: "range", min: opts.min, max: opts.max, step: opts.step,
      disabled: opts.disabled ?? false,
      value: () => opts.state.val,
      style: () => {
        const pct = ((opts.state.val - opts.min) / (opts.max - opts.min)) * 100;
        return `--fill: ${Math.min(100, Math.max(0, pct))}%`;
      },
      oninput: (e: Event) => opts.onChange(parseFloat((e.target as HTMLInputElement).value)),
    }),
  );

// ============================================================================
// Roast lifecycle
// ============================================================================
function toggleRoastStart() {
  switch (state.val.currentState.status) {
    case RoasterStatus.idle:
      state.val = {
        ...state.val,
        currentState: { ...state.val.currentState, status: RoasterStatus.roasting },
        roast: { startDate: new Date(), measurements: [], events: [], commands: [] },
      };
      appendEvent("charge");
      break;
    case RoasterStatus.roasting:
      triggerDrop();
      break;
  }
}

function triggerDrop() {
  if (!isRoasting()) return;
  appendEvent("drop");
  state.val = {
    ...state.val,
    currentState: { ...state.val.currentState, status: RoasterStatus.cooling },
  };
  updateFanPower(cooldownFanSpeed.val);
  updateHeaterPower(0);
  slider1Value.val = cooldownFanSpeed.val;
  slider2Value.val = 0;
}

// Auto-idle when BT drops below 50 °C during cool-down
van.derive(() => {
  const m = lastMessage.val;
  if (!isCooling()) return;
  if (m && typeof m.BT === "number" && m.BT < 50) {
    sendCommand({ id: 1, command: "allOff" });
    slider1Value.val = 0;
    slider2Value.val = 0;
    state.val = {
      ...state.val,
      currentState: { ...state.val.currentState, status: RoasterStatus.idle },
    };
  }
});

// ============================================================================
// App layout
// ============================================================================
const { details, summary } = van.tags;

const createApp = () =>
  div(
    { class: "dashboard" },

    // Top bar
    header(
      { class: "topbar" },
      div({ class: "topbar-brand" }, span({ class: "topbar-logo" }, "☕")),
      div(
        { class: "topbar-status" },
        span({
          class: "conn-dot",
          style: () =>
            `background:${connectionStatus.val === "Connected" ? "var(--success)" : connectionStatus.val === "Error" ? "var(--danger)" : "var(--warning)"}`,
        }),
        span({ class: "conn-text" }, () => connectionStatus.val),
      ),
      div({ class: "topbar-clock" }, () => state.val.roast ? RoastTime() : "00:00"),
      div(
        { class: "topbar-actions" },
        button({
          class: "btn-action btn-start",
          disabled: () => !isIdle(),
          onclick: toggleRoastStart,
        }, "Start\nRoast"),
        button({
          class: "btn-action btn-end",
          disabled: () => isIdle(),
          onclick: toggleRoastStart,
        }, "End\nRoast"),
        button({ class: "btn-action btn-cool",   onclick: coolDown       }, "Cool\nDown"),
        button({ class: "btn-action btn-reset",  onclick: () => resetRoast() }, "Clear\nReset"),
        button({ class: "btn-action btn-alloff", onclick: allOff        }, "All\nOff"),
      ),
    ),

    // Chart + readings sidebar
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
            ReadingCard("Inlet Air",   () => fmtTemp(currentMessage.val?.ET),  "C"),
            ReadingCard("Bean",        () => fmtTemp(currentMessage.val?.BT),  "C"),
            ReadingCard("IR Surface",  () => fmtTemp(currentMessage.val?.CH3), "C"),
            ReadingCard("ROR", () => currentROR.val != null ? currentROR.val.toFixed(1) : "—", "°C/min"),
          ),
        ),
      ),
    ),

    // Controls
    div(
      { class: "dashboard-card controls-area" },
      div(
        { class: "panel-section" },
        div(
          { class: "controls-row" },
          Slider({
            label: "Heater Power", unit: "%", state: slider2Value, min: 0, max: 100, step: 5,
            disabled: () => !canRunHeater(),
            onChange: (v) => { noteUserHeaterEdit(); slider2Value.val = v; updateHeaterPower(v); },
          }),
          () => {
            if (fanMode.val === "ssr") {
              return div(
                { class: "control" },
                div(
                  { class: "control-header" },
                  span({ class: "control-label" }, "Fan"),
                  span({ class: "control-value" }, () => slider1Value.val > 0 ? "ON" : "OFF"),
                ),
                button({
                  class: () => `toggle ${slider1Value.val > 0 ? "active" : ""}`,
                  onclick: () => {
                    noteUserFanEdit();
                    const next = slider1Value.val > 0 ? 0 : 100;
                    slider1Value.val = next;
                    updateFanPower(next);
                  },
                }),
              );
            }
            return Slider({
              label: "Fan Power", unit: "%", state: slider1Value, min: 0, max: 100, step: 5,
              onChange: (v) => { noteUserFanEdit(); slider1Value.val = v; updateFanPower(v); },
            });
          },
        ),
      ),
    ),

    // Roast name + download row
    div(
      { class: "dashboard-card roast-name-row" },
      RoastTitle,
      div({ class: "roast-name-actions" }, DownloadButton, DownloadChartButton, SaveToDeviceButton),
    ),

    // Events
    div(
      { class: "dashboard-card events-area" },
      div(
        { class: "panel-section" },
        div({ class: "panel-title" }, "Events"),
        div(
          { class: "event-grid" },
          button({ class: "event-btn event-charge",    onclick: () => appendEvent("charge")             }, "Charge"),
          button({ class: "event-btn event-dry",       onclick: () => appendEvent("dry-end")            }, "Dry End"),
          button({ class: "event-btn event-crack1",    onclick: () => appendEvent("first-crack-start")  }, "1st Crack"),
          button({ class: "event-btn event-crack1-end",onclick: () => appendEvent("first-crack-end")    }, "1st End"),
          button({ class: "event-btn event-crack2",    onclick: () => appendEvent("second-crack-start") }, "2nd Crack"),
          button({ class: "event-btn event-drop",      onclick: () => appendEvent("drop")               }, "Drop"),
        ),
      ),
    ),

    // Settings
    div(
      { class: "settings-row" },
      details(
        { class: "settings-panel" },
        summary({ class: "settings-summary" }, "Device Settings"),
        DeviceSettings,
      ),
      details(
        { class: "settings-panel" },
        summary({ class: "settings-summary" }, "WiFi"),
        div(
          { class: "wifi-form" },
          input({ type: "text",     class: "form-input", placeholder: "SSID",     oninput: (e: Event) => (wifiSSID.val = (e.target as HTMLInputElement).value) }),
          input({ type: "password", class: "form-input", placeholder: "Password", oninput: (e: Event) => (wifiPass.val  = (e.target as HTMLInputElement).value) }),
          button({ onclick: updateWifi }, "Save"),
        ),
        () => wifiMessage.val
          ? div({ class: `status-message ${wifiMessage.val.startsWith("Error") ? "error" : "success"}` }, wifiMessage.val)
          : null,
      ),
      details(
        { class: "settings-panel" },
        summary({ class: "settings-summary" }, "Saved Roasts"),
        div({ class: "roast-io" }, UploadButton),
        SavedRoastsList,
        UploadRoastInput,
      ),
    ),

    // Crack tuner — full-width, collapsed by default
    details(
      { class: "settings-panel" },
      summary({ class: "settings-summary" }, "Crack Tuner"),
      CrackTuner,
    ),
  );

export const roastApp = createApp;
