import { Point, PipePath, Polygon } from '../types';

/**
 * Generate a circular arc as a series of points.
 * Angles in radians, using screen coordinates (Y increases downward).
 * Interpolates linearly from startAngle to endAngle (handles both
 * increasing and decreasing angle directions).
 */
function arcPts(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
  steps = 8,
): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = startAngle + (endAngle - startAngle) * (i / steps);
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

function almostEqual(a: number, b: number, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}

function samePoint(a: Point, b: Point, eps = 1e-6) {
  return almostEqual(a.x, b.x, eps) && almostEqual(a.y, b.y, eps);
}

function dedupePath(path: Point[]): Point[] {
  if (path.length <= 1) return path;
  const out: Point[] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    if (!samePoint(path[i], out[out.length - 1])) out.push(path[i]);
  }
  return out;
}

function roundOrthogonalPath(path: Point[], radius: number): Point[] {
  if (path.length < 3 || radius <= 0) return dedupePath(path);

  const src = dedupePath(path);
  if (src.length < 3) return src;

  const out: Point[] = [src[0]];

  for (let i = 1; i < src.length - 1; i++) {
    const prev = src[i - 1];
    const curr = src[i];
    const next = src[i + 1];

    const v1 = { x: curr.x - prev.x, y: curr.y - prev.y };
    const v2 = { x: next.x - curr.x, y: next.y - curr.y };
    const len1 = Math.hypot(v1.x, v1.y);
    const len2 = Math.hypot(v2.x, v2.y);
    if (len1 < 1e-9 || len2 < 1e-9) continue;

    const d1 = { x: v1.x / len1, y: v1.y / len1 };
    const d2 = { x: v2.x / len2, y: v2.y / len2 };

    const isOrthogonal = almostEqual(d1.x * d2.x + d1.y * d2.y, 0, 1e-6);
    if (!isOrthogonal) {
      out.push(curr);
      continue;
    }

    const trim = Math.min(radius, len1 / 2, len2 / 2);
    if (trim <= 1e-9) {
      out.push(curr);
      continue;
    }

    const pIn = { x: curr.x - d1.x * trim, y: curr.y - d1.y * trim };
    const pOut = { x: curr.x + d2.x * trim, y: curr.y + d2.y * trim };
    const turn = d1.x * d2.y - d1.y * d2.x;
    const nLeft = { x: -d1.y, y: d1.x };
    const center =
      turn > 0
        ? { x: pIn.x + nLeft.x * trim, y: pIn.y + nLeft.y * trim }
        : { x: pIn.x - nLeft.x * trim, y: pIn.y - nLeft.y * trim };

    const a0 = Math.atan2(pIn.y - center.y, pIn.x - center.x);
    let a1 = Math.atan2(pOut.y - center.y, pOut.x - center.x);
    if (turn > 0 && a1 < a0) a1 += 2 * Math.PI;
    if (turn < 0 && a1 > a0) a1 -= 2 * Math.PI;

    out.push(pIn);
    const arc = arcPts(center.x, center.y, trim, a0, a1, 6);
    for (let k = 1; k < arc.length; k++) out.push(arc[k]);
  }

  out.push(src[src.length - 1]);
  return dedupePath(out);
}

function generateInwardRectSpiral(
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  laneStep: number,
  inset: number,
): Point[] {
  let left = xMin + inset;
  let right = xMax - inset;
  let top = yMin + inset;
  let bottom = yMax - inset;
  if (right - left <= 0 || bottom - top <= 0) return [];

  const path: Point[] = [{ x: left, y: bottom }];

  for (let guard = 0; guard < 2000; guard++) {
    path.push({ x: right, y: bottom });
    bottom -= laneStep;
    if (top > bottom) break;

    path.push({ x: right, y: top });
    right -= laneStep;
    if (left > right) break;

    path.push({ x: left, y: top });
    top += laneStep;
    if (top > bottom) break;

    path.push({ x: left, y: bottom });
    left += laneStep;
    if (left > right) break;
  }

  return dedupePath(path);
}

