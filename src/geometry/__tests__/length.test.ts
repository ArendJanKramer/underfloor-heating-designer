import { describe, expect, it } from 'vitest';
import { distancePx, metersToPx, pathLengthPx, pxToMeters } from '../length';

describe('distancePx', () => {
  it('should compute distance between two points', () => {
    expect(distancePx({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5);
    expect(distancePx({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(0);
  });
});

describe('pathLengthPx', () => {
  it('should return 0 for empty or single-point path', () => {
    expect(pathLengthPx([])).toBe(0);
    expect(pathLengthPx([{ x: 1, y: 1 }])).toBe(0);
  });

  it('should compute total path length', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 4 },
    ];
    expect(pathLengthPx(path)).toBeCloseTo(7);
  });
});

describe('pxToMeters / metersToPx', () => {
  it('should convert px to meters correctly', () => {
    expect(pxToMeters(100, 100)).toBeCloseTo(1);
    expect(pxToMeters(200, 100)).toBeCloseTo(2);
    expect(pxToMeters(0, 100)).toBe(0);
  });

  it('should handle zero pixelsPerMeter', () => {
    expect(pxToMeters(100, 0)).toBe(0);
  });

  it('should be inverse of metersToPx', () => {
    const pixelsPerMeter = 150;
    const meters = 3.5;
    const pixels = metersToPx(meters, pixelsPerMeter);
    expect(pxToMeters(pixels, pixelsPerMeter)).toBeCloseTo(meters);
  });
});
