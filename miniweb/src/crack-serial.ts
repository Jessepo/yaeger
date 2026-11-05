import van from "vanjs-core";

const { div, button, canvas, span, input } = van.tags;

const SAMPLES = 256;
const SAMPLE_RATE = 16000;
const FRAME_BYTES = 2 + SAMPLES * 2; // 0xAA 0x55 + 256×int16

const STORAGE_KEY = "yaeger-crack-params";

function loadStoredParams(): { lo: number; hi: number; thresh: number } {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) return JSON.parse(s);
  } catch (_) {}
  return { lo: 3500, hi: 7500, thresh: 35000 };
}

function persistParams(lo: number, hi: number, thresh: number) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ lo, hi, thresh })); } catch (_) {}
}

const stored = loadStoredParams();

export const crackConnected = van.state(false);
const loFreq     = van.state(stored.lo);
const hiFreq     = van.state(stored.hi);
const threshold  = van.state(stored.thresh);
const crackFlash = van.state(false);
const saveStatus = van.state("");
let muted = false;

let activePort: any = null;
let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
let audioCtx: AudioContext | null = null;
let workletNode: AudioWorkletNode | null = null;

// Canvas refs — assigned when CrackTuner component is rendered
let spectroEl: HTMLCanvasElement | null = null;
let fftEl: HTMLCanvasElement | null = null;
let spectroImgData: ImageData | null = null;

// ============================================================================
// FFT — radix-2 Cooley-Tukey, in-place
// ============================================================================

function fft(re: Float32Array, im: Float32Array) {
  const N = re.length;
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < (len >> 1); j++) {
        const ur = re[i+j], ui = im[i+j];
        const vr = re[i+j+(len>>1)] * cr - im[i+j+(len>>1)] * ci;
        const vi = re[i+j+(len>>1)] * ci + im[i+j+(len>>1)] * cr;
        re[i+j] = ur + vr;       im[i+j] = ui + vi;
        re[i+j+(len>>1)] = ur - vr; im[i+j+(len>>1)] = ui - vi;
        const nc = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nc;
      }
    }
  }
}

function hannWindow(re: Float32Array) {
  const N = re.length;
  for (let i = 0; i < N; i++) re[i] *= 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));
}

// ============================================================================
// Canvas drawing
// ============================================================================

function drawFrame(mags: Float32Array) {
  if (!spectroEl || !fftEl) return;
  const NBINS = SAMPLES >> 1;
  const lo = loFreq.val, hi = hiFreq.val, thresh = threshold.val;

  // Spectrogram: frequency on X axis, time scrolls upward
  const sw = spectroEl.width, sh = spectroEl.height;
  const ctx = spectroEl.getContext("2d")!;
  if (!spectroImgData || spectroImgData.width !== sw || spectroImgData.height !== sh) {
    spectroImgData = ctx.createImageData(sw, sh);
    for (let i = 3; i < spectroImgData.data.length; i += 4) spectroImgData.data[i] = 255;
  }
  const d = spectroImgData.data;
  d.copyWithin(0, sw * 4); // scroll up one row
  const rowStart = (sh - 1) * sw * 4;
  for (let bin = 0; bin < NBINS; bin++) {
    const freq = bin * SAMPLE_RATE / SAMPLES;
    const inBand = freq >= lo && freq <= hi;
    const mag = mags[bin];
    const t = Math.min(1, Math.log1p(mag / 5000) / Math.log1p(thresh / 5000));
    const xStart = Math.floor(bin * sw / NBINS);
    const xEnd   = Math.floor((bin + 1) * sw / NBINS);
    for (let px = xStart; px < xEnd; px++) {
      const idx = rowStart + px * 4;
      if (inBand) {
        d[idx] = Math.floor(t * 255); d[idx+1] = Math.floor((1 - t * 0.8) * 180); d[idx+2] = 0;
      } else {
        d[idx] = 0; d[idx+1] = Math.floor(t * 210); d[idx+2] = Math.floor(t * 120);
      }
    }
  }
  ctx.putImageData(spectroImgData, 0, 0);

  // FFT bar chart
  const fc = fftEl.getContext("2d")!;
  const fw = fftEl.width, fh = fftEl.height;
  fc.fillStyle = "var(--bg-0, #2a323c)";
  fc.fillRect(0, 0, fw, fh);
  const barW = fw / NBINS;
  for (let bin = 0; bin < NBINS; bin++) {
    const freq = bin * SAMPLE_RATE / SAMPLES;
    const inBand = freq >= lo && freq <= hi;
    const mag = mags[bin];
    const hPx = Math.min(fh, fh * Math.log1p(mag) / Math.log1p(thresh * 4));
    fc.fillStyle = (mag > thresh && inBand) ? "#fe5848"
                 : inBand ? "#fe8443"
                 : "#4a7a6a";
    fc.fillRect(bin * barW, fh - hPx, Math.max(1, barW - 0.5), hPx);
  }
  const threshPx = fh * Math.log1p(thresh) / Math.log1p(thresh * 4);
  fc.strokeStyle = "#fe5848"; fc.setLineDash([3, 3]);
  fc.beginPath(); fc.moveTo(0, fh - threshPx); fc.lineTo(fw, fh - threshPx); fc.stroke();
  fc.setLineDash([]);
}

