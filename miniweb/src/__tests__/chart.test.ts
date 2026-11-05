/**
 * @vitest-environment jsdom
 *
 * Chart-level tests.  These import chart.ts directly and mock only
 * echarts so we can observe what gets passed to setOption / dispatchAction.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock echarts before chart.ts is imported.  Use vi.hoisted so the
// mock object is defined *before* vi.mock() runs (which itself is
// hoisted to the top of the module).
const mockChart = vi.hoisted(() => ({
  setOption: vi.fn(),
  dispatchAction: vi.fn(),
  resize: vi.fn(),
  getOption: vi.fn(() => ({ series: [] })),
}));

// chart.ts imports from `echarts/core`, so mock that specifically.
// The submodules (echarts/charts, echarts/components, echarts/renderers)
// only export type + register-side-effect symbols we can no-op.
vi.mock('echarts/core', () => ({
  init: vi.fn(() => mockChart),
  use: vi.fn(),
  graphic: {
    LinearGradient: class {
      constructor(..._args: unknown[]) {}
    },
  },
}));
vi.mock('echarts/charts', () => ({
  LineChart: {},
}));
vi.mock('echarts/components', () => ({
  GridComponent: {},
  TooltipComponent: {},
  LegendComponent: {},
  DataZoomComponent: {},
  MarkLineComponent: {},
  MarkPointComponent: {},
}));
vi.mock('echarts/renderers', () => ({
  CanvasRenderer: {},
}));

// jsdom-safe stubs
vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
});

import {
  initializeChart,
  updateChart,
  updateProfileLines,
  resetChartZoom,
} from '../chart';
import { RoastState } from '../model';

describe('chart', () => {
  beforeEach(() => {
    mockChart.setOption.mockClear();
    mockChart.dispatchAction.mockClear();
  });

  describe('series id-merge (regression: BT/ET disappeared when editing profile mid-roast)', () => {
    it('initial setOption uses `id` on every series so ECharts merges by id, not by index', () => {
      const el = document.createElement('div');
      initializeChart(el);

      expect(mockChart.setOption).toHaveBeenCalled();
      const initialCall = mockChart.setOption.mock.calls[0][0];
      const seriesList: Array<{ id?: string; name?: string }> =
        initialCall.series ?? [];

      // Every series in the initial config must have an id — otherwise
      // subsequent partial setOption() calls (like updateProfileLines
      // which only sends 2 series) merge by index and clobber others.
      expect(seriesList.length).toBeGreaterThan(0);
      seriesList.forEach((s) => {
        expect(s.id).toBeDefined();
      });
    });

    it('updateChart sends every measurement series with an id (so profile-line updates don\'t clobber them)', () => {
      const el = document.createElement('div');
      const chart = initializeChart(el);
      mockChart.setOption.mockClear();

      const roast: RoastState = {
        startDate: new Date(),
        measurements: [
          {
            timestamp: new Date(),
            message: { ET: 150, BT: 100, Amb: 20, FanVal: 50, BurnerVal: 40, id: 1 },
          },
        ],
        events: [],
        commands: [],
      };
      updateChart(chart, roast);

      expect(mockChart.setOption).toHaveBeenCalled();
      const call = mockChart.setOption.mock.calls[0][0];
      const seriesList: Array<{ id?: string }> = call.series ?? [];
      expect(seriesList.length).toBeGreaterThan(0);
      seriesList.forEach((s) => {
        expect(s.id).toBeDefined();
      });
    });

    it('updateProfileLines sends its 2 series with ids so it merges into the existing chart', () => {
      const el = document.createElement('div');
      const chart = initializeChart(el);
      mockChart.setOption.mockClear();

      updateProfileLines(chart, {
        steps: [
          { interpolation: 'linear', setpoint: 100, duration: 60, fanValue: 50 },
        ],
      });

      expect(mockChart.setOption).toHaveBeenCalled();
      const call = mockChart.setOption.mock.calls[0][0];
      const seriesList: Array<{ id?: string }> = call.series ?? [];
      seriesList.forEach((s) => {
        expect(s.id).toBeDefined();
      });
    });
  });

  describe('resetChartZoom', () => {
    it('dispatches a dataZoom action back to the full range', () => {
      const el = document.createElement('div');
      const chart = initializeChart(el);
      mockChart.dispatchAction.mockClear();

      resetChartZoom(chart);

      expect(mockChart.dispatchAction).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'dataZoom', start: 0, end: 100 }),
      );
    });
  });
});
