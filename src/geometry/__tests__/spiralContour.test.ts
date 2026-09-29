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

function crossingCount(path: Point[]): number {
  const cross = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  let count = 0;
  for (let i = 1; i < path.length; i++) {
    for (let j = i + 2; j < path.length; j++) {
      const a = path[i - 1]; const b = path[i];
      const c = path[j - 1]; const d = path[j];
      const abC = cross(a, b, c); const abD = cross(a, b, d);
      const cdA = cross(c, d, a); const cdB = cross(c, d, b);
      if (abC * abD < -1e-3 && cdA * cdB < -1e-3) count++;
    }
  }
  return count;
}

function coveredAreaFraction(path: Point[], polygon: Polygon, spacing: number): number {
  const xs = polygon.points.map(point => point.x);
  const ys = polygon.points.map(point => point.y);
  let inside = 0;
  let covered = 0;
  for (let x = Math.min(...xs) + 50; x < Math.max(...xs); x += 100) {
    for (let y = Math.min(...ys) + 50; y < Math.max(...ys); y += 100) {
      const point = { x, y };
      if (!pointInPolygon(point, polygon)) continue;
      inside++;
      if (path.some((end, index) => index > 0 &&
        distanceToSegment(point, path[index - 1], end) <= spacing * 0.7)) covered++;
    }
  }
  return covered / inside;
}

describe('generateSerpentine – non-rectangular zones (contour parallel)', () => {
  it('follows sloped walls while keeping the full pipe path inside a triangular zone', () => {
    const triangle: Polygon = { points: [
      { x: 0, y: 4000 }, { x: 2000, y: 0 }, { x: 4000, y: 4000 },
    ] };
    const path = generateSerpentine(triangle, 200, { x: 2000, y: 1e9 }, 100);
    expect(path.length).toBeGreaterThan(8);
    for (let i = 1; i < path.length; i++) {
      for (let fraction = 0; fraction <= 1; fraction += 0.1) {
        const sample = {
          x: path[i - 1].x + fraction * (path[i].x - path[i - 1].x),
          y: path[i - 1].y + fraction * (path[i].y - path[i - 1].y),
        };
        expect(pointInPolygon(sample, triangle, 2)).toBe(true);
      }
    }
    expect(path.some((point, i) => i > 0 && Math.abs(point.x - path[i - 1].x) > 1 && Math.abs(point.y - path[i - 1].y) > 1)).toBe(true);
    expect(coveredAreaFraction(path, triangle, 200)).toBeGreaterThan(0.8);
  });

  it('keeps turns inside a concave polygon with a sloped recess', () => {
    const room: Polygon = { points: [
      { x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 4000 },
      { x: 3200, y: 4000 }, { x: 2800, y: 1900 },
      { x: 1800, y: 1900 }, { x: 1400, y: 4000 }, { x: 0, y: 4000 },
    ] };
    const path = generateSerpentine(room, 200, { x: 2500, y: 1e9 }, 100);
    expect(path.length).toBeGreaterThan(8);
    for (let i = 1; i < path.length; i++) {
      for (let fraction = 0; fraction <= 1; fraction += 0.1) {
        const sample = {
          x: path[i - 1].x + fraction * (path[i].x - path[i - 1].x),
          y: path[i - 1].y + fraction * (path[i].y - path[i - 1].y),
        };
        expect(pointInPolygon(sample, room, 2)).toBe(true);
      }
    }
    expect(crossingCount(path)).toBe(0);
    expect(coveredAreaFraction(path, room, 200)).toBeGreaterThan(0.8);
  });

  it('keeps every point inside a diamond zone (no loops outside the polygon)', () => {
    const path = generateSerpentine(diamond, 150, { x: 2000, y: 1e9 }, 100);

    expect(path.length).toBeGreaterThan(4);
    for (const point of path) {
      expect(pointInPolygon(point, diamond, 2)).toBe(true);
    }
    expect(crossingCount(path)).toBe(0);

    const segmentLengths = path.slice(1).map((point, index) =>
      Math.hypot(point.x - path[index].x, point.y - path[index].y),
    );
    const axialLength = path.slice(1).reduce((sum, point, index) =>
      Math.abs(point.x - path[index].x) < 1 || Math.abs(point.y - path[index].y) < 1
        ? sum + segmentLengths[index] : sum,
    0);
    expect(axialLength / segmentLengths.reduce((sum, length) => sum + length, 0)).toBeLessThan(0.15);
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

  it('puts both contour ends on the requested manifold side', () => {
    const cases = [
      { hint: { x: 2000, y: 1e9 }, near: (point: Point) => point.y > 3000 },
      { hint: { x: 2000, y: -1e9 }, near: (point: Point) => point.y < 1000 },
      { hint: { x: 1e9, y: 2000 }, near: (point: Point) => point.x > 3000 },
      { hint: { x: -1e9, y: 2000 }, near: (point: Point) => point.x < 1000 },
    ];
    for (const { hint, near } of cases) {
      const path = generateSerpentine(diamond, 150, hint, 100);
      expect(path.length).toBeGreaterThan(4);
      expect(near(path[0])).toBe(true);
      expect(near(path[path.length - 1])).toBe(true);
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
