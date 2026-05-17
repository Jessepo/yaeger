import "./style.css";
import van from "vanjs-core";
import { initializeChart, updateChart } from "./chart";
import {
  YaegerMessage,
  YaegerState,
  Measurement,
  RoasterStatus,
  RoastState,
  Profile,
} from "./model.ts";
import { getFormattedTimeDifference } from "./util.ts";
import { PIDController } from "./pid.ts";
import {
  followProfile,
  followProfileEnabled,
  profile,
  ProfileControl,
} from "./profiling.ts";
import { socket, lastMessage, lastUpdate } from "./websocket";

const { label, button, div, input, select, option, canvas, p, span } = van.tags;

// State variables
const slider1Value = van.state(50);
const slider2Value = van.state(50);
const state = van.state(new YaegerState());

const setpoint = van.state(20);
const pidPFactor = van.state(1.0);
const pidIFactor = van.state(0.1);
const pidDFactor = van.state(0.01);
var pid = new PIDController(1.0, 0.1, 0.01);

// Saved roasts storage
interface SavedRoast {
  name: string;
  size: number;
}
const savedRoasts = van.state<SavedRoast[]>([]);

// Chart.js setup
const chartElement = canvas({ id: "liveChart" });
const ctx = chartElement.getContext("2d") as CanvasRenderingContext2D;

const chart = initializeChart(ctx);

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
    console.log("Processing new message:", message);
    
    // Update UI elements directly
    console.log("Updating sliders:", {
      fan: message.FanVal,
      heater: message.BurnerVal
    });
    slider1Value.val = message.FanVal;
    slider2Value.val = message.BurnerVal;
    
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
              enabled: pidEnabled.val,
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
          if (profileUpdate.fanValue != undefined) {
            slider1Value.val = profileUpdate.fanValue!
            updateFanPower(profileUpdate.fanValue!)
          }
        }
      }
      controlHeater();
    }

    // Update state atomically
    console.log("Applying state update");
    state.val = newState;
    console.log("State updated:", state.val);
  }
});

// Slider change handler
const onSliderChange = (slider: string, value: number) => {
  console.log("slider: ", JSON.stringify({ slider, value }));
  switch (slider) {
    case "slider1":
      updateFanPower(value);
      break;
    case "slider2":
      updateHeaterPower(value);
      break;
    default:
      break;
  }
};

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
    const c =
      state.val.currentState.status == RoasterStatus.idle &&
      (state.val.roast?.measurements.length ?? 0) > 0;
    return !c;
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
        disabled: () => state.val.currentState.status !== RoasterStatus.idle || (state.val.roast?.measurements.length ?? 0) === 0,
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

  return div(fileInput);
};

// Update setpoint through a slider or input
const SetpointControl = () =>
  div(
    "Setpoint (°C): ",
    () => setpoint.val,
    input({
      type: "range",
      min: "0",
      max: "300",
      disabled: followProfileEnabled.val,
      value: setpoint,
      oninput: (e: Event) => {
        setpoint.val = parseInt((e.target as HTMLInputElement).value, 10);
      },
    }),
  );

let tempP = pidPFactor.val;
let tempI = pidIFactor.val;
let tempD = pidDFactor.val;

let tempTarget = "BT";
const pidEnabled = van.state(true);

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
async function loadRoastFromDevice(roastName: string) {
  try {
    const response = await fetch(`/api/roast/load?name=${encodeURIComponent(roastName)}`);
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
      alert("Failed to load roast");
    }
  } catch (error) {
    console.error("Failed to load roast:", error);
    alert("Error loading roast");
  }
}

