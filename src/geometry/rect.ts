import { Point } from '../types';

const RECT_EPSILON = 1e-6;

/** True when `points` form a 4-point axis-aligned rectangle (every edge purely horizontal or vertical). */
export function isAxisAlignedRect(points: Point[]): boolean {
  if (points.length !== 4) return false;
  return points.every((point, i) => {
    const next = points[(i + 1) % 4];
    return Math.abs(point.x - next.x) < RECT_EPSILON || Math.abs(point.y - next.y) < RECT_EPSILON;
  });
}

/**
 * Move one corner of an axis-aligned rectangle to `newPos`, dragging its two
 * adjacent corners along so the shape stays a rectangle (like a resize
 * handle) instead of turning into an arbitrary quadrilateral. The opposite
 * corner stays fixed.
 */
export function resizeRectFromCorner(points: Point[], draggedIndex: number, newPos: Point): Point[] {
  const opposite = points[(draggedIndex + 2) % 4];
  const draggedOriginal = points[draggedIndex];
  const result = [...points];
  result[draggedIndex] = newPos;

  for (const offset of [1, 3]) {
    const idx = (draggedIndex + offset) % 4;
    const sharesX = Math.abs(points[idx].x - draggedOriginal.x) < RECT_EPSILON;
    result[idx] = sharesX ? { x: newPos.x, y: opposite.y } : { x: opposite.x, y: newPos.y };
  }

  return result;
}

/** Project a dragged corner onto the rectangle's original diagonal to keep its aspect ratio. */
export function constrainRectCornerToAspect(
  points: Point[],
  draggedIndex: number,
  pointer: Point,
): Point {
  const opposite = points[(draggedIndex + 2) % 4];
  const original = points[draggedIndex];
  const dx = original.x - opposite.x;
  const dy = original.y - opposite.y;
  const diagonalSquared = dx * dx + dy * dy;
  if (Math.abs(dx) < RECT_EPSILON || Math.abs(dy) < RECT_EPSILON) return pointer;

  const scale = ((pointer.x - opposite.x) * dx + (pointer.y - opposite.y) * dy)
    / diagonalSquared;
  return { x: opposite.x + dx * scale, y: opposite.y + dy * scale };
}
