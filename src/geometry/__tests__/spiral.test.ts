import { describe, expect, it } from 'vitest';
import { pathLengthPx } from '../length';
import { generateSerpentine, getSpiralStubs } from '../spiral';

const rect = (w: number, h: number) => ({
  points: [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ],
});

describe('generateSerpentine – degenerate inputs', () => {
  it('returns empty path for too few polygon points', () => {
    expect(generateSerpentine({ points: [] }, 10)).toHaveLength(0);
    expect(generateSerpentine({ points: [{ x: 0, y: 0 }] }, 10)).toHaveLength(0);
  });

  it('returns empty path for zero spacing', () => {
    expect(generateSerpentine(rect(200, 200), 0)).toHaveLength(0);
  });

  it('returns empty path when zone is smaller than spacing', () => {
    expect(generateSerpentine(rect(5, 5), 50)).toHaveLength(0);
  });
});

describe('generateSerpentine – pass count', () => {
  it('generates an even number of passes for a 400×300 rect at 50 px spacing (V passes)', () => {
    // Manifold below → vertical passes
    // width=400, spacing=50 → N_raw=8 (already even) → 8 passes
    const hint = { x: 200, y: 10000 }; // far below → manifoldAtBottom
    const path = generateSerpentine(rect(400, 300), 50, hint);
    expect(path.length).toBeGreaterThan(4);

    // Both endpoints must be near y=300 (bottom edge, manifold side)
    const start = path[0];
    const end = path[path.length - 1];
    expect(start.y).toBeCloseTo(300, 0);
    expect(end.y).toBeCloseTo(300, 0);
  });

  it('generates an even number of passes for a 300×400 rect at 50 px spacing (H passes)', () => {
    // Manifold to the left
    const hint = { x: -10000, y: 200 }; // far left → manifoldAtLeft
    const path = generateSerpentine(rect(300, 400), 50, hint);
    expect(path.length).toBeGreaterThan(4);

    // Both endpoints must be near x=0 (left edge, manifold side)
    const start = path[0];
    const end = path[path.length - 1];
    expect(start.x).toBeCloseTo(0, 0);
    expect(end.x).toBeCloseTo(0, 0);
  });
});

describe('generateSerpentine – both endpoints near manifold edge', () => {
  it('V passes – both ends at the bottom for a wide zone', () => {
    const hint = { x: 200, y: 9999 }; // manifold far below
    const path = generateSerpentine(rect(600, 300), 60, hint);
    expect(path.length).toBeGreaterThan(2);
    const start = path[0];
    const end = path[path.length - 1];
    // Both must be close to y=300 (bottom edge)
    expect(Math.abs(start.y - 300)).toBeLessThan(5);
    expect(Math.abs(end.y - 300)).toBeLessThan(5);
  });

  it('H passes – both ends at the left for a tall zone', () => {
    const hint = { x: -9999, y: 300 }; // manifold far left
    const path = generateSerpentine(rect(300, 600), 60, hint);
    expect(path.length).toBeGreaterThan(2);
    const start = path[0];
    const end = path[path.length - 1];
    expect(Math.abs(start.x)).toBeLessThan(5);
    expect(Math.abs(end.x)).toBeLessThan(5);
  });
});

describe('generateSerpentine – path quality', () => {
  it('generates a longer path for smaller spacing (same zone)', () => {
    const loose = generateSerpentine(rect(400, 400), 80);
    const tight = generateSerpentine(rect(400, 400), 40);
    expect(pathLengthPx(tight)).toBeGreaterThan(pathLengthPx(loose));
  });

  it('path length for 200×200 zone at 20 px spacing is within expected bounds', () => {
    // ~10 passes × 200 px each ≈ 2000 px + arc overhead
    const path = generateSerpentine(rect(200, 200), 20);
    const len = pathLengthPx(path);
    // At least as long as 5 × 200 (conservative) and not more than 50 × 200 (very loose upper)
    expect(len).toBeGreaterThan(5 * 200);
    expect(len).toBeLessThan(50 * 200);
  });
});

describe('getSpiralStubs', () => {
  it('returns null for empty / single-point paths', () => {
    expect(getSpiralStubs([])).toBeNull();
    expect(getSpiralStubs([{ x: 0, y: 0 }])).toBeNull();
  });

  it('returns first and last point', () => {
    const path = generateSerpentine(rect(200, 200), 30);
    if (path.length > 1) {
      const stubs = getSpiralStubs(path);
      expect(stubs).not.toBeNull();
      expect(stubs?.start).toEqual(path[0]);
      expect(stubs?.end).toEqual(path[path.length - 1]);
    }
  });
});
