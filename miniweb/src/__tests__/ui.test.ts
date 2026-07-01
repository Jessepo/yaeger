/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

const mockFetch = vi.hoisted(() => vi.fn().mockImplementation((urlInput: any) => {
  const url = typeof urlInput === 'string' ? urlInput : urlInput?.url || String(urlInput || '');
  console.log("MOCK FETCH URL:", url);
  if (url.includes('/api/profile/list')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ profiles: [] }),
    });
  }
  if (url.includes('/api/roast/list')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ roasts: [] }),
    });
  }
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  });
}));

// Setup other stubs via vi.hoisted
vi.hoisted(() => {
  class MockResizeObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }

  class MockWebSocket {
    url: string;
    readyState: number = 0;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: ((ev: any) => void) | null = null;
    onerror: ((ev: any) => void) | null = null;
    constructor(url: string) {
      this.url = url;
      setTimeout(() => {
        this.readyState = 1; // OPEN
        if (this.onopen) this.onopen();
      }, 0);
    }
    send = vi.fn();
    close = vi.fn();
  }

  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  vi.stubGlobal('WebSocket', MockWebSocket);
  global.URL.createObjectURL = vi.fn(() => 'mock-url');
  global.URL.revokeObjectURL = vi.fn();
  vi.stubGlobal('fetch', mockFetch);
});

// Mock echarts to avoid loading full chart renderer in tests
vi.mock('../chart', () => {
  return {
    initializeChart: vi.fn(() => ({
      setOption: vi.fn(),
      dispatchAction: vi.fn(),
      resize: vi.fn(),
    })),
    updateChart: vi.fn(),
    updateProfileLines: vi.fn(),
    highlightTime: vi.fn(),
    resetChartZoom: vi.fn(),
    sgSmooth: vi.fn((data) => data),
    computeSGKernel: vi.fn(() => []),
  };
});

const mockSendCommand = vi.hoisted(() => vi.fn());
vi.mock('../websocket', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    sendCommand: mockSendCommand,
  };
});

// Import App logic dynamically after mocks are set up
import { roastApp, updateFanPower, updateHeaterPower } from '../roast';
import { RoasterStatus, YaegerState } from '../model';
import { profile, profileLoadTick } from '../profiling';

// Override window.fetch in JSDOM sandbox explicitly
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'fetch', {
    value: mockFetch,
    writable: true,
    configurable: true,
  });
}

describe('UI Button Click Integration Tests', () => {
  let appElement: HTMLElement;

  beforeEach(() => {
    mockSendCommand.mockClear();
    
    // Mount the app
    appElement = roastApp() as HTMLElement;
    document.body.innerHTML = '';
    document.body.appendChild(appElement);
    
    // Initialize profile to a mock profile for testing
    profile.val = {
      steps: [
        { interpolation: 'linear', setpoint: 100, duration: 60, fanValue: 50 }
      ]
    };
  });

  it('renders the initial dashboard in idle state', () => {
    const startBtn = appElement.querySelector('.btn-start') as HTMLButtonElement;
    const endBtn = appElement.querySelector('.btn-end') as HTMLButtonElement;
    
    expect(startBtn).toBeDefined();
    expect(endBtn).toBeDefined();
    expect(startBtn.disabled).toBe(false);
    expect(endBtn.disabled).toBe(true);
  });

  it('triggers Start Roast workflow on start button click', async () => {
    const startBtn = appElement.querySelector('.btn-start') as HTMLButtonElement;
    const endBtn = appElement.querySelector('.btn-end') as HTMLButtonElement;

    // Click "Start Roast"
    startBtn.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    // Verify websocket commands were sent
    expect(mockSendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'setActiveProfile' })
    );
    expect(mockSendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'startRoast' })
    );

    // Verify button states toggle
    expect(startBtn.disabled).toBe(true);
    expect(endBtn.disabled).toBe(false);
  });

  it('triggers End Roast (drop/cooling) workflow on end button click', async () => {
    const startBtn = appElement.querySelector('.btn-start') as HTMLButtonElement;
    const endBtn = appElement.querySelector('.btn-end') as HTMLButtonElement;

    // 1. Start the roast first
    startBtn.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    mockSendCommand.mockClear();

    // 2. Click "End Roast"
    endBtn.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    // Verify it triggers endRoast and switches to manual cooling
    expect(mockSendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'endRoast' })
    );
    expect(mockSendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ Mode: 'Manual' })
    );
    // Elements/sliders are set to cooling fan and 0 heater
    expect(mockSendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ FanVal: 50 })
    );
    expect(mockSendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ BurnerVal: 0 })
    );
  });

  it('triggers safety All Off command on safety button click', () => {
    const allOffBtn = appElement.querySelector('.btn-alloff') as HTMLButtonElement;
    
    allOffBtn.click();

    expect(mockSendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'allOff' })
    );
  });

  it('triggers Clear Reset workflow on reset button click', async () => {
    const startBtn = appElement.querySelector('.btn-start') as HTMLButtonElement;
    const resetBtn = appElement.querySelector('.btn-reset') as HTMLButtonElement;

    // Start roast first
    startBtn.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    mockSendCommand.mockClear();

    // Click "Clear Reset"
    resetBtn.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    // It should end the roast on firmware
    expect(mockSendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'endRoast' })
    );
    // Button states should go back to idle
    expect(startBtn.disabled).toBe(false);
  });

  it('supports changing fan offset while following profile in PID mode', async () => {
    const startBtn = appElement.querySelector('.btn-start') as HTMLButtonElement;
    
    // Set up profile to have fan values
    profile.val = {
      steps: [
        { interpolation: 'linear', setpoint: 100, duration: 60, fanValue: 50 },
        { interpolation: 'linear', setpoint: 150, duration: 60, fanValue: 60 }
      ]
    };
    profileLoadTick.val++;
    
    // Start the roast
    startBtn.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    
    // Locate the "Fan offset (vs profile)" slider
    const labels = Array.from(appElement.querySelectorAll('.control-label'));
    const fanOffsetLabel = labels.find(el => el.textContent === 'Fan offset (vs profile)');
    expect(fanOffsetLabel).toBeDefined();
    
    const controlDiv = fanOffsetLabel!.closest('.control');
    expect(controlDiv).not.toBeNull();
    
    const inputElement = controlDiv!.querySelector('input[type="range"]') as HTMLInputElement;
    expect(inputElement).not.toBeNull();
    
    // Change fan offset value
    inputElement.value = '10';
    inputElement.dispatchEvent(new Event('input'));
    await new Promise(resolve => setTimeout(resolve, 0));
    
    // Verify setFanOffset command was sent
    expect(mockSendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'setFanOffset', value: 10 })
    );
  });
});
