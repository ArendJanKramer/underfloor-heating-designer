import type { Point } from '../types';

/** Scale a polygon uniformly by dragging one vertex; the farthest vertex stays fixed. */
export function scalePolygonFromVertex(
  points: Point[],
  vertexIndex: number,
  pointer: Point,
): Point[] {
  const dragged = points[vertexIndex];
  if (!dragged || points.length < 3) return points;

  const anchor = points.reduce((farthest, point) =>
    Math.hypot(point.x - dragged.x, point.y - dragged.y) >
    Math.hypot(farthest.x - dragged.x, farthest.y - dragged.y)
      ? point
      : farthest,
  points[0]);
  const dx = dragged.x - anchor.x;
  const dy = dragged.y - anchor.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return points;

  const projectedScale = ((pointer.x - anchor.x) * dx + (pointer.y - anchor.y) * dy)
    / lengthSquared;
  // Keep the polygon non-degenerate if the pointer passes through the anchor.
  const scale = Math.max(0.01, projectedScale);
  return points.map((point) => ({
    x: anchor.x + (point.x - anchor.x) * scale,
    y: anchor.y + (point.y - anchor.y) * scale,
  }));
}
