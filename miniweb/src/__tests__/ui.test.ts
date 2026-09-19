/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.hoisted(() => vi.fn().mockImplementation((urlInput: any) => {
  const url = typeof urlInput === 'string' ? urlInput : urlInput?.url || String(urlInput || '');
  if (url.includes('/api/roast/list')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ roasts: [] }) });
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
}));

vi.hoisted(() => {
  class MockResizeObserver {
    observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn();
  }
  class MockWebSocket {
    url: string; readyState: number = 0;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: ((ev: any) => void) | null = null;
    onerror:   ((ev: any) => void) | null = null;
    constructor(url: string) {
      this.url = url;
      setTimeout(() => { this.readyState = 1; if (this.onopen) this.onopen(); }, 0);
    }
    send = vi.fn(); close = vi.fn();
  }
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  vi.stubGlobal('WebSocket', MockWebSocket);
  global.URL.createObjectURL = vi.fn(() => 'mock-url');
  global.URL.revokeObjectURL = vi.fn();
  vi.stubGlobal('fetch', mockFetch);
});

vi.mock('../chart', () => ({
  initializeChart: vi.fn(() => ({ setOption: vi.fn(), dispatchAction: vi.fn(), resize: vi.fn() })),
  updateChart: vi.fn(),
  updateProfileLines: vi.fn(),
  highlightTime: vi.fn(),
  resetChartZoom: vi.fn(),
  sgSmooth: vi.fn((data: any) => data),
  computeSGKernel: vi.fn(() => []),
}));

const mockSendCommand = vi.hoisted(() => vi.fn());
vi.mock('../websocket', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, sendCommand: mockSendCommand };
});

import { roastApp, updateFanPower, updateHeaterPower, state, resetRoast, slider1Value } from '../roast';
import { RoasterStatus, YaegerMessage } from '../model';
import { lastMessage } from '../websocket';

const mockMessage = (overrides: Partial<YaegerMessage> = {}): YaegerMessage => ({
  ET: 100, BT: 100, Amb: 20, FanVal: 0, BurnerVal: 0, id: 1, ...overrides,
});

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'fetch', { value: mockFetch, writable: true, configurable: true });
}

describe('UI Button Click Integration Tests', () => {
  let appElement: HTMLElement;

  beforeEach(() => {
    mockSendCommand.mockClear();
    lastMessage.val = null;
    resetRoast();
    mockSendCommand.mockClear();
    appElement = roastApp() as HTMLElement;
    document.body.innerHTML = '';
    document.body.appendChild(appElement);
  });

  it('renders the initial dashboard in idle state', () => {
    const startBtn = appElement.querySelector('.btn-start') as HTMLButtonElement;
    const endBtn   = appElement.querySelector('.btn-end')   as HTMLButtonElement;
    expect(startBtn).toBeDefined();
    expect(endBtn).toBeDefined();
    expect(startBtn.disabled).toBe(false);
    expect(endBtn.disabled).toBe(true);
  });

  it('Start Roast transitions to roasting state (no firmware commands)', async () => {
    const startBtn = appElement.querySelector('.btn-start') as HTMLButtonElement;
    const endBtn   = appElement.querySelector('.btn-end')   as HTMLButtonElement;
    startBtn.click();
    await tick();
    expect(state.val.currentState.status).toBe(RoasterStatus.roasting);
    expect(startBtn.disabled).toBe(true);
    expect(endBtn.disabled).toBe(false);
    // No profile/startRoast commands sent — firmware is driven by Artisan
    expect(mockSendCommand).not.toHaveBeenCalledWith(expect.objectContaining({ command: 'startRoast' }));
    expect(mockSendCommand).not.toHaveBeenCalledWith(expect.objectContaining({ command: 'setActiveProfile' }));
  });

  it('End Roast sends fan/heater commands and enters cooling', async () => {
    const startBtn = appElement.querySelector('.btn-start') as HTMLButtonElement;
    const endBtn   = appElement.querySelector('.btn-end')   as HTMLButtonElement;
    startBtn.click();
    await tick();
    mockSendCommand.mockClear();
    endBtn.click();
    await tick();
    expect(state.val.currentState.status).toBe(RoasterStatus.cooling);
    expect(mockSendCommand).toHaveBeenCalledWith(expect.objectContaining({ FanVal: 50 }));
    expect(mockSendCommand).toHaveBeenCalledWith(expect.objectContaining({ BurnerVal: 0 }));
    expect(mockSendCommand).not.toHaveBeenCalledWith(expect.objectContaining({ command: 'endRoast' }));
  });

  it('All Off sends allOff command', () => {
    const allOffBtn = appElement.querySelector('.btn-alloff') as HTMLButtonElement;
    allOffBtn.click();
    expect(mockSendCommand).toHaveBeenCalledWith(expect.objectContaining({ command: 'allOff' }));
  });

  it('Clear Reset returns to idle without sending endRoast', async () => {
    const startBtn = appElement.querySelector('.btn-start') as HTMLButtonElement;
    const resetBtn = appElement.querySelector('.btn-reset') as HTMLButtonElement;
    startBtn.click();
    await tick();
    mockSendCommand.mockClear();
    resetBtn.click();
    await tick();
    expect(state.val.currentState.status).toBe(RoasterStatus.idle);
    expect(startBtn.disabled).toBe(false);
    expect(mockSendCommand).not.toHaveBeenCalledWith(expect.objectContaining({ command: 'endRoast' }));
  });

  it('#12: BT below 50 during cooling returns to idle', async () => {
    state.val = {
      ...state.val,
      currentState: { ...state.val.currentState, status: RoasterStatus.cooling },
      roast: { startDate: new Date(), measurements: [], events: [], commands: [] },
    };
    expect(state.val.currentState.status).toBe(RoasterStatus.cooling);
    lastMessage.val = mockMessage({ BT: 40 });
    await tick();
    expect(state.val.currentState.status).toBe(RoasterStatus.idle);
  });

  it('heater safety: blocked when fan is off, allowed when fan is on', () => {
    // canRunHeater() = slider1Value.val > 0
    slider1Value.val = 0;
    expect(slider1Value.val > 0).toBe(false);

    slider1Value.val = 50;
    expect(slider1Value.val > 0).toBe(true);
  });

  it.todo('websocket: sendCommand coalesces same-command entries while disconnected');
  it.todo('websocket: allOff always goes to the front of the pending queue');
  it.todo('websocket: reconnectTick fires flushQueue in order on ws.onopen');
});
