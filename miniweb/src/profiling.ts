import van from "vanjs-core";
const { label, button, div, input, select, option, canvas, p, span } = van.tags;

import { Profile, RoastState } from "./model";

export const profile = van.state<Profile | undefined>();
export const followProfileEnabled = van.state(true);
const profileName = van.state("");

export function followProfile(
  profile: Profile,
  roast: RoastState,
): { setPoint: number, fanValue?: number } | undefined {
  if (!roast.startDate) return undefined;

  const elapsedTime = (new Date().getTime() - roast.startDate.getTime()) / 1000; // Elapsed time in seconds
  let accumulatedTime = 0;

  for (const step of profile.steps) {
    accumulatedTime += step.duration;
    if (elapsedTime <= accumulatedTime) {
      // We're in this step
      const stepStartTime = accumulatedTime - step.duration;
      const progress = (elapsedTime - stepStartTime) / step.duration;

      // Interpolate setpoint
      const prevSetpoint =
        stepStartTime === 0
          ? profile.steps[0].setpoint
          : profile.steps.find((s, i) => profile.steps[i + 1] === step)
            ?.setpoint || step.setpoint;
      const nextSetpoint = step.setpoint;

      return {
        setPoint: (
          Math.floor(
            interpolateSetpoint(
              prevSetpoint,
              nextSetpoint,
              progress,
              step.interpolation,
            ) * 10,
          ) / 10
        ),
        fanValue: step.fanValue
      };
    }
  }

  // If no valid step is found, return last setpoint
  return profile.steps.length > 0
    ? {
      setPoint: profile.steps[profile.steps.length - 1].setpoint,
      fanValue: profile.steps[profile.steps.length - 1].fanValue
    }
    : undefined;
}

function interpolateSetpoint(
  start: number,
  end: number,
  progress: number,
  type: "linear" | "ease-in" | "ease-out" | "ease-in-out",
): number {
  switch (type) {
    case "linear":
      return start + (end - start) * progress;
    case "ease-in":
      return start + (end - start) * Math.pow(progress, 2);
    case "ease-out":
      return start + (end - start) * (1 - Math.pow(1 - progress, 2));
    case "ease-in-out":
      return (
        start +
        (end - start) *
        (progress < 0.5
          ? 2 * Math.pow(progress, 2)
          : 1 - Math.pow(-2 * progress + 2, 2) / 2)
      );
    default:
      return end;
  }
}

interface SavedProfile {
  name: string;
  size: number;
}
const savedProfiles = van.state<SavedProfile[]>([]);
const profileMessage = van.state("");

async function refreshSavedProfiles() {
  try {
    const r = await fetch("/api/profile/list");
    if (r.ok) {
      const data = await r.json();
      savedProfiles.val = data.profiles || [];
    }
  } catch (e) {
    console.error("Failed to list profiles:", e);
  }
}

async function saveProfileToDevice() {
  if (!profile.val) {
    alert("No profile loaded");
    return;
  }
  const name = (profileName.val || "profile").replace(/\.json$/i, "");
  profileMessage.val = "Saving…";
  try {
    const r = await fetch(
      `/api/profile/save?name=${encodeURIComponent(name)}`,
      {
        method: "POST",
        body: JSON.stringify(profile.val),
        headers: { "Content-Type": "application/json" },
      },
    );
    if (r.ok) {
      profileMessage.val = "✓ Saved";
      refreshSavedProfiles();
    } else {
      const text = await r.text();
      profileMessage.val = `✗ ${text}`;
    }
    setTimeout(() => (profileMessage.val = ""), 3000);
  } catch (e) {
    profileMessage.val = `✗ ${(e as Error).message}`;
    setTimeout(() => (profileMessage.val = ""), 3000);
  }
}

async function loadProfileFromDevice(name: string) {
  try {
    const r = await fetch(`/api/profile/load?name=${encodeURIComponent(name)}`);
    if (!r.ok) {
      alert("Failed to load profile");
      return;
    }
    const json = await r.json();
    const loaded = loadProfileFromJSON(json);
    if (!loaded) {
      alert("Profile on device is malformed");
      return;
    }
    profileName.val = loaded.name ?? name;
    profile.val = loaded.profile;
  } catch (e) {
    alert(`Error loading profile: ${(e as Error).message}`);
  }
}

async function deleteProfileFromDevice(name: string) {
  if (!confirm(`Delete "${name}"?`)) return;
  try {
    const r = await fetch(
      `/api/profile/delete?name=${encodeURIComponent(name)}`,
      { method: "DELETE" },
    );
    if (r.ok) refreshSavedProfiles();
    else alert("Failed to delete profile");
  } catch (e) {
    alert(`Error deleting profile: ${(e as Error).message}`);
  }
}

