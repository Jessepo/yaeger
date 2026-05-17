import "./style.css";
import van from "vanjs-core";
import { roastApp } from "./roast";
import { profile, ProfileControl } from "./profiling.ts";
import { PIDController } from "./pid.ts";
import { connectionStatus, lastMessage, lastUpdate } from "./websocket";

const { button, div, input, span, h1, h2, section, label } = van.tags;

// ============================================================================
// State Management
// ============================================================================

const pidPFactor = van.state(1.0);
const pidIFactor = van.state(0.1);
const pidDFactor = van.state(0.01);

const ssidField = van.state("");
const passField = van.state("");
const wifiUpdateMessage = van.state("");

// ============================================================================
// Utilities
// ============================================================================

const getConnectionColor = () => {
  switch (connectionStatus.val) {
    case "Connected":
      return "#10b981";
    case "Error":
      return "#ef4444";
    default:
      return "#f59e0b";
  }
};

const updateWifiSettings = async () => {
  const ssid = ssidField.val;
  const pass = passField.val;

  if (!ssid.trim()) {
    wifiUpdateMessage.val = "SSID cannot be empty";
    return;
  }

  wifiUpdateMessage.val = "Updating...";

  try {
    const response = await fetch(
      `http://${location.host}/api/wifi?ssid=${encodeURIComponent(ssid)}&pass=${encodeURIComponent(pass)}`,
    );
    if (response.ok) {
      wifiUpdateMessage.val =
        "Settings updated! Device will restart with new settings.";
      setTimeout(() => {
        wifiUpdateMessage.val = "";
      }, 5000);
    } else {
      wifiUpdateMessage.val = `Error: HTTP ${response.status}`;
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      wifiUpdateMessage.val = `Error: ${error.message}`;
    } else {
      wifiUpdateMessage.val = "An unknown error occurred";
    }
  }
};

// ============================================================================
// Component: Number Input
// ============================================================================

const NumberInput = (
  props: {
    label: string;
    value: any;
    onChange: (val: number) => void;
    min?: number;
    max?: number;
    step?: number;
  },
) =>
  div(
    { class: "form-group" },
    label({ class: "form-label" }, props.label),
    input({
      type: "number",
      class: "form-input",
      value: () => props.value.val,
      min: props.min ?? 0,
      step: props.step ?? 0.01,
      oninput: (e: Event) => {
        props.onChange(parseFloat((e.target as HTMLInputElement).value) || 0);
      },
    }),
  );

// ============================================================================
// Component: Text Input
// ============================================================================

const TextInput = (
  props: {
    label: string;
    type?: string;
    value: any;
    onChange: (val: string) => void;
    placeholder?: string;
  },
) =>
  div(
    { class: "form-group" },
    label({ class: "form-label" }, props.label),
    input({
      type: props.type ?? "text",
      class: "form-input",
      placeholder: props.placeholder ?? "",
      value: () => props.value.val,
      oninput: (e: Event) => {
        props.onChange((e.target as HTMLInputElement).value);
      },
    }),
  );

// ============================================================================
// Component: Connection Status
// ============================================================================

const ConnectionStatus = () =>
  div(
    { class: "status-card" },
    div({ class: "status-header" }, "Connection Status"),
    div(
      { class: "status-content" },
      span(
        {
          class: "status-badge",
          style: () => `background-color: ${getConnectionColor()}`,
        },
        () => connectionStatus.val,
      ),
    ),
  );

// ============================================================================
// Component: Sensor Data
// ============================================================================

const SensorData = () =>
  div(
    { class: "status-card" },
    div({ class: "status-header" }, "Current Readings"),
    div(
      { class: "sensor-grid" },
      div({ class: "sensor-item" },
        div({ class: "sensor-label" }, "Exhaust Temp"),
        div({ class: "sensor-value" }, () => `${lastMessage.val?.ET ?? "N/A"}°C`),
      ),
      div({ class: "sensor-item" },
        div({ class: "sensor-label" }, "Bean Temp"),
        div({ class: "sensor-value" }, () => `${lastMessage.val?.BT ?? "N/A"}°C`),
      ),
      div({ class: "sensor-item" },
        div({ class: "sensor-label" }, "Updated"),
        div(
          { class: "sensor-value" },
          () => lastUpdate.val?.toLocaleTimeString() ?? "N/A",
        ),
      ),
    ),
  );

// ============================================================================
// Component: PID Settings
// ============================================================================

const PIDSettings = () =>
  section(
    { class: "settings-section" },
    h2({ class: "section-title" }, "PID Settings"),
    div(
      { class: "settings-grid" },
      NumberInput({
        label: "P Factor (Proportional)",
        value: pidPFactor,
        onChange: (val) => {
          pidPFactor.val = val;
        },
        step: 0.1,
      }),
      NumberInput({
        label: "I Factor (Integral)",
        value: pidIFactor,
        onChange: (val) => {
          pidIFactor.val = val;
        },
        step: 0.01,
      }),
      NumberInput({
        label: "D Factor (Derivative)",
        value: pidDFactor,
        onChange: (val) => {
          pidDFactor.val = val;
        },
        step: 0.001,
      }),
    ),
  );

// ============================================================================
// Component: WiFi Settings
// ============================================================================

const WifiSettings = () =>
  section(
    { class: "settings-section" },
    h2({ class: "section-title" }, "WiFi Settings"),
    div(
      { class: "settings-grid" },
      TextInput({
        label: "Network SSID",
        value: ssidField,
        onChange: (val) => {
          ssidField.val = val;
        },
        placeholder: "Enter network name",
      }),
      TextInput({
        label: "Password",
        type: "password",
        value: passField,
        onChange: (val) => {
          passField.val = val;
        },
        placeholder: "Leave empty if no password",
      }),
    ),
    button(
      {
        class: "btn btn-primary btn-block",
        onclick: updateWifiSettings,
      },
      "Update WiFi Settings",
    ),
    () =>
      wifiUpdateMessage.val
        ? div(
            {
              class: `status-message ${wifiUpdateMessage.val.includes("Error") ? "error" : "success"}`,
            },
            wifiUpdateMessage.val,
          )
        : null,
  );

// ============================================================================
// Component: Profile Selection
// ============================================================================

const ProfileSection = () =>
  section(
    { class: "settings-section" },
    h2({ class: "section-title" }, "Roasting Profile"),
    ProfileControl,
  );

// ============================================================================
// Component: Main Application
// ============================================================================

const startPage = div(
  { class: "app-container" },
  div(
    { class: "app-header" },
    h1({ class: "app-title" }, "☕ Yaeger Roaster"),
    div({ class: "header-subtitle" }, "Coffee Roasting Controller"),
  ),
  div(
    { class: "app-content" },
    div({ class: "status-section" },
      ConnectionStatus,
      SensorData,
    ),
    ProfileSection,
    PIDSettings,
    WifiSettings,
    div(
      { class: "action-section" },
      button(
        {
          class: "btn btn-success btn-large",
          onclick: () => {
            document.getElementById("app")!.innerHTML = "";
            van.add(document.getElementById("app")!, roastApp());
          },
        },
        "🔥 Start Roasting",
      ),
    ),
  ),
);

// ============================================================================
// Mount Application
// ============================================================================

van.add(document.getElementById("app")!, startPage);
