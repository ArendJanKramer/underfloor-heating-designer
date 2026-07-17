import { Point, PipePath, Polygon } from '../types';
import { generateOffsetRings, centroid } from './offset';

function closestPointIndex(ring: Point[], target: Point): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const dx = ring[i].x - target.x;
    const dy = ring[i].y - target.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function rotateArray<T>(arr: T[], startIdx: number): T[] {
  return [...arr.slice(startIdx), ...arr.slice(0, startIdx)];
}

/**
 * Generate a bifilar (counter-flow) spiral path for a zone polygon.
 */
export function generateSpiral(
  polygon: Polygon,
  spacingPx: number,
  connectionHint?: Point,
): PipePath {
  if (polygon.points.length < 3 || spacingPx <= 0) return [];

  const rings = generateOffsetRings(polygon, spacingPx / 2);
  if (rings.length === 0) return [];

  const c = centroid(polygon.points);
  const hint = connectionHint ?? { x: c.x, y: c.y + 1e9 };
  const path: PipePath = [];

  const outerRing = rings[0].points;
  const startIdx = closestPointIndex(outerRing, hint);

  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r].points;
    const startI =
      r === 0 ? startIdx : closestPointIndex(ring, path[path.length - 1] ?? ring[0]);
    const rotated = rotateArray(ring, startI);

    if (r % 2 === 0) {
      for (const pt of rotated) {
        path.push(pt);
      }
    } else {
      for (let i = rotated.length - 1; i >= 0; i--) {
        path.push(rotated[i]);
      }
    }
  }

  return path;
}

/**
 * Find the start and end stub points of a spiral path.
 */
export function getSpiralStubs(path: PipePath): { start: Point; end: Point } | null {
  if (path.length < 2) return null;
  return {
    start: path[0],
    end: path[path.length - 1],
  };
}
