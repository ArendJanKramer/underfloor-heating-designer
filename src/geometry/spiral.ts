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

/**
 * Generate a rectilinear serpentine path using VERTICAL passes.
 * Both ends of the path land near the bottom (manifoldAtBottom=true)
 * or top (manifoldAtBottom=false) edge.
 *
 * The serpentine uses N (even) vertical passes spaced by `spacing`.
 * Rounded U-turns (semicircles of radius = spacing/2) connect them.
 */
function generateVPasses(
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  spacing: number,
  manifoldAtBottom: boolean,
): PipePath {
  const r = spacing / 2;
  const width = xMax - xMin;
  if (width < spacing) return [];

  let N = Math.floor(width / spacing);
  if (N < 1) return [];
  if (N % 2 !== 0) N = Math.max(2, N - 1); // force even

  const x0 = xMin + r;
  const path: Point[] = [];

  const yNear = manifoldAtBottom ? yMax : yMin; // manifold-facing edge
  const yFar = manifoldAtBottom ? yMin : yMax;  // far edge

  for (let i = 0; i < N; i++) {
    const xi = x0 + i * spacing;
    const isFirst = i === 0;
    const isLast = i === N - 1;
    const goingAway = manifoldAtBottom ? i % 2 === 0 : i % 2 !== 0;

    if (isFirst) {
      path.push({ x: xi, y: yNear }); // start at manifold edge (full extent)
    }

    if (isLast) {
      // Last pass ends at manifold edge (full extent)
      path.push({ x: xi, y: yNear });
    } else if (goingAway) {
      // This pass goes toward the far edge, ending before it for the U-turn
      const yTurn = manifoldAtBottom ? yFar + r : yFar - r;
      path.push({ x: xi, y: yTurn });

      // U-turn at the far edge connecting xi to xi+spacing
      if (manifoldAtBottom) {
        // Top U-turn: from (xi, yMin+r) to (xi+spacing, yMin+r) going through (xi+r, yMin)
        // Center: (xi+r, yMin+r), angles π -> 2π (counterclockwise in math, left-to-right via top)
        const arc = arcPts(xi + r, yMin + r, r, Math.PI, 2 * Math.PI);
        for (let k = 1; k < arc.length; k++) path.push(arc[k]);
      } else {
        // Bottom U-turn: from (xi, yMax-r) to (xi+spacing, yMax-r) going through (xi+r, yMax)
        // Center: (xi+r, yMax-r), angles π -> 0 (clockwise in math, left-to-right via bottom)
        const arc = arcPts(xi + r, yMax - r, r, Math.PI, 0);
        for (let k = 1; k < arc.length; k++) path.push(arc[k]);
      }
    } else {
      // This pass goes back toward the manifold edge, ending before it for the U-turn
      const yTurn = manifoldAtBottom ? yNear - r : yNear + r;
      path.push({ x: xi, y: yTurn });

      // U-turn at the manifold edge connecting xi to xi+spacing
      if (manifoldAtBottom) {
        // Bottom U-turn: from (xi, yMax-r) to (xi+spacing, yMax-r) going through (xi+r, yMax)
        const arc = arcPts(xi + r, yMax - r, r, Math.PI, 0);
        for (let k = 1; k < arc.length; k++) path.push(arc[k]);
      } else {
        // Top U-turn
        const arc = arcPts(xi + r, yMin + r, r, Math.PI, 2 * Math.PI);
        for (let k = 1; k < arc.length; k++) path.push(arc[k]);
      }
    }
  }

  return path;
}

/**
 * Generate a rectilinear serpentine path using HORIZONTAL passes.
 * Both ends land near the left (manifoldAtLeft=true) or right edge.
 */