// ============================================================================
// Crack flash
// ============================================================================

let crackTimer: ReturnType<typeof setTimeout> | null = null;
function flashCrack() {
  crackFlash.val = true;
  if (crackTimer) clearTimeout(crackTimer);
  crackTimer = setTimeout(() => { crackFlash.val = false; }, 600);
}

// ============================================================================
// Process one decoded frame
// ============================================================================

function processFrame(int16: Int16Array) {
  // Scale ×4: int16 = raw>>16, firmware used raw>>14, so ×4 restores the same magnitude range
  const re = new Float32Array(SAMPLES);
  const im = new Float32Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) re[i] = int16[i] * 4;

  if (!muted && workletNode) {
    const audio = new Float32Array(SAMPLES);
    for (let i = 0; i < SAMPLES; i++) audio[i] = int16[i] / 32768;
    workletNode.port.postMessage(audio);
  }

  hannWindow(re);
  fft(re, im);

  const mags = new Float32Array(SAMPLES >> 1);
  for (let i = 0; i < mags.length; i++) mags[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);

  // Detection — same logic as firmware
  for (let i = 2; i <= SAMPLES >> 1; i++) {
    const freq = i * SAMPLE_RATE / SAMPLES;
    if (freq >= loFreq.val && freq <= hiFreq.val && mags[i] > threshold.val) {
      flashCrack();
      break;
    }
  }

  drawFrame(mags);
}

// ============================================================================
// Serial framing
// ============================================================================

let serialBuf = new Uint8Array(0);

function appendBytes(chunk: Uint8Array) {
  const merged = new Uint8Array(serialBuf.length + chunk.length);
  merged.set(serialBuf); merged.set(chunk, serialBuf.length);
  serialBuf = merged;
  while (serialBuf.length >= FRAME_BYTES) {
    let sync = -1;
    for (let i = 0; i <= serialBuf.length - FRAME_BYTES; i++) {
      if (serialBuf[i] === 0xAA && serialBuf[i+1] === 0x55) { sync = i; break; }
    }
    if (sync === -1) { serialBuf = serialBuf.slice(serialBuf.length - 1); break; }
    if (sync > 0)    { serialBuf = serialBuf.slice(sync); continue; }
    processFrame(new Int16Array(serialBuf.slice(2, FRAME_BYTES).buffer));
    serialBuf = serialBuf.slice(FRAME_BYTES);
  }
}

// ============================================================================
// AudioWorklet (inlined as blob URL)
// ============================================================================

const WORKLET_SRC = `
class PCMPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this._q = []; this._head = null; this._pos = 0;
    this.port.onmessage = ({ data }) => { if (this._q.length < 16) this._q.push(data); };
  }
  process(_, outputs) {
    const ch = outputs[0][0];
    let i = 0;
    while (i < ch.length) {
      if (!this._head || this._pos >= this._head.length) {
        if (!this._q.length) break;
        this._head = this._q.shift(); this._pos = 0;
      }
      ch[i++] = this._head[this._pos++];
    }
    return true;
  }
}
registerProcessor('pcm-player', PCMPlayer);
`;

async function initAudio() {
  audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const blob = new Blob([WORKLET_SRC], { type: "application/javascript" });
  await audioCtx.audioWorklet.addModule(URL.createObjectURL(blob));
  workletNode = new AudioWorkletNode(audioCtx, "pcm-player");
  workletNode.connect(audioCtx.destination);
}

// ============================================================================
// Connect / Disconnect
// ============================================================================

async function connect() {
  if (activeReader) {
    try { await activeReader.cancel(); } catch (_) {}
    return;
  }
  try {
    const port = await (navigator as any).serial.requestPort();
    await port.open({ baudRate: 921600 });
    activePort = port;
    crackConnected.val = true;
    serialBuf = new Uint8Array(0);
    spectroImgData = null;

    await initAudio();

    const writer = port.writable.getWriter();
    await writer.write(new TextEncoder().encode("m\n"));
    writer.releaseLock();

    const reader: ReadableStreamDefaultReader<Uint8Array> = port.readable.getReader();
    activeReader = reader;

    // Read loop in background
    (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          appendBytes(value);
        }
      } catch (_) {
        // cancelled — normal path
      } finally {
        reader.releaseLock();
        activeReader = null;
        try {
          const w = port.writable.getWriter();
          await w.write(new TextEncoder().encode("x\n"));
          w.releaseLock();
        } catch (_) {}
        try { await port.close(); } catch (_) {}
        activePort = null;
        crackConnected.val = false;
      }
    })();
  } catch (e: any) {
    if (e?.name !== "NotFoundError") console.error("Serial:", e);
    crackConnected.val = false;
  }
}

