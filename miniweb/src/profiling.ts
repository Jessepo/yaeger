import van from "vanjs-core";
const { label, button, div, input, select, option, canvas, p, span, table, thead, tbody, tr, th, td } = van.tags;

import { Profile, ProfileStep, RoastState } from "./model";
import { sgSmooth, computeSGKernel } from "./chart";

export const profile = van.state<Profile | undefined>();
export const followProfileEnabled = van.state(true);
export const profileName = van.state("");
// Bumped each time a profile is loaded from an external source (file
// upload, device load, → Profile from a roast).  Subscribers (roast.ts)
// use this to trigger a roast reset + auto-enable PID.  Editor edits do
// NOT bump this — only fresh loads do.
export const profileLoadTick = van.state(0);

export function followProfile(
  profile: Profile,
  roast: RoastState,
): { setPoint: number, fanValue?: number } | undefined {
  if (!roast.startDate) return undefined;

  const elapsedTime = (new Date().getTime() - roast.startDate.getTime()) / 1000; // Elapsed time in seconds
  let accumulatedTime = 0;

  for (let idx = 0; idx < profile.steps.length; idx++) {
    const step = profile.steps[idx];
    accumulatedTime += step.duration;
    if (elapsedTime <= accumulatedTime) {
      // We're in this step
      const stepStartTime = accumulatedTime - step.duration;
      const progress = step.duration > 0 ? (elapsedTime - stepStartTime) / step.duration : 1;

      // Interpolate setpoint
      const prevSetpoint = idx === 0 ? step.setpoint : profile.steps[idx - 1].setpoint;
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
    profileLoadTick.val++;
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

// ============================================================================
// Profile point editor
// Editing the duration-based Profile.steps schema in place is awkward (moving
// a point in time requires recomputing two neighbouring durations), so we
// convert to an absolute-time "ProfilePoint" representation for the editor,
// then derive Profile.steps back out when committing changes.
// ============================================================================

export type ProfilePoint = {
  time: number; // seconds from roast start
  setpoint: number;
  fan?: number;
};

export function pointsFromProfile(p: Profile): ProfilePoint[] {
  if (p.steps.length === 0) return [];
  const out: ProfilePoint[] = [];
  // First step is the anchor: an instant value at t=0.
  out.push({ time: 0, setpoint: p.steps[0].setpoint, fan: p.steps[0].fanValue });
  let t = p.steps[0].duration; // typically 0.01 from the phased converter
  for (let i = 1; i < p.steps.length; i++) {
    t += p.steps[i].duration;
    out.push({ time: t, setpoint: p.steps[i].setpoint, fan: p.steps[i].fanValue });
  }
  return out;
}

export function profileFromPoints(points: ProfilePoint[]): Profile {
  if (points.length === 0) return { steps: [] };
  const sorted = [...points].sort((a, b) => a.time - b.time);
  const steps: ProfileStep[] = [
    {
      interpolation: "linear",
      setpoint: sorted[0].setpoint,
      duration: 0.01,
      fanValue: sorted[0].fan,
    },
  ];
  for (let i = 1; i < sorted.length; i++) {
    let duration = sorted[i].time - sorted[i - 1].time;
    if (i === 1) {
      duration = Math.max(0.01, duration - 0.01);
    }
    if (duration <= 0) continue; // skip duplicate / out-of-order timestamps
    steps.push({
      interpolation: "linear",
      setpoint: sorted[i].setpoint,
      duration,
      fanValue: sorted[i].fan,
    });
  }
  return { steps };
}

function fmtTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.round(secs - m * 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function parseTime(s: string): number | null {
  s = s.trim();
  if (s === "") return null;
  if (s.includes(":")) {
    const parts = s.split(":");
    const m = parseInt(parts[0], 10);
    const sec = parseInt(parts[1], 10);
    if (isNaN(m) || isNaN(sec)) return null;
    return Math.max(0, m * 60 + sec);
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : Math.max(0, n);
}

// Working copy that drives the editor table. Externally-loaded profiles
// (file upload, device load, Clear) seed it via the van.derive below.
// Edits do NOT trigger a reset because we update lastSyncedProfile to match
// the new value before propagating to profile.val.
const editPoints = van.state<ProfilePoint[]>([]);
export const selectedPointIdx = van.state(-1);
export const selectedPointTime = van.derive<number | null>(() => {
  const idx = selectedPointIdx.val;
  const pts = editPoints.val;
  if (idx < 0 || idx >= pts.length) return null;
  return pts[idx].time;
});
let lastSyncedProfile: Profile | undefined = undefined;

van.derive(() => {
  const p = profile.val;
  if (p !== lastSyncedProfile) {
    lastSyncedProfile = p;
    const newPts = p ? pointsFromProfile(p) : [];
    editPoints.val = newPts;
    selectedPointIdx.val = newPts.length > 0 ? 0 : -1;
  }
});

function commitEdits(next: ProfilePoint[]) {
  editPoints.val = next;
  const newProfile = profileFromPoints(next);
  lastSyncedProfile = newProfile;
  profile.val = newProfile;
}

// Time bounds for the currently-selected point. Enforces chronological order
// of the points array so selection indices stay stable across adjustments.
function timeBoundsAt(pts: ProfilePoint[], idx: number): [number, number] {
  const minT = idx === 0 ? 0 : pts[idx - 1].time + 0.1;
  const maxT = idx === pts.length - 1 ? Number.POSITIVE_INFINITY : pts[idx + 1].time - 0.1;
  return [minT, maxT];
}

function adjustSelected(dim: "time" | "temp" | "fan", delta: number) {
  const idx = selectedPointIdx.val;
  const pts = editPoints.val;
  if (idx < 0 || idx >= pts.length) return;
  const pt = pts[idx];
  const next: ProfilePoint = { ...pt };
  if (dim === "time") {
    const [minT, maxT] = timeBoundsAt(pts, idx);
    next.time = Math.max(minT, Math.min(maxT, pt.time + delta));
  } else if (dim === "temp") {
    next.setpoint = Math.max(0, Math.min(300, pt.setpoint + delta));
  } else if (dim === "fan") {
    const current = pt.fan ?? 0;
    next.fan = Math.max(0, Math.min(100, current + delta));
  }
  const arr = [...pts];
  arr[idx] = next;
  commitEdits(arr);
}

function addPointAfterSelected() {
  const pts = editPoints.val;
  const sel = selectedPointIdx.val;
  let newPt: ProfilePoint;
  let insertIdx: number;
  if (pts.length === 0) {
    newPt = { time: 0, setpoint: 50, fan: 50 };
    insertIdx = 0;
  } else if (sel < 0 || sel >= pts.length - 1) {
    // Selection is the last point (or invalid) — append 60s past it.
    const last = pts[pts.length - 1];
    newPt = { time: last.time + 60, setpoint: last.setpoint, fan: last.fan };
    insertIdx = pts.length;
  } else {
    // Insert halfway between selected and next, averaging values.
    const a = pts[sel];
    const b = pts[sel + 1];
    newPt = {
      time: (a.time + b.time) / 2,
      setpoint: Math.round((a.setpoint + b.setpoint) / 2),
      fan: a.fan != null && b.fan != null ? Math.round((a.fan + b.fan) / 2) : a.fan ?? b.fan,
    };
    insertIdx = sel + 1;
  }
  const arr = [...pts.slice(0, insertIdx), newPt, ...pts.slice(insertIdx)];
  commitEdits(arr);
  selectedPointIdx.val = insertIdx;
}

function deleteSelected() {
  const idx = selectedPointIdx.val;
  const pts = editPoints.val;
  if (idx < 0 || idx >= pts.length) return;
  const arr = pts.filter((_, i) => i !== idx);
  commitEdits(arr);
  selectedPointIdx.val = arr.length === 0 ? -1 : Math.min(idx, arr.length - 1);
}

export const ProfileEditor = () =>
  div(
    { class: "profile-editor" },
    () => {
      const pts = editPoints.val;
      const sel = selectedPointIdx.val;
      if (pts.length === 0) {
        return div(
          { class: "profile-editor-empty" },
          "Load a profile to edit its points.",
          button(
            {
              class: "profile-editor-empty-add",
              onclick: addPointAfterSelected,
            },
            "+ Add first point",
          ),
        );
      }
      return div(
        { class: "profile-editor-row" },
        // Horizontal strip of point columns (time / temp / fan stacked).
        div(
          { class: "profile-cols-wrap" },
          div(
            { class: "profile-row-labels" },
            div({ class: "prow-label" }, "TIME"),
            div({ class: "prow-label" }, "°C"),
            div({ class: "prow-label" }, "FAN"),
          ),
          div(
            { class: "profile-cols" },
            ...pts.map((pt, idx) =>
              div(
                {
                  class: () =>
                    "profile-col" +
                    (selectedPointIdx.val === idx ? " selected" : ""),
                  onclick: () => {
                    selectedPointIdx.val = idx;
                  },
                },
                div({ class: "pcol-cell pcol-time" }, fmtTime(pt.time)),
                div({ class: "pcol-cell pcol-temp" }, String(Math.round(pt.setpoint))),
                div(
                  { class: "pcol-cell pcol-fan" },
                  pt.fan == null ? "—" : String(Math.round(pt.fan)),
                ),
              ),
            ),
          ),
        ),
        // Adjustment + add/delete panel — 3 rows total.
        div(
          { class: "profile-adjust" },
          // Left grid: 3 rows of (label, -, +)
          div(
            { class: "padj-grid" },
            span({ class: "padj-label" }, "Time"),
            button(
              { class: "padj-btn", onclick: () => adjustSelected("time", -30) },
              "−30s",
            ),
            button(
              { class: "padj-btn", onclick: () => adjustSelected("time", +30) },
              "+30s",
            ),
            span({ class: "padj-label" }, "Temp"),
            button(
              { class: "padj-btn", onclick: () => adjustSelected("temp", -1) },
              "−1°",
            ),
            button(
              { class: "padj-btn", onclick: () => adjustSelected("temp", +1) },
              "+1°",
            ),
            span({ class: "padj-label" }, "Fan"),
            button(
              { class: "padj-btn", onclick: () => adjustSelected("fan", -5) },
              "−5%",
            ),
            button(
              { class: "padj-btn", onclick: () => adjustSelected("fan", +5) },
              "+5%",
            ),
          ),
          // Right side: 3 stacked widgets aligned with the rows above
          div(
            { class: "padj-side" },
            div(
              { class: "padj-meta" },
              "Point ",
              span(
                { class: "padj-idx" },
                sel >= 0 ? `${sel + 1} / ${pts.length}` : "—",
              ),
            ),
            button(
              { class: "padj-add", onclick: addPointAfterSelected },
              "+ Add",
            ),
            button(
              {
                class: "padj-delete",
                onclick: deleteSelected,
                disabled: sel < 0,
              },
              "Delete",
            ),
          ),
        ),
      );
    },
  );

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
    let duration = heater[i].time - heater[i - 1].time;
    if (i === 1) {
      duration = Math.max(0.01, duration - 0.01);
    }
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
        profileLoadTick.val++;
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

// ============================================================================
// Convert a saved roast into a playable profile.  Workflow: smooth the
// recorded BT curve with a wide SG kernel, simplify to a sparse polyline
// via Ramer–Douglas–Peucker, then attach a fan timeline pulled from the
// roast's commands[] (or sampled FanVal as a fallback).
// ============================================================================

// Perpendicular distance from `pt` to the line through `a`–`b`.
function perpDistance(pt: [number, number], a: [number, number], b: [number, number]): number {
  const [px, py] = pt;
  const [ax, ay] = a;
  const [bx, by] = b;
  if (ax === bx && ay === by) return Math.hypot(px - ax, py - ay);
  const dx = bx - ax;
  const dy = by - ay;
  const norm = Math.hypot(dx, dy);
  return Math.abs(dy * px - dx * py + bx * ay - by * ax) / norm;
}

// Ramer–Douglas–Peucker polyline simplification.  Returns a subset of the
// input points such that none of the removed points sit further than
// `epsilon` (in the y-axis units) from the line connecting their
// neighbours in the reduced set.
export function rdpSimplify(
  points: [number, number][],
  epsilon: number,
): [number, number][] {
  if (points.length < 3) return points.slice();
  let maxDist = 0;
  let maxIdx = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDistance(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }
  if (maxDist > epsilon) {
    const left = rdpSimplify(points.slice(0, maxIdx + 1), epsilon);
    const right = rdpSimplify(points.slice(maxIdx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

export interface RoastToProfileOptions {
  epsilonC?: number;        // RDP tolerance in °C (default 2.5)
  smoothingWindow?: number; // SG window size, must be odd (default 61)
  trimToEvents?: boolean;   // clip to charge→drop if those events exist
}

export function roastToProfile(
  roast: RoastState,
  options: RoastToProfileOptions = {},
): ProfilePoint[] {
  const eps = options.epsilonC ?? 2.5;
  const win = options.smoothingWindow ?? 61;
  const trim = options.trimToEvents ?? true;

  if (!roast.measurements || roast.measurements.length === 0) return [];

  const startMs = roast.startDate.getTime();

  // Optional trim to charge → drop so the new profile is executable from
  // the moment beans go in, without the cold-start warmup.
  let trimStartSec = 0;
  let trimEndSec = Number.POSITIVE_INFINITY;
  if (trim && roast.events && roast.events.length > 0) {
    for (const e of roast.events) {
      const lbl = String(e.label).toLowerCase();
      const tSec = (e.measurement.timestamp.getTime() - startMs) / 1000;
      if (lbl.includes("charge")) trimStartSec = tSec;
      if (lbl === "drop" || lbl.startsWith("drop")) trimEndSec = tSec;
    }
  }

  // Gather (relative time, BT) within the trim window. Time origin = first
  // sample after trimStartSec so the profile starts at t=0.
  const times: number[] = [];
  const bts: number[] = [];
  for (const m of roast.measurements) {
    const tAbs = (m.timestamp.getTime() - startMs) / 1000;
    if (tAbs < trimStartSec || tAbs > trimEndSec) continue;
    times.push(tAbs - trimStartSec);
    bts.push(m.message.BT);
  }
  if (bts.length === 0) return [];

  // Smooth BT with a wider kernel than the live chart uses — we're not
  // racing the leading edge, so we can afford more filtering.
  const kernel = computeSGKernel(win, 2);
  const smoothed = sgSmooth(bts, kernel);

  // RDP on the smoothed curve.
  const dense: [number, number][] = times.map((t, i) => [t, smoothed[i]]);
  const reduced = rdpSimplify(dense, eps);

  // Build a step-style fan lookup from roast.commands[] (each "fan" command
  // is a discrete change-point with a timestamp). Falls back to sampling
  // measurement.FanVal at the requested time when no fan commands recorded.
  const fanCommands = (roast.commands || [])
    .filter((c) => c.type === "fan")
    .map((c) => ({
      tSec: (c.timestamp.getTime() - startMs) / 1000 - trimStartSec,
      value: c.value,
    }))
    .filter((c) => c.tSec >= 0)
    .sort((a, b) => a.tSec - b.tSec);

  function fanAt(tSec: number): number | undefined {
    if (fanCommands.length > 0) {
      let last: number | undefined;
      for (const c of fanCommands) {
        if (c.tSec <= tSec) last = c.value;
        else break;
      }
      return last;
    }
    // Fallback: nearest measurement's FanVal.
    if (times.length === 0) return undefined;
    let bestIdx = 0;
    let bestDiff = Math.abs(times[0] - tSec);
    for (let i = 1; i < times.length; i++) {
      const d = Math.abs(times[i] - tSec);
      if (d < bestDiff) {
        bestDiff = d;
        bestIdx = i;
      }
    }
    return roast.measurements[bestIdx].message.FanVal;
  }

  return reduced.map(([t, sp]) => {
    const fanVal = fanAt(t);
    return {
      time: Math.max(0, Math.round(t * 10) / 10),
      setpoint: Math.round(sp * 10) / 10,
      fan: fanVal != null ? Math.round(fanVal) : undefined,
    };
  });
}