function generateHPasses(
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  spacing: number,
  manifoldAtLeft: boolean,
): PipePath {
  const r = spacing / 2;
  const height = yMax - yMin;
  if (height < spacing) return [];

  let N = Math.floor(height / spacing);
  if (N < 1) return [];
  if (N % 2 !== 0) N = Math.max(2, N - 1); // force even

  const y0 = yMin + r;
  const path: Point[] = [];

  const xNear = manifoldAtLeft ? xMin : xMax; // manifold-facing side
  const xFar = manifoldAtLeft ? xMax : xMin;  // far side

  for (let i = 0; i < N; i++) {
    const yi = y0 + i * spacing;
    const isFirst = i === 0;
    const isLast = i === N - 1;
    const goingAway = manifoldAtLeft ? i % 2 === 0 : i % 2 !== 0;

    if (isFirst) {
      path.push({ x: xNear, y: yi }); // start at manifold side (full extent)
    }

    if (isLast) {
      path.push({ x: xNear, y: yi }); // end at manifold side
    } else if (goingAway) {
      // Going away from manifold, end before far edge for U-turn
      const xTurn = manifoldAtLeft ? xFar - r : xFar + r;
      path.push({ x: xTurn, y: yi });

      // U-turn at the far edge
      if (manifoldAtLeft) {
        // Right U-turn: from (xMax-r, yi) to (xMax-r, yi+spacing) going through (xMax, yi+r)
        // Center: (xMax-r, yi+r), angles -π/2 -> π/2 (counterclockwise, right-bulge)
        const arc = arcPts(xMax - r, yi + r, r, -Math.PI / 2, Math.PI / 2);
        for (let k = 1; k < arc.length; k++) path.push(arc[k]);
      } else {
        // Left U-turn: from (xMin+r, yi) to (xMin+r, yi+spacing) going through (xMin, yi+r)
        // Center: (xMin+r, yi+r), angles 3π/2 -> π/2 (decreasing = left-bulge)
        const arc = arcPts(xMin + r, yi + r, r, (3 * Math.PI) / 2, Math.PI / 2);
        for (let k = 1; k < arc.length; k++) path.push(arc[k]);
      }
    } else {
      // Going back toward manifold, end before near edge for U-turn
      const xTurn = manifoldAtLeft ? xNear + r : xNear - r;
      path.push({ x: xTurn, y: yi });

      // U-turn at the manifold side
      if (manifoldAtLeft) {
        // Left U-turn: from (xMin+r, yi) to (xMin+r, yi+spacing) going through (xMin, yi+r)
        const arc = arcPts(xMin + r, yi + r, r, (3 * Math.PI) / 2, Math.PI / 2);
        for (let k = 1; k < arc.length; k++) path.push(arc[k]);
      } else {
        // Right U-turn
        const arc = arcPts(xMax - r, yi + r, r, -Math.PI / 2, Math.PI / 2);
        for (let k = 1; k < arc.length; k++) path.push(arc[k]);
      }
    }
  }

  return path;
}

/**
 * Generate a rectilinear serpentine pipe path for a zone polygon.
 *
 * The fill uses only horizontal/vertical straight runs joined by rounded
 * 180° U-turns (fillet radius = spacing/2).  The orientation (H or V passes)
 * is chosen so that BOTH endpoints of the path land near the zone edge that
 * is closest to the manifold – satisfying the double-lane return requirement
 * without diagonal segments.
 *
 * Algorithm summary
 * -----------------
 *  • Compute the zone bounding box.
 *  • Determine which bounding-box edge is closest to the manifold and run
 *    passes PARALLEL to that edge (V passes for top/bottom, H for left/right).
 *  • Force the pass count N to be even so that the boustrophedon starts and
 *    ends on the same side of the bounding box (the manifold-facing side).
 *  • At each end of a pass, insert a semicircular arc (radius = spacing/2)
 *    as the U-turn so all corners are rounded; no diagonal segments exist.
 *
 * This "even-N boustrophedon" acts as the double-lane / counter-flow
 * arrangement: the outgoing and returning runs are interleaved (odd/even
 * passes) and both open ends land near the manifold edge.
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

  // Default: treat manifold as far below the zone
  const hint = connectionHint ?? { x: (xMin + xMax) / 2, y: yMax + 1e9 };

  // How far the manifold protrudes outside each edge of the bounding box.
  // Using "protrusion" (max 0) means a manifold that is outside to the left
  // gets a large outLeft value, while a manifold inside the zone gets 0 for all.
  const outLeft   = Math.max(0, xMin - hint.x);   // manifold is to the left
  const outRight  = Math.max(0, hint.x - xMax);   // manifold is to the right
  const outTop    = Math.max(0, yMin - hint.y);   // manifold is above (smaller y in screen)
  const outBottom = Math.max(0, hint.y - yMax);   // manifold is below (larger y in screen)
  const maxOut = Math.max(outLeft, outRight, outTop, outBottom);

  if (maxOut > 0) {
    // Manifold is outside the zone – use the direction with the greatest protrusion
    if (maxOut === outBottom) return generateVPasses(xMin, xMax, yMin, yMax, spacingPx, true);
    if (maxOut === outTop)    return generateVPasses(xMin, xMax, yMin, yMax, spacingPx, false);
    if (maxOut === outLeft)   return generateHPasses(xMin, xMax, yMin, yMax, spacingPx, true);
    /* outRight */            return generateHPasses(xMin, xMax, yMin, yMax, spacingPx, false);
  }

  // Manifold is inside the zone – use the closest edge
  const inLeft   = hint.x - xMin;
  const inRight  = xMax - hint.x;
  const inTop    = hint.y - yMin;
  const inBottom = yMax - hint.y;
  const minIn = Math.min(inLeft, inRight, inTop, inBottom);

  if (minIn === inBottom) return generateVPasses(xMin, xMax, yMin, yMax, spacingPx, true);
  if (minIn === inTop)    return generateVPasses(xMin, xMax, yMin, yMax, spacingPx, false);
  if (minIn === inLeft)   return generateHPasses(xMin, xMax, yMin, yMax, spacingPx, true);
  /* inRight */           return generateHPasses(xMin, xMax, yMin, yMax, spacingPx, false);
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
