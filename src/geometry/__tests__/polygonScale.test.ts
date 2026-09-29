import { describe, expect, it } from 'vitest';
import { scalePolygonFromVertex } from '../polygonScale';

describe('scalePolygonFromVertex', () => {
  const points = [
    { x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 5000, y: 2000 },
    { x: 3000, y: 4000 }, { x: 0, y: 3000 },
  ];

  it('keeps the farthest vertex fixed and scales every other vertex uniformly', () => {
    const scaled = scalePolygonFromVertex(points, 2, { x: 10000, y: 4000 });
    expect(scaled).toEqual(points.map((point) => ({ x: point.x * 2, y: point.y * 2 })));
    expect(points[0]).toEqual({ x: 0, y: 0 });
  });

  it('prevents the polygon from collapsing at its anchor', () => {
    const scaled = scalePolygonFromVertex(points, 2, { x: 0, y: 0 });
    expect(scaled[0]).toEqual({ x: 0, y: 0 });
    expect(scaled[2].x).toBeGreaterThan(0);
  });
});
