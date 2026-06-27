import * as echarts from "echarts/core";
import { LineChart, type LineSeriesOption } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkPointComponent,
  type GridComponentOption,
  type TooltipComponentOption,
  type LegendComponentOption,
  type DataZoomComponentOption,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { Profile, RoastState } from "./model.ts";

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkPointComponent,
  CanvasRenderer,
]);

type ChartOption = echarts.ComposeOption<
  | LineSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | LegendComponentOption
  | DataZoomComponentOption
>;

export type ChartInstance = ReturnType<typeof echarts.init>;

const COLORS = {
  bt: "#fe8443",
  et: "#fbbf24",
  ror: "#10b981",
  setpoint: "#974c53",
  profileBt: "#fe8443",
  profileFan: "#93c5fd",
  burner: "#ec4899",
  axis: "#a8a39c",
  grid: "rgba(245, 241, 236, 0.06)",
  axisLine: "rgba(245, 241, 236, 0.15)",
  text: "#d8d3cc",
};

// ============================================================================
// Savitzky-Golay smoothing
// Same idea as fig-gen.py's scipy.signal.savgol_filter: fit a polynomial of
// order `polyorder` to a sliding window of length `windowSize`, take the value
// at the window's center. Edge-preserving, smoother derivatives.
// ============================================================================

const SG_WINDOW = 21;
const SG_POLYORDER = 2;

function invertMatrix(M: number[][]): number[][] {
  const n = M.length;
  const a: number[][] = M.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(a[r][i]) > Math.abs(a[pivot][i])) pivot = r;
    }
    [a[i], a[pivot]] = [a[pivot], a[i]];
    const div = a[i][i];
    for (let c = 0; c < 2 * n; c++) a[i][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = a[r][i];
      for (let c = 0; c < 2 * n; c++) a[r][c] -= f * a[i][c];
    }
  }
  return a.map((row) => row.slice(n));
}

export function computeSGKernel(windowSize: number, polyorder: number): number[] {
  const m = (windowSize - 1) / 2;
  const k = polyorder + 1;
  // ATA where A is the Vandermonde matrix of [-m..m] with columns 1, x, x^2, ...
  const ATA: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let i = 0; i < windowSize; i++) {
    const x = i - m;
    const powers: number[] = [];
    let xj = 1;
    for (let j = 0; j < k; j++) {
      powers.push(xj);
      xj *= x;
    }
    for (let r = 0; r < k; r++)
      for (let c = 0; c < k; c++) ATA[r][c] += powers[r] * powers[c];
  }
  const inv = invertMatrix(ATA);
  const kernel: number[] = new Array(windowSize);
  for (let i = 0; i < windowSize; i++) {
    const x = i - m;
    let xj = 1;
    let sum = 0;
    for (let j = 0; j < k; j++) {
      sum += inv[0][j] * xj;
      xj *= x;
    }
    kernel[i] = sum;
  }
  return kernel;
}

const SG_KERNEL_BT = computeSGKernel(SG_WINDOW, SG_POLYORDER);
// Wider kernel for ROR: BT noise gets amplified by differentiation, so a
// second SG pass on the derived ROR keeps the line readable at the cost of
// a few seconds of lag at the leading edge. 61 samples ≈ 6s @ 100ms tick.
const SG_KERNEL_ROR = computeSGKernel(61, SG_POLYORDER);

// Apply SG by convolution. Near the edges (window extends past data), we
// re-normalize by the partial-sum of weights so the output stays in the
// right range rather than blending toward zero.
export function sgSmooth(data: number[], kernel: number[] = SG_KERNEL_BT): number[] {
  const m = (kernel.length - 1) / 2;
  const out = new Array(data.length);
  for (let i = 0; i < data.length; i++) {
    let sum = 0;
    let w = 0;
    for (let k = -m; k <= m; k++) {
      const idx = i + k;
      if (idx >= 0 && idx < data.length) {
        sum += kernel[k + m] * data[idx];
        w += kernel[k + m];
      }
    }
    out[i] = w === 0 ? data[i] : sum / w;
  }
  return out;
}

// Central-difference derivative of an already-smoothed series, returning
// degrees per minute and clipped to ±60 to avoid spike artifacts.
function smoothedRor(smoothed: number[], times: number[]): (number | null)[] {
  const n = smoothed.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (n < 2) return out;
  for (let i = 1; i < n - 1; i++) {
    const dt = times[i + 1] - times[i - 1];
    if (dt > 0) {
      const v = ((smoothed[i + 1] - smoothed[i - 1]) / dt) * 60;
      out[i] = Math.max(-60, Math.min(60, v));
    }
  }
  out[0] = ((smoothed[1] - smoothed[0]) / (times[1] - times[0])) * 60;
  out[n - 1] =
    ((smoothed[n - 1] - smoothed[n - 2]) /
      (times[n - 1] - times[n - 2])) *
    60;
  return out;
}

