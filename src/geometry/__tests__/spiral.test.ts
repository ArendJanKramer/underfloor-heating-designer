import { describe, expect, it } from 'vitest';
import { pathLengthPx } from '../length';
import { generateSpiral, getSpiralStubs } from '../spiral';

const square = (size: number) => ({
  points: [
    { x: 0, y: 0 },
    { x: size, y: 0 },
    { x: size, y: size },
    { x: 0, y: size },
  ],
});

describe('generateSpiral', () => {
  it('should return empty path for degenerate input', () => {
    expect(generateSpiral({ points: [] }, 10)).toHaveLength(0);
    expect(generateSpiral({ points: [{ x: 0, y: 0 }] }, 10)).toHaveLength(0);
    expect(generateSpiral(square(100), 0)).toHaveLength(0);
  });

  it('should generate a path for a 200x200 square with 20px spacing', () => {
    const spiral = generateSpiral(square(200), 20);
    expect(spiral.length).toBeGreaterThan(4);
  });

  it('should generate a longer path for smaller spacing', () => {
    const loose = generateSpiral(square(200), 40);
    const tight = generateSpiral(square(200), 20);
    expect(pathLengthPx(tight)).toBeGreaterThan(pathLengthPx(loose));
  });

  it('spiral length for a known square (approx sanity check)', () => {
    const spiral = generateSpiral(square(200), 20);
    expect(pathLengthPx(spiral)).toBeGreaterThan(100);
  });
});

describe('getSpiralStubs', () => {
  it('should return null for empty path', () => {
    expect(getSpiralStubs([])).toBeNull();
    expect(getSpiralStubs([{ x: 0, y: 0 }])).toBeNull();
  });

  it('should return start and end points', () => {
    const spiral = generateSpiral(square(200), 30);
    if (spiral.length > 1) {
      const stubs = getSpiralStubs(spiral);
      expect(stubs).not.toBeNull();
      expect(stubs?.start).toEqual(spiral[0]);
      expect(stubs?.end).toEqual(spiral[spiral.length - 1]);
    }
  });
});
