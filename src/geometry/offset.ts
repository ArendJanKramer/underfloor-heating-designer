import { Point, Polygon } from '../types';

/**
 * Compute the signed area of a polygon. Positive = CCW, Negative = CW.
 */
export function signedArea(points: Point[]): number {
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return area / 2;
}

/**
 * Ensure polygon is in CCW order (positive area).
 */
export function ensureCCW(points: Point[]): Point[] {
  return signedArea(points) < 0 ? [...points].reverse() : points;
}

/**
 * Offset a polygon inward by `distance` pixels.
 * Uses simple vertex-normal offset (Minkowski difference approach).
 * Works well for convex polygons; may produce artifacts on concave ones.
 * Returns null if the offset collapses the polygon.
 */
export function offsetPolygon(polygon: Polygon, distance: number): Polygon | null {
  const pts = ensureCCW(polygon.points);
  const n = pts.length;
  if (n < 3) return null;

  const offsetPoints: Point[] = [];

  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];

    const e1 = { x: curr.x - prev.x, y: curr.y - prev.y };
    const e2 = { x: next.x - curr.x, y: next.y - curr.y };

    const len1 = Math.sqrt(e1.x * e1.x + e1.y * e1.y);
    const len2 = Math.sqrt(e2.x * e2.x + e2.y * e2.y);
    if (len1 < 1e-10 || len2 < 1e-10) continue;

    const n1 = { x: -e1.y / len1, y: e1.x / len1 };
    const n2 = { x: -e2.y / len2, y: e2.x / len2 };

    const bisector = { x: n1.x + n2.x, y: n1.y + n2.y };
    const bisLen = Math.sqrt(bisector.x * bisector.x + bisector.y * bisector.y);

    if (bisLen < 1e-10) {
      offsetPoints.push({
        x: curr.x + n1.x * distance,
        y: curr.y + n1.y * distance,
      });
    } else {
      const dot = (bisector.x / bisLen) * n1.x + (bisector.y / bisLen) * n1.y;
      if (Math.abs(dot) < 1e-6) {
        offsetPoints.push({
          x: curr.x + n1.x * distance,
          y: curr.y + n1.y * distance,
        });
      } else {
        const scale = distance / dot;
        offsetPoints.push({
          x: curr.x + (bisector.x / bisLen) * scale,
          y: curr.y + (bisector.y / bisLen) * scale,
        });
      }
    }
  }

  if (offsetPoints.length < 3) return null;

  const area = Math.abs(signedArea(offsetPoints));
  if (area < 1) return null;

  const origArea = Math.abs(signedArea(pts));
  if (area > origArea * 1.1) return null;

  return { points: offsetPoints };
}

/**
 * Generate a series of inward-offset polygons until the polygon collapses.
 */
export function generateOffsetRings(polygon: Polygon, spacingPx: number): Polygon[] {
  const rings: Polygon[] = [polygon];
  let current = polygon;

  for (let i = 0; i < 1000; i++) {
    const next = offsetPolygon(current, spacingPx);
    if (!next || next.points.length < 3) break;
    rings.push(next);
    current = next;
  }

  return rings;
}

/**
 * Compute the centroid of a polygon.
 */
export function centroid(points: Point[]): Point {
  const n = points.length;
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  return { x: cx / n, y: cy / n };
}

/**
 * Compute polygon area (absolute value).
 */
export function polygonArea(points: Point[]): number {
  return Math.abs(signedArea(points));
}