const SavedProfilesList = () => {
  van.derive(() => {
    if (savedProfiles.val.length === 0) refreshSavedProfiles();
  });
  return div(
    { class: "saved-profiles" },
    () =>
      savedProfiles.val.length === 0
        ? div(
            { style: "font-size: 0.75rem; color: var(--text-3);" },
            "No saved profiles",
          )
        : div(
            { style: "display: flex; flex-direction: column; gap: 4px;" },
            ...savedProfiles.val.map((sp) =>
              div(
                {
                  style:
                    "display: flex; gap: 4px; font-size: 0.75rem; align-items: center;",
                },
                button(
                  {
                    onclick: () => loadProfileFromDevice(sp.name),
                    style: "flex: 1; padding: 0.25rem 0.5rem; font-size: 0.75rem; text-align: left;",
                  },
                  sp.name,
                ),
                button(
                  {
                    onclick: () => deleteProfileFromDevice(sp.name),
                    style:
                      "padding: 0.25rem 0.5rem; background: var(--danger); color: var(--bg-0); border-color: var(--danger); font-size: 0.75rem;",
                  },
                  "✕",
                ),
              ),
            ),
          ),
  );
};

export const ProfileControl = () =>
  div(
    div(
      { style: "display: flex; align-items: center; gap: 8px; flex-wrap: wrap;" },
      span({ style: "font-size: 0.75rem; color: var(--text-2);" }, "Profile:"),
      span(
        { style: "font-weight: 600; font-size: 0.8125rem;" },
        () => (profile.val ? profileName.val : "(none)"),
      ),
    ),
    div(
      { style: "display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap;" },
      UploadProfileInput,
      button(
        {
          onclick: () => {
            const fileInput = document.getElementById("profileInput");
            fileInput?.click();
          },
        },
        "Load File",
      ),
      button(
        { onclick: saveProfileToDevice, disabled: () => !profile.val },
        "Save to Device",
      ),
      button(
        { onclick: () => { profile.val = undefined; profileName.val = ""; } },
        "Clear",
      ),
    ),
    () =>
      profileMessage.val
        ? div(
            {
              style:
                "font-size: 0.75rem; color: var(--text-1); margin-top: 4px;",
            },
            profileMessage.val,
          )
        : null,
    div(
      { style: "margin-top: 10px;" },
      div(
        {
          style:
            "font-size: 0.625rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-3); margin-bottom: 6px;",
        },
        "Device Storage",
      ),
      SavedProfilesList,
    ),
  );

type HeaterPhase = { time: number; temperature: number };
type FanPhase = { time: number; fanSpeed: number };

function fanAtTime(fans: FanPhase[], t: number): number | undefined {
  if (!fans || fans.length === 0) return undefined;
  let last = fans[0];
  for (const f of fans) {
    if (f.time <= t) last = f;
    else break;
  }
  return last.fanSpeed;
}

// Convert the "phased" profile format ({heaterPhases, fanPhases}) to the
// internal Profile (steps[]) used by followProfile().
function phasedToProfile(p: any): Profile {
  const heater: HeaterPhase[] = p.heaterPhases || [];
  const fan: FanPhase[] = p.fanPhases || [];
  if (heater.length === 0) return { steps: [] };

  const steps = [];
  // Brief anchor step at the starting temperature so followProfile has a
  // previous setpoint to ramp from.
  steps.push({
    interpolation: "linear" as const,
    setpoint: heater[0].temperature,
    duration: 0.01,
    fanValue: fanAtTime(fan, heater[0].time),
  });
  for (let i = 1; i < heater.length; i++) {
    const duration = heater[i].time - heater[i - 1].time;
    if (duration <= 0) continue;
    steps.push({
      interpolation: "linear" as const,
      setpoint: heater[i].temperature,
      duration,
      fanValue: fanAtTime(fan, heater[i].time),
    });
  }
  return { steps };
}

function loadProfileFromJSON(data: any): { profile: Profile; name?: string } | null {
  if (data && Array.isArray(data.steps)) {
    return { profile: data as Profile, name: data.name };
  }
  if (data && Array.isArray(data.heaterPhases)) {
    return { profile: phasedToProfile(data), name: data.name };
  }
  return null;
}

const UploadProfileInput = () => {
  const fileInput = input({
    type: "file",
    id: "profileInput",
    accept: "application/json",
    style: "display: none;",
  });
  fileInput.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement | null;
    const file = target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const jsonData = JSON.parse(text);
        const loaded = loadProfileFromJSON(jsonData);
        if (!loaded) {
          throw new Error(
            "Profile must have either a 'steps' array (legacy) or a 'heaterPhases' array.",
          );
        }
        profileName.val = loaded.name ?? file.name;
        profile.val = loaded.profile;
        console.log("Profile loaded:", profileName.val, loaded.profile);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("Profile upload failed:", msg);
        alert(`Failed to load profile: ${msg}`);
      }
    };
    reader.readAsText(file);
  });

  return fileInput;
};
