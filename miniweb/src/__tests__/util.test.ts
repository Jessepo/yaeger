import { describe, it, expect } from 'vitest';
import { getFormattedTimeDifference } from '../util';

describe('getFormattedTimeDifference', () => {
  it('formats exactly 0 seconds difference', () => {
    const d1 = new Date('2026-06-20T20:00:00.000Z');
    const d2 = new Date('2026-06-20T20:00:00.000Z');
    expect(getFormattedTimeDifference(d1, d2)).toBe('00:00');
  });

  it('formats positive differences with zero-padding', () => {
    const d1 = new Date('2026-06-20T20:00:00.000Z');
    const d2 = new Date('2026-06-20T20:00:05.000Z');
    expect(getFormattedTimeDifference(d1, d2)).toBe('00:05');
  });

  it('formats differences over a minute', () => {
    const d1 = new Date('2026-06-20T20:00:00.000Z');
    const d2 = new Date('2026-06-20T20:01:23.000Z');
    expect(getFormattedTimeDifference(d1, d2)).toBe('01:23');
  });

  it('handles negative ordering symmetrically (using absolute difference)', () => {
    const d1 = new Date('2026-06-20T20:01:23.000Z');
    const d2 = new Date('2026-06-20T20:00:00.000Z');
    expect(getFormattedTimeDifference(d1, d2)).toBe('01:23');
  });

  it('handles long differences', () => {
    const d1 = new Date('2026-06-20T20:00:00.000Z');
    const d2 = new Date('2026-06-20T21:15:30.000Z'); // 1 hour, 15 minutes, 30 seconds = 75 minutes, 30 seconds
    expect(getFormattedTimeDifference(d1, d2)).toBe('75:30');
  });
});