export function initializeChart(el: HTMLElement): ChartInstance {
  const chart = echarts.init(el, null, { renderer: "canvas" });

  const option: ChartOption = {
    backgroundColor: "transparent",
    textStyle: { color: COLORS.text, fontFamily: "inherit" },
    legend: {
      top: 6,
      textStyle: { color: COLORS.text },
      icon: "roundRect",
      itemWidth: 14,
      itemHeight: 8,
      // Explicit list so the raw BT/ET traces stay drawn but don't
      // chew legend width — they're already visually distinguishable
      // as faint background lines behind the smoothed BT/ET.
      data: [
        "BT",
        "ET",
        "BT ROR",
        "Setpoint",
        "Profile BT",
        "Profile Fan",
        "Burner",
      ],
    },
    grid: { left: 52, right: 56, top: 40, bottom: 50 },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(42, 50, 60, 0.95)",
      borderColor: "rgba(245, 241, 236, 0.18)",
      textStyle: { color: "#f5f1ec" },
      axisPointer: { type: "cross", lineStyle: { color: "#a8a39c" } },
      formatter: (params: any) => {
        const arr = Array.isArray(params) ? params : [params];
        const t = arr[0]?.value?.[0] ?? 0;
        const mm = Math.floor(t / 60).toString().padStart(2, "0");
        const ss = Math.floor(t % 60).toString().padStart(2, "0");
        const header = `<div style="font-weight:600;margin-bottom:4px">${mm}:${ss}</div>`;
        const rows = arr
          .map((p: any) => {
            const v = p.value?.[1];
            if (v == null) return "";
            const formatted = typeof v === "number" ? v.toFixed(1) : v;
            return `<div style="display:flex;gap:12px;justify-content:space-between"><span>${p.marker}${p.seriesName}</span><span style="font-weight:600">${formatted}</span></div>`;
          })
          .join("");
        return header + rows;
      },
    },
    xAxis: {
      type: "value",
      min: 0,
      axisLabel: {
        color: COLORS.axis,
        formatter: (v: number) => {
          if (v < 60) return `${v}s`;
          const m = Math.floor(v / 60);
          const s = Math.floor(v % 60);
          return s === 0 ? `${m}m` : `${m}:${s.toString().padStart(2, "0")}`;
        },
      },
      splitLine: { lineStyle: { color: COLORS.grid } },
      axisLine: { lineStyle: { color: COLORS.axisLine } },
    },
    yAxis: [
      {
        type: "value",
        name: "°C",
        min: 0,
        // 300 is the typical roast ceiling.  Autoscale upward in 50°
        // steps when ET / setpoint ever climbs higher (e.g., aggressive
        // ramp profiles) instead of clipping the line off.
        max: (value: { max: number }) =>
          value.max <= 300 ? 300 : Math.ceil(value.max / 50) * 50,
        position: "left",
        axisLabel: { color: COLORS.axis },
        nameTextStyle: { color: COLORS.axis },
        splitLine: { lineStyle: { color: COLORS.grid } },
      },
      {
        type: "value",
        name: "ROR / Fan",
        min: 0,
        max: 100,
        position: "right",
        axisLabel: { color: COLORS.axis },
        nameTextStyle: { color: COLORS.axis },
        splitLine: { show: false },
      },
    ],
    dataZoom: [{ type: "inside", xAxisIndex: 0 }],
    // NOTE: every series has an explicit `id`.  setOption() merges series
    // by id when present; without ids it merges BY INDEX, which means
    // partial updates (e.g., updateProfileLines passing only 2 entries)
    // clobber the wrong slots and the chart loses its other series.
    series: [
      {
        id: "bt",
        name: "BT",
        type: "line",
        data: [],
        showSymbol: false,
        smooth: 0.3,
        sampling: "lttb",
        lineStyle: { width: 2, color: COLORS.bt },
        itemStyle: { color: COLORS.bt },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(254, 132, 67, 0.35)" },
            { offset: 1, color: "rgba(254, 132, 67, 0)" },
          ]),
        },
        yAxisIndex: 0,
      },
      {
        id: "et",
        name: "ET",
        type: "line",
        data: [],
        showSymbol: false,
        smooth: 0.3,
        sampling: "lttb",
        lineStyle: { width: 2, color: COLORS.et },
        itemStyle: { color: COLORS.et },
        yAxisIndex: 0,
      },
      {
        id: "btRor",
        name: "BT ROR",
        type: "line",
        data: [],
        showSymbol: false,
        smooth: 0.5,
        sampling: "lttb",
        lineStyle: { width: 1.5, color: COLORS.ror, type: "dashed" },
        itemStyle: { color: COLORS.ror },
        yAxisIndex: 1,
      },
      {
        id: "setpoint",
        name: "Setpoint",
        type: "line",
        data: [],
        showSymbol: false,
        lineStyle: { width: 1, color: COLORS.setpoint, type: "dotted" },
        itemStyle: { color: COLORS.setpoint },
        yAxisIndex: 0,
      },
      {
        id: "profileBt",
        name: "Profile BT",
        type: "line",
        data: [],
        showSymbol: false,
        lineStyle: { width: 1.5, color: COLORS.profileBt, type: "dashed", opacity: 0.7 },
        itemStyle: { color: COLORS.profileBt },
        yAxisIndex: 0,
      },
      {
        id: "profileFan",
        name: "Profile Fan",
        type: "line",
        data: [],
        showSymbol: false,
        lineStyle: { width: 1.5, color: COLORS.profileFan, type: "dashed", opacity: 0.7 },
        itemStyle: { color: COLORS.profileFan },
        yAxisIndex: 1,
      },
      {
        id: "burner",
        name: "Burner",
        type: "line",
        data: [],
        showSymbol: false,
        sampling: "lttb",
        lineStyle: { width: 1.25, color: COLORS.burner },
        itemStyle: { color: COLORS.burner },
        yAxisIndex: 1,
      },
      {
        id: "btRaw",
        name: "BT raw",
        type: "line",
        data: [],
        showSymbol: false,
        sampling: "lttb",
        lineStyle: { width: 1, color: COLORS.bt, opacity: 0.25 },
        itemStyle: { color: COLORS.bt, opacity: 0.4 },
        yAxisIndex: 0,
        z: 1,
      },
      {
        id: "etRaw",
        name: "ET raw",
        type: "line",
        data: [],
        showSymbol: false,
        sampling: "lttb",
        lineStyle: { width: 1, color: COLORS.et, opacity: 0.25 },
        itemStyle: { color: COLORS.et, opacity: 0.4 },
        yAxisIndex: 0,
        z: 1,
      },
    ],
  };

  chart.setOption(option);

  const ro = new ResizeObserver(() => chart.resize());
  ro.observe(el);

  return chart;
}

