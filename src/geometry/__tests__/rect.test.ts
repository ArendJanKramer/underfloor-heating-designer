import { describe, expect, it } from 'vitest';
import { constrainRectCornerToAspect, resizeRectFromCorner } from '../rect';

describe('Shift-constrained rectangle resizing', () => {
  it('keeps the opposite corner fixed and preserves a landscape ratio', () => {
    const points = [
      { x: 0, y: 0 }, { x: 4000, y: 0 },
      { x: 4000, y: 2000 }, { x: 0, y: 2000 },
    ];
    const corner = constrainRectCornerToAspect(points, 2, { x: 5000, y: 2000 });
    const resized = resizeRectFromCorner(points, 2, corner);

    expect(resized[0]).toEqual(points[0]);
    expect((resized[2].x - resized[0].x) / (resized[2].y - resized[0].y)).toBeCloseTo(2);
    expect(resized[2].x).toBeGreaterThan(points[2].x);
    expect(resized[2].y).toBeGreaterThan(points[2].y);
  });

  it('preserves a portrait ratio from the opposite corner', () => {
    const points = [
      { x: 100, y: 200 }, { x: 2100, y: 200 },
      { x: 2100, y: 4200 }, { x: 100, y: 4200 },
    ];
    const corner = constrainRectCornerToAspect(points, 0, { x: -900, y: -200 });
    const resized = resizeRectFromCorner(points, 0, corner);

    expect(resized[2]).toEqual(points[2]);
    expect(Math.abs((resized[2].x - resized[0].x) / (resized[2].y - resized[0].y))).toBeCloseTo(0.5);
  });
});
