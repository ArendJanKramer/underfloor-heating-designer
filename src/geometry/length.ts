import { Point, PipePath } from '../types';

/**
 * Compute the Euclidean distance between two points (in pixels).
 */
export function distancePx(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Compute the total length of a polyline path (in pixels).
 */
export function pathLengthPx(path: PipePath): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += distancePx(path[i - 1], path[i]);
  }
  return total;
}

/**
 * Convert pixel length to meters using the calibration factor.
 */
export function pxToMeters(px: number, pixelsPerMeter: number): number {
  if (pixelsPerMeter <= 0) return 0;
  return px / pixelsPerMeter;
}

/**
 * Convert meters to pixels using the calibration factor.
 */
export function metersToPx(m: number, pixelsPerMeter: number): number {
  return m * pixelsPerMeter;
}

/**
 * Compute the length of a leader pipe from a stub point to the manifold (pixels).
 */
export function leaderLengthPx(stubPoint: Point, manifoldPos: Point): number {
  return distancePx(stubPoint, manifoldPos);
}