export function updateChart(chart: ChartInstance, roast: RoastState) {
  const { measurements, startDate, events } = roast;
  if (measurements.length === 0) {
    // Clear every measurement-driven series AND wipe the event markers
    // that hang on the BT series (otherwise Clear Reset leaves the dots
    // and dashed lines on the chart from the previous roast).
    chart.setOption({
      series: [
        {
          id: "bt",
          data: [],
          markLine: { silent: true, symbol: "none", data: [] },
          markPoint: { silent: true, data: [] },
        },
        { id: "et", data: [] },
        { id: "btRor", data: [] },
        { id: "setpoint", data: [] },
        { id: "burner", data: [] },
        { id: "btRaw", data: [] },
        { id: "etRaw", data: [] },
      ],
    });
    return;
  }

  const startMs = startDate.getTime();
  const times = measurements.map((m) => (m.timestamp.getTime() - startMs) / 1000);
  const bt = measurements.map((m) => m.message.BT);
  const et = measurements.map((m) => m.message.ET);
  const setpoints = measurements.map((m) => m.extra?.setpoint ?? null);
  const burner = measurements.map((m) => m.message.BurnerVal);

  // Smooth BT/ET first, then differentiate for ROR (matches fig-gen.py).
  // Second SG pass over the ROR series itself to suppress the residual
  // jitter that differentiation amplifies.
  const btSmoothed = sgSmooth(bt);
  const etSmoothed = sgSmooth(et);
  const btRorRaw = smoothedRor(btSmoothed, times);
  const btRorFilled: number[] = btRorRaw.map((v) => v ?? 0);
  const btRorFiltered = sgSmooth(btRorFilled, SG_KERNEL_ROR);
  const btRor: (number | null)[] = btRorRaw.map((v, i) =>
    v == null ? null : btRorFiltered[i],
  );

  const btData = times.map((t, i) => [t, btSmoothed[i]]);
  const etData = times.map((t, i) => [t, etSmoothed[i]]);
  const btRawData = times.map((t, i) => [t, bt[i]]);
  const etRawData = times.map((t, i) => [t, et[i]]);
  const burnerData = times.map((t, i) => [t, burner[i]]);
  const rorData: [number, number][] = [];
  btRor.forEach((v, i) => {
    if (v != null) rorData.push([times[i], v]);
  });
  const spData: [number, number][] = [];
  setpoints.forEach((v, i) => {
    if (v != null) spData.push([times[i], v]);
  });

  const markLineData = events.map((e) => ({
    name: e.label as string,
    xAxis: (e.measurement.timestamp.getTime() - startMs) / 1000,
    label: { formatter: e.label as string, color: "#f1f5f9", position: "end" as const },
    lineStyle: { color: "#f59e0b", type: "dashed" as const },
  }));

  // markPoints sit on the BT line at the BT value when each event was
  // recorded. Gives a visual anchor + the temperature at-a-glance for
  // crack, drop, etc.
  const markPointData = events.map((e) => {
    const tSec = (e.measurement.timestamp.getTime() - startMs) / 1000;
    const bt = e.measurement.message.BT;
    return {
      name: e.label as string,
      coord: [tSec, bt] as [number, number],
      symbol: "circle" as const,
      symbolSize: 8,
      itemStyle: { color: "#f59e0b", borderColor: "#fef3c7", borderWidth: 1.5 },
      label: {
        formatter: `${e.label} ${bt.toFixed(1)}°`,
        position: "top" as const,
        color: "#f1f5f9",
        fontSize: 10,
        backgroundColor: "rgba(245, 158, 11, 0.85)",
        padding: [2, 4],
        borderRadius: 3,
      },
    };
  });

  chart.setOption({
    series: [
      {
        id: "bt",
        data: btData,
        markLine: { silent: true, symbol: "none", data: markLineData },
        markPoint: { silent: true, data: markPointData },
      },
      { id: "et", data: etData },
      { id: "btRor", data: rorData },
      { id: "setpoint", data: spData },
      { id: "burner", data: burnerData },
      { id: "btRaw", data: btRawData },
      { id: "etRaw", data: etRawData },
    ],
  });
}

