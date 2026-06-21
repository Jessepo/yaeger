import { describe, it, expect } from 'vitest';
import {
  followProfile,
  pointsFromProfile,
  profileFromPoints,
  rdpSimplify,
  roastToProfile,
  ProfilePoint
} from '../profiling';
import { Profile, RoastState } from '../model';

describe('Profile conversion roundtrip (Drift Fix Verification)', () => {
  it('converts points to profile steps and back without changing timestamps (drift-free)', () => {
    const originalPoints: ProfilePoint[] = [
      { time: 0, setpoint: 100, fan: 50 },
      { time: 60, setpoint: 150, fan: 60 },
      { time: 180, setpoint: 200, fan: 70 },
      { time: 300, setpoint: 220, fan: 80 }
    ];

    // Roundtrip 1
    const profile = profileFromPoints(originalPoints);
    const roundtripPoints1 = pointsFromProfile(profile);

    expect(roundtripPoints1).toEqual(originalPoints);

    // Roundtrip 2 (simulate repeated edits)
    const profile2 = profileFromPoints(roundtripPoints1);
    const roundtripPoints2 = pointsFromProfile(profile2);

    expect(roundtripPoints2).toEqual(originalPoints);
  });

  it('handles empty points gracefully', () => {
    expect(profileFromPoints([])).toEqual({ steps: [] });
    expect(pointsFromProfile({ steps: [] })).toEqual([]);
  });
});

describe('followProfile', () => {
  it('returns undefined if roast.startDate is missing', () => {
    const prof: Profile = {
      steps: [{ interpolation: 'linear', setpoint: 100, duration: 60 }]
    };
    const roast: RoastState = {
      startDate: undefined as any,
      measurements: [],
      events: [],
      commands: []
    };
    expect(followProfile(prof, roast)).toBeUndefined();
  });

  it('interpolates setpoint linearly', () => {
    const prof: Profile = {
      steps: [
        { interpolation: 'linear', setpoint: 100, duration: 0.01 }, // anchor
        { interpolation: 'linear', setpoint: 200, duration: 100 }
      ]
    };
    
    // Test halfway through the step (50s)
    const startDate = new Date(new Date().getTime() - 50 * 1000);
    const roast: RoastState = { startDate, measurements: [], events: [], commands: [] };
    
    const result = followProfile(prof, roast);
    expect(result).toBeDefined();
    // Start is 100, end is 200. Halfway (50s / 100.01s)
    // accumulated time is 100.01.
    // progress is (50 - 0.01) / 100 = 49.99 / 100 = 0.4999
    // setpoint is 100 + 100 * 0.4999 = 149.99
    // Math.floor(149.99 * 10) / 10 = 149.9
    expect(result!.setPoint).toBe(149.9);
  });

  it('returns last setpoint and fanValue when elapsed time exceeds profile duration', () => {
    const prof: Profile = {
      steps: [
        { interpolation: 'linear', setpoint: 100, duration: 0.01, fanValue: 40 },
        { interpolation: 'linear', setpoint: 200, duration: 60, fanValue: 60 }
      ]
    };
    
    // Test at 100s (exceeds 60.01s total duration)
    const startDate = new Date(new Date().getTime() - 100 * 1000);
    const roast: RoastState = { startDate, measurements: [], events: [], commands: [] };
    
    const result = followProfile(prof, roast);
    expect(result).toBeDefined();
    expect(result!.setPoint).toBe(200);
    expect(result!.fanValue).toBe(60);
  });
});

describe('rdpSimplify', () => {
  it('simplifies collinear points correctly', () => {
    const points: [number, number][] = [
      [0, 100],
      [10, 110], // collinear
      [20, 120]
    ];
    const simplified = rdpSimplify(points, 0.1);
    expect(simplified).toEqual([
      [0, 100],
      [20, 120]
    ]);
  });
});

describe('roastToProfile', () => {
  it('returns empty array if no measurements', () => {
    const roast: RoastState = {
      startDate: new Date(),
      measurements: [],
      events: [],
      commands: []
    };
    expect(roastToProfile(roast)).toEqual([]);
  });

  it('correctly simplifies and converts a mock roast into profile points', () => {
    const startDate = new Date();
    const measurements = Array.from({ length: 100 }, (_, i) => ({
      timestamp: new Date(startDate.getTime() + i * 1000),
      message: {
        ET: 150 + i * 0.5,
        BT: 100 + i * 1.0,
        Amb: 20,
        FanVal: 50,
        BurnerVal: 60,
        id: i
      }
    }));

    const roast: RoastState = {
      startDate,
      measurements,
      events: [
        { label: 'charge', measurement: measurements[0] },
        { label: 'drop', measurement: measurements[measurements.length - 1] }
      ],
      commands: [
        { type: 'fan', value: 50, timestamp: startDate }
      ]
    };

    const points = roastToProfile(roast, { trimToEvents: true });
    expect(points.length).toBeGreaterThan(0);
    expect(points[0].time).toBe(0);
    // Since BT goes from 100 to 199 linearly, it should be highly simplified
    expect(points.length).toBeLessThanOrEqual(4);
    expect(points[0].setpoint).toBeCloseTo(105.5);
    expect(points[points.length - 1].time).toBe(99);
    expect(points[points.length - 1].setpoint).toBeCloseTo(193.5);
    expect(points[points.length - 1].fan).toBe(50);
  });
});
