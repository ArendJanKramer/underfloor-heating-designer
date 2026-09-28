import { describe, expect, it } from 'vitest';
import type { Point, Polygon } from '../../types';
import { generateSerpentine } from '../spiral';

const diamond: Polygon = {
  points: [
    { x: 2000, y: 0 },
    { x: 4000, y: 2000 },
    { x: 2000, y: 4000 },
    { x: 0, y: 2000 },
  ],
};

/** Ray-casting point-in-polygon with a small outward tolerance. */
function pointInPolygon(point: Point, polygon: Polygon, tolerance = 1): boolean {
  const { x, y } = point;
  let inside = false;
  const pts = polygon.points;

  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xj = pts[j].x;
    const yj = pts[j].y;

    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }

  if (inside) return true;

  // Allow points sitting essentially on the boundary (offset rounding).
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const dist = distanceToSegment(point, pts[j], pts[i]);
    if (dist <= tolerance) return true;
  }

  return false;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

describe('generateSerpentine – non-rectangular zones (contour parallel)', () => {
  it('keeps every point inside a diamond zone (no loops outside the polygon)', () => {
    const path = generateSerpentine(diamond, 150, { x: 2000, y: 1e9 }, 100);

    expect(path.length).toBeGreaterThan(4);
    for (const point of path) {
      expect(pointInPolygon(point, diamond, 2)).toBe(true);
    }
  });

  it('stays well inside the bounding box corners of the diamond', () => {
    const path = generateSerpentine(diamond, 150, { x: 2000, y: 1e9 }, 100);

    // A bounding-box spiral would reach the rectangle corners (0,0)/(200,0)/...
    // The contour spiral must not: every point stays clear of those corners.
    const cornerRegions: Point[] = [
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 4000 },
      { x: 0, y: 4000 },
    ];

    for (const corner of cornerRegions) {
      const nearCorner = path.some(
        (point) => Math.hypot(point.x - corner.x, point.y - corner.y) < 800,
      );
      expect(nearCorner).toBe(false);
    }
  });

  it('still uses the rectangular generator for axis-aligned rectangles', () => {
    const rect: Polygon = {
      points: [
        { x: 0, y: 0 },
        { x: 4000, y: 0 },
        { x: 4000, y: 3000 },
        { x: 0, y: 3000 },
      ],
    };
    const path = generateSerpentine(rect, 150, { x: 2000, y: 1e9 });
    expect(path.length).toBeGreaterThan(4);

    // Rectangular counter-flow spiral keeps both ends near the manifold edge.
    const start = path[0];
    const end = path[path.length - 1];
    expect(start.y).toBeGreaterThan(2000);
    expect(end.y).toBeGreaterThan(1500);
  });
});