function mirrorY(path: Point[], yMin: number, yMax: number): Point[] {
  return path.map((p) => ({ x: p.x, y: yMin + yMax - p.y }));
}

function mirrorX(path: Point[], xMin: number, xMax: number): Point[] {
  return path.map((p) => ({ x: xMin + xMax - p.x, y: p.y }));
}

function swapXY(path: Point[]): Point[] {
  return path.map((p) => ({ x: p.y, y: p.x }));
}

function generateDoubleSpiralBottom(
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  spacing: number,
): PipePath {
  const r = spacing / 2;
  if (xMax - xMin < spacing * 2 || yMax - yMin < spacing * 2) return [];

  const laneStep = spacing * 2;
  const outward = generateInwardRectSpiral(xMin, xMax, yMin, yMax, laneStep, r);
  if (outward.length < 2) return [];

  const inwardReturn = generateInwardRectSpiral(xMin, xMax, yMin, yMax, laneStep, r + spacing);
  const path = [...outward];

  if (inwardReturn.length > 1) {
    const centerTurn = inwardReturn[inwardReturn.length - 1];
    if (!samePoint(path[path.length - 1], centerTurn)) path.push(centerTurn);

    const returnOutward = [...inwardReturn].reverse();
    for (let i = 1; i < returnOutward.length; i++) path.push(returnOutward[i]);
  }

  return roundOrthogonalPath(path, r);
}

type ManifoldSide = 'bottom' | 'top' | 'left' | 'right';

function manifoldSide(
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  hint: Point,
): ManifoldSide {
  const outLeft = Math.max(0, xMin - hint.x);
  const outRight = Math.max(0, hint.x - xMax);
  const outTop = Math.max(0, yMin - hint.y);
  const outBottom = Math.max(0, hint.y - yMax);
  const maxOut = Math.max(outLeft, outRight, outTop, outBottom);

  if (maxOut > 0) {
    if (maxOut === outBottom) return 'bottom';
    if (maxOut === outTop) return 'top';
    if (maxOut === outLeft) return 'left';
    return 'right';
  }

  const inLeft = hint.x - xMin;
  const inRight = xMax - hint.x;
  const inTop = hint.y - yMin;
  const inBottom = yMax - hint.y;
  const minIn = Math.min(inLeft, inRight, inTop, inBottom);

  if (minIn === inBottom) return 'bottom';
  if (minIn === inTop) return 'top';
  if (minIn === inLeft) return 'left';
  return 'right';
}

/**
 * Generate a rectangular double-spiral pipe path (outbound + center turn + return),
 * using horizontal/vertical segments and rounded 90° corners.
 */
export function generateSerpentine(
  polygon: Polygon,
  spacingPx: number,
  connectionHint?: Point,
): PipePath {
  if (polygon.points.length < 3 || spacingPx <= 0) return [];

  const xs = polygon.points.map((p) => p.x);
  const ys = polygon.points.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);

  if (xMax - xMin <= 0 || yMax - yMin <= 0) return [];

  const hint = connectionHint ?? { x: (xMin + xMax) / 2, y: yMax + 1e9 };
  const side = manifoldSide(xMin, xMax, yMin, yMax, hint);

  if (side === 'bottom') {
    return generateDoubleSpiralBottom(xMin, xMax, yMin, yMax, spacingPx);
  }
  if (side === 'top') {
    return mirrorY(generateDoubleSpiralBottom(xMin, xMax, yMin, yMax, spacingPx), yMin, yMax);
  }

  const swapped = generateDoubleSpiralBottom(yMin, yMax, xMin, xMax, spacingPx);
  const mapped = swapXY(swapped);
  return side === 'left' ? mirrorX(mapped, xMin, xMax) : mapped;
}

/** Alias kept for backward-compatibility with store. */
export const generateSpiral = generateSerpentine;

/**
 * Find the start and end stub points of a serpentine/spiral path.
 */
export function getSpiralStubs(path: PipePath): { start: Point; end: Point } | null {
  if (path.length < 2) return null;
  return {
    start: path[0],
    end: path[path.length - 1],
  };
}
