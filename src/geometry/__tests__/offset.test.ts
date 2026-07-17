import { describe, expect, it } from 'vitest';
import { ensureCCW, generateOffsetRings, offsetPolygon, polygonArea, signedArea } from '../offset';

const square = (size: number) => ({
  points: [
    { x: 0, y: 0 },
    { x: size, y: 0 },
    { x: size, y: size },
    { x: 0, y: size },
  ],
});

describe('signedArea', () => {
  it('should return positive area for CCW polygon', () => {
    const area = signedArea(square(100).points);
    expect(area).toBeCloseTo(10000);
  });

  it('should return negative area for CW polygon', () => {
    const cw = [...square(100).points].reverse();
    const area = signedArea(cw);
    expect(area).toBeCloseTo(-10000);
  });
});

describe('polygonArea', () => {
  it('should return absolute area for a square', () => {
    expect(polygonArea(square(10).points)).toBeCloseTo(100);
    expect(polygonArea([...square(10).points].reverse())).toBeCloseTo(100);
  });
});

describe('ensureCCW', () => {
  it('should not reverse a CCW polygon', () => {
    const points = square(100).points;
    const result = ensureCCW(points);
    expect(signedArea(result)).toBeGreaterThan(0);
  });

  it('should reverse a CW polygon', () => {
    const cw = [...square(100).points].reverse();
    const result = ensureCCW(cw);
    expect(signedArea(result)).toBeGreaterThan(0);
  });
});

describe('offsetPolygon', () => {
  it('should inward-offset a square and reduce its area', () => {
    const polygon = square(100);
    const offset = offsetPolygon(polygon, 10);
    expect(offset).not.toBeNull();
    if (offset) {
      expect(polygonArea(offset.points)).toBeLessThan(polygonArea(polygon.points));
    }
  });

  it('should return null when offset collapses the polygon', () => {
    const polygon = square(10);
    const result = offsetPolygon(polygon, 100);
    expect(result).toBeNull();
  });
});

describe('generateOffsetRings', () => {
  it('should generate multiple rings for a large square', () => {
    const polygon = square(200);
    const rings = generateOffsetRings(polygon, 20);
    expect(rings.length).toBeGreaterThan(2);
  });

  it('should generate at least 1 ring (the original polygon)', () => {
    const polygon = square(100);
    const rings = generateOffsetRings(polygon, 5);
    expect(rings.length).toBeGreaterThanOrEqual(1);
  });
});