// Programmatically show the chart's hover crosshair + tooltip at a given
// time. Used by the profile point editor to "preview" what's at the
// selected point's time. Anchors the tooltip to the BT series when BT has
// data at or past the selected time; otherwise just moves the crosshair.
export function highlightTime(chart: ChartInstance, t: number | null) {
  if (t == null) {
    chart.dispatchAction({ type: "hideTip" });
    chart.dispatchAction({ type: "updateAxisPointer", currTrigger: "leave" });
    return;
  }
  const option = chart.getOption() as { series?: Array<{ name?: string; data?: [number, number][] }> };
  const btIdx = option.series?.findIndex((s) => s.name === "BT") ?? -1;
  const data = btIdx >= 0 ? option.series?.[btIdx].data : undefined;
  if (data && data.length > 0 && data[data.length - 1][0] >= t) {
    // Binary search the closest BT index
    let lo = 0;
    let hi = data.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (data[mid][0] < t) lo = mid + 1;
      else hi = mid;
    }
    if (
      lo > 0 &&
      Math.abs(data[lo - 1][0] - t) < Math.abs(data[lo][0] - t)
    ) {
      lo--;
    }
    chart.dispatchAction({
      type: "showTip",
      seriesIndex: btIdx,
      dataIndex: lo,
    });
  } else {
    // No BT data at this time yet — just move the crosshair.
    chart.dispatchAction({
      type: "updateAxisPointer",
      currTrigger: "mousemove",
      axesInfo: [{ axisDim: "x", axisIndex: 0, value: t }],
    });
  }
}

export function updateProfileLines(
  chart: ChartInstance,
  profile: Profile | undefined,
) {
  if (!profile || profile.steps.length === 0) {
    chart.setOption({
      series: [
        { id: "profileBt", data: [] },
        { id: "profileFan", data: [] },
      ],
    });
    return;
  }

  const btPoints: [number, number][] = [];
  const fanPoints: [number, number][] = [];
  let t = 0;

  // First point: t=0 with step[0]'s setpoint and fan
  btPoints.push([0, profile.steps[0].setpoint]);
  if (profile.steps[0].fanValue != null) {
    fanPoints.push([0, profile.steps[0].fanValue]);
  }

  for (let i = 0; i < profile.steps.length; i++) {
    const step = profile.steps[i];
    t += step.duration;
    btPoints.push([t, step.setpoint]);
    if (step.fanValue != null) {
      fanPoints.push([t, step.fanValue]);
    }
  }

  chart.setOption({
    series: [
      { id: "profileBt", data: btPoints },
      { id: "profileFan", data: fanPoints },
    ],
  });
}