async function saveToBoard() {
  if (!activePort) return;
  try {
    const cmd = `s,${loFreq.val},${hiFreq.val},${threshold.val}\n`;
    const writer = activePort.writable.getWriter();
    await writer.write(new TextEncoder().encode(cmd));
    writer.releaseLock();
    persistParams(loFreq.val, hiFreq.val, threshold.val);
    saveStatus.val = "✓ Saved";
    setTimeout(() => { saveStatus.val = ""; }, 2000);
  } catch (_) {
    saveStatus.val = "✗ Error";
    setTimeout(() => { saveStatus.val = ""; }, 2000);
  }
}

// ============================================================================
// CrackTuner VanJS component
// ============================================================================

export const CrackTuner = () => {
  spectroEl = canvas({
    width: 800, height: 180,
    style: "width:100%;border:1px solid var(--border);border-radius:var(--r-sm);display:block;margin-bottom:4px;image-rendering:pixelated;",
  }) as HTMLCanvasElement;
  fftEl = canvas({
    width: 800, height: 60,
    style: "width:100%;border:1px solid var(--border);border-radius:var(--r-sm);display:block;margin-bottom:8px;image-rendering:pixelated;",
  }) as HTMLCanvasElement;

  const muteState = van.state(false);

  function sliderStyle(val: number, min: number, max: number) {
    const pct = ((val - min) / (max - min)) * 100;
    return `--fill: ${Math.min(100, Math.max(0, pct))}%`;
  }

  return div(
    // Connection row
    div(
      { style: "display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;" },
      button({
        onclick: connect,
      }, () => crackConnected.val ? "Disconnect" : "Connect Listener"),
      button({
        disabled: () => !crackConnected.val,
        onclick: () => { muteState.val = !muteState.val; muted = muteState.val; },
      }, () => muteState.val ? "Unmute" : "Mute Audio"),
      () => crackConnected.val
        ? span({ style: "font-size:0.75rem;color:var(--success);" }, "● Connected")
        : span({ style: "font-size:0.75rem;color:var(--text-3);" }, "Not connected"),
    ),

    // Crack detection flash
    div({
      style: () =>
        `height:26px;line-height:26px;text-align:center;font-weight:700;font-size:0.8125rem;` +
        `border-radius:var(--r-sm);margin-bottom:6px;border:1px solid var(--border);transition:background 0.1s;` +
        (crackFlash.val
          ? "background:var(--danger);color:var(--bg-0);border-color:var(--danger);"
          : "background:var(--bg-0);color:var(--text-3);"),
    }, () => crackFlash.val ? "CRACK DETECTED" : "—"),

    spectroEl,
    div(
      { style: "display:flex;justify-content:space-between;font-size:0.625rem;color:var(--text-3);padding:0 1px;margin-top:-2px;margin-bottom:6px;" },
      span("0 Hz"), span("2 kHz"), span("4 kHz"), span("6 kHz"), span("8 kHz"),
    ),
    fftEl,

    // Sliders
    div(
      { style: "display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px;" },

      div(
        { class: "pid-field" },
        input({
          type: "range", min: 0, max: 8000, step: 62.5,
          value: () => loFreq.val,
          style: () => sliderStyle(loFreq.val, 0, 8000),
          oninput: (e: Event) => { loFreq.val = parseFloat((e.target as HTMLInputElement).value); },
        }),
        span({ class: "pid-label" }, () => `Low: ${loFreq.val} Hz`),
      ),

      div(
        { class: "pid-field" },
        input({
          type: "range", min: 0, max: 8000, step: 62.5,
          value: () => hiFreq.val,
          style: () => sliderStyle(hiFreq.val, 0, 8000),
          oninput: (e: Event) => { hiFreq.val = parseFloat((e.target as HTMLInputElement).value); },
        }),
        span({ class: "pid-label" }, () => `High: ${hiFreq.val} Hz`),
      ),

      div(
        { class: "pid-field" },
        input({
          type: "range", min: 3.5, max: 7.5, step: 0.02,
          value: () => Math.log10(threshold.val),
          style: () => sliderStyle(Math.log10(threshold.val), 3.5, 7.5),
          oninput: (e: Event) => {
            threshold.val = Math.round(Math.pow(10, parseFloat((e.target as HTMLInputElement).value)));
          },
        }),
        span({ class: "pid-label" }, () => `Threshold: ${threshold.val.toLocaleString()}`),
      ),
    ),

    // Save row
    div(
      { style: "display:flex;gap:8px;align-items:center;margin-bottom:8px;" },
      button({
        disabled: () => !crackConnected.val,
        onclick: saveToBoard,
        class: "pid-apply",
        style: "grid-column:unset;margin-top:0;",
      }, "Save to Board"),
      () => saveStatus.val
        ? span({ style: "font-size:0.75rem;color:var(--success);" }, saveStatus.val)
        : null,
    ),

    // Chrome flag note
    div(
      { style: "font-size:0.625rem;color:var(--text-3);line-height:1.5;" },
      "Web Serial requires Chrome/Edge. To enable on yaeger.local: ",
      span(
        { style: "font-family:ui-monospace,monospace;background:var(--bg-0);padding:1px 4px;border-radius:2px;" },
        "chrome://flags/#unsafely-treat-insecure-origin-as-secure",
      ),
      " → add http://yaeger.local",
    ),
  );
};