// Delete a roast from device storage
async function deleteRoastFromDevice(roastName: string) {
  if (!confirm(`Delete "${roastName}"?`)) return;
  
  try {
    const response = await fetch(`/api/roast/delete?name=${encodeURIComponent(roastName)}`, {
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
                  roast.name,
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
    "PID Factors",
    p(),
    "P:",
    input({
      type: "number",
      value: tempP,
      oninput: (e: Event) => {
        tempP = parseFloat((e.target as HTMLInputElement).value) || 0;
      },
    }),
    "I:",
    input({
      type: "number",
      value: tempI,
      oninput: (e: Event) => {
        tempI = parseFloat((e.target as HTMLInputElement).value) || 0;
      },
    }),
    "D:",
    input({
      type: "number",
      value: tempD,
      oninput: (e: Event) => {
        tempD = parseFloat((e.target as HTMLInputElement).value) || 0;
      },
    }),
    p(),
    "Target:",
    select(
      {
        value: tempTarget,
        onchange: (e: Event) => {
          tempTarget = (e.target as HTMLSelectElement).value;
        },
      },
      option({ value: "BT" }, "BT"),
      option({ value: "ET" }, "ET"),
    ),
    p(),
    button(
      {
        onclick: () => {
          pidPFactor.val = tempP;
          pidIFactor.val = tempI;
          pidDFactor.val = tempD;

          pid = new PIDController(
            pidPFactor.val,
            pidIFactor.val,
            pidDFactor.val,
          );
          console.log("New PID values set:", {
            P: pidPFactor.val,
            I: pidIFactor.val,
            D: pidDFactor.val,
          });
          console.log("PID:", JSON.stringify(pid));
        },
      },
      "Apply pid",
    ),
    label(
      input({
        type: "checkbox",
        checked: pidEnabled.val,
        oninput: (e) => (pidEnabled.val = e.target.checked),
      }),
      "PID Enabled",
    ),
  );

function controlHeater() {
  let currentTemp: number;
  if (tempTarget == "BT") {
    currentTemp = state.val.currentState.lastMessage?.BT ?? 0;
  } else {
    currentTemp = state.val.currentState.lastMessage?.ET ?? 0;
  }
  const output = pid.compute(setpoint.val, currentTemp);

  // Clamp output to 0–100% range
  const heaterPower = Math.min(100, Math.max(0, Math.round(output)));

  if (pidEnabled.val == false) {
    return;
  }
  updateHeaterPower(heaterPower);
  slider2Value.val = heaterPower; // Reflect change in the UI
}

// UI creation - Sidebar Layout
const createApp = () => div(
  { class: "roast-container" },
  // Main content area with graph
  div(
    { class: "roast-main" },
    // Header with status and controls
    div(
      { class: "roast-header" },
      div(
        { class: "roast-status" },
        button(
          {
            onclick: () => toggleRoastStart(),
          },
          () => {
            return state.val.currentState.status == RoasterStatus.idle
              ? "🔥 Start"
              : "⏹ Stop";
          },
        ),
        span(
          { class: "roast-time" },
          () => {
            return state.val.roast != undefined ? RoastTime() : "00:00";
          },
        ),
      ),
      div(
        { style: "display: flex; gap: 0.5rem; flex-wrap: wrap;" },
        DownloadButton,
        SaveToDeviceButton,
        UploadButton,
      ),
    ),
    // Chart
    chartElement,
  ),
  // Sidebar with controls
  div(
    { class: "roast-sidebar" },
    // Current readings
    div(
      { class: "sidebar-section" },
      div({ class: "sidebar-title" }, "Current Readings"),
      div(
        { class: "sensor-readout" },
        div(
          { class: "sensor-box" },
          div({ class: "sensor-box-label" }, "Exhaust Temp"),
          div(
            { class: "sensor-box-value" },
            () => `${currentMessage.val?.ET ?? "—"}°C`,
          ),
        ),
        div(
          { class: "sensor-box" },
          div({ class: "sensor-box-label" }, "Bean Temp"),
          div(
            { class: "sensor-box-value" },
            () => `${currentMessage.val?.BT ?? "—"}°C`,
          ),
        ),
      ),
    ),
    // Setpoint control
    div(
      { class: "sidebar-section" },
      div(
        { class: "sidebar-control" },
        div({ class: "sidebar-label" }, "Setpoint (°C)"),
        div(
          { class: "sidebar-value" },
          () => setpoint.val,
        ),
        input({
          type: "range",
          min: "0",
          max: "300",
          disabled: followProfileEnabled.val,
          value: setpoint,
          oninput: (e: Event) => {
            setpoint.val = parseInt((e.target as HTMLInputElement).value, 10);
          },
        }),
      ),
    ),
    // Fan control
    div(
      { class: "sidebar-section" },
      div(
        { class: "sidebar-control" },
        div({ class: "sidebar-label" }, "Fan Power"),
        div(
          { class: "sidebar-value" },
          () => `${slider1Value.val}%`,
        ),
        input({
          type: "range",
          min: "0",
          max: "100",
          step: "5",
          value: () => slider1Value.val,
          oninput: (e: Event) => {
            const target = e.target as HTMLInputElement;
            slider1Value.val = parseInt(target.value, 10);
            onSliderChange("slider1", slider1Value.val);
          },
        }),
      ),
    ),
    // Heater control
    div(
      { class: "sidebar-section" },
      div(
        { class: "sidebar-control" },
        div({ class: "sidebar-label" }, "Heater Power"),
        div(
          { class: "sidebar-value" },
          () => `${slider2Value.val}%`,
        ),
        input({
          type: "range",
          min: "0",
          max: "100",
          step: "5",
          disabled: () => pidEnabled.val,
          value: () => slider2Value.val,
          oninput: (e: Event) => {
            const target = e.target as HTMLInputElement;
            slider2Value.val = parseInt(target.value, 10);
            onSliderChange("slider2", slider2Value.val);
          },
        }),
      ),
    ),
    // Event markers
    div(
      { class: "sidebar-section" },
      div({ class: "sidebar-title" }, "Events"),
      div(
        { class: "event-buttons" },
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
          { onclick: () => appendEvent("second-crack start") },
          "2nd Crack",
        ),
        button(
          { onclick: () => appendEvent("second-crack-end") },
          "2nd End",
        ),
        button({ onclick: () => appendEvent("drop") }, "Drop"),
      ),
    ),
    // PID section
    div(
      { class: "sidebar-section" },
      div({ class: "sidebar-title" }, "PID Settings"),
      PIDConfig,
    ),
    // Saved roasts
    SavedRoastsList,
    // Profile section
    div(
      { class: "sidebar-section" },
      div({ class: "sidebar-title" }, "Profile"),
      ProfileControl,
    ),
    // Upload input
    UploadRoastInput,
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
