import { Point, PipePath, Polygon } from '../types';
import { PIPE_BEND_RADIUS_MM } from '../pipeSpec';
import ClipperLib from 'clipper-lib';
import { ensureCCW, signedArea } from './offset';

type ManifoldSide = 'top' | 'right' | 'bottom' | 'left';

const EPSILON = 1e-6;

/**
 * Radius the spiral's own corners are formed at, millimetres.
 *
 * Half the pipe spacing is the preference: it makes each ring's corner concentric with the
 * ring outside it, so the passes stay their spacing apart right through the corner instead
 * of bunching up. But it is only a preference — below 2 × PIPE_BEND_RADIUS_MM of spacing it
 * asks for a bend tighter than the pipe will take, and there the pipe's own minimum wins.
 * A wider corner costs nothing at a right angle: both rings move off the corner by the same
 * amount along the same diagonal, so the gap between them is unchanged.
 */
export function spiralBendRadiusMm(spacingMm: number): number {
    return Math.max(PIPE_BEND_RADIUS_MM, spacingMm / 2);
}

/**
 * How far a hand-drawn corner may sit off-square before the edge is taken as a genuine
 * diagonal rather than a wobble — millimetres, like everything else here.
 *
 * Sized from how precisely a corner can be clicked, not from pipe spacing: a click is
 * placed to about a screen pixel, which is roughly 10 mm of drawing with a whole house on
 * screen, and an edge collects that error at both ends. Anything tighter rejects ordinary
 * hand-drawn polygons outright — `snapManuallyDrawnRectilinearPolygon` returns null and
 * the zone renders no spiral at all. Real diagonal walls run far longer than this and are
 * still left alone.
 */
const POLYGON_SNAP_TOLERANCE_MM = 50;

/**
 * Generate a circular arc as a series of points.
 * Angles use screen coordinates, where Y increases downward.
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
        const t = i / steps;
        const angle = startAngle + (endAngle - startAngle) * t;

        pts.push({
            x: cx + r * Math.cos(angle),
            y: cy + r * Math.sin(angle),
        });
    }

    return pts;
}

function samePoint(a: Point, b: Point): boolean {
    return (
        Math.abs(a.x - b.x) < EPSILON &&
        Math.abs(a.y - b.y) < EPSILON
    );
}

function pushUnique(path: Point[], point: Point): void {
    if (path.length === 0 || !samePoint(path[path.length - 1], point)) {
        path.push(point);
    }
}

/**
 * Remove duplicate and collinear points.
 */
function simplifyOrthogonalPath(points: Point[]): Point[] {
    const result: Point[] = [];

    for (const point of points) {
        pushUnique(result, point);

        while (result.length >= 3) {
            const a = result[result.length - 3];
            const b = result[result.length - 2];
            const c = result[result.length - 1];

            const sameX =
                Math.abs(a.x - b.x) < EPSILON &&
                Math.abs(b.x - c.x) < EPSILON;

            const sameY =
                Math.abs(a.y - b.y) < EPSILON &&
                Math.abs(b.y - c.y) < EPSILON;

            if (!sameX && !sameY) break;

            result.splice(result.length - 2, 1);
        }
    }

    return result;
}

type Segment = {
    a: Point;
    b: Point;
};

function getSegments(path: Point[]): Segment[] {
    const segments: Segment[] = [];

    for (let i = 1; i < path.length; i++) {
        segments.push({
            a: path[i - 1],
            b: path[i],
        });
    }

    return segments;
}

function isVertical(segment: Segment): boolean {
    return Math.abs(segment.a.x - segment.b.x) < EPSILON;
}

/**
 * Find every X coordinate at which the polygon boundary crosses a
 * horizontal line at the given Y, paired up into inside/outside intervals.
 */
function polygonRowIntervals(polygon: Polygon, y: number): [number, number][] {
    const pts = polygon.points;
    const n = pts.length;
    const xs: number[] = [];

    for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % n];

        const aBelow = a.y <= y;
        const bBelow = b.y <= y;

        // Edge does not cross this scanline.
        if (aBelow === bBelow) continue;

        const t = (y - a.y) / (b.y - a.y);
        xs.push(a.x + t * (b.x - a.x));
    }

    xs.sort((p, q) => p - q);

    const intervals: [number, number][] = [];

    for (let i = 0; i + 1 < xs.length; i += 2) {
        intervals.push([xs[i], xs[i + 1]]);
    }

    return intervals;
}

/**
 * Same as polygonRowIntervals, but for a vertical line at the given X.
 */
function polygonColumnIntervals(polygon: Polygon, x: number): [number, number][] {
    const pts = polygon.points;
    const n = pts.length;
    const ys: number[] = [];

    for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % n];

        const aLeft = a.x <= x;
        const bLeft = b.x <= x;

        if (aLeft === bLeft) continue;

        const t = (x - a.x) / (b.x - a.x);
        ys.push(a.y + t * (b.y - a.y));
    }

    ys.sort((p, q) => p - q);

    const intervals: [number, number][] = [];

    for (let i = 0; i + 1 < ys.length; i += 2) {
        intervals.push([ys[i], ys[i + 1]]);
    }

    return intervals;
}

/** A ring opened at one vertex; the two cut sides form a corridor for the spiral turns. */
function openContourRing(
    ring: Point[],
    cutIndex: number,
    spacing: number,
    fromSide: 'a' | 'b',
): PipePath {
    const n = ring.length;
    const cut = ring[cutIndex];
    const prev = ring[(cutIndex - 1 + n) % n];
    const next = ring[(cutIndex + 1) % n];
    const cutPoint = (neighbor: Point): Point => {
        const length = Math.hypot(neighbor.x - cut.x, neighbor.y - cut.y);
        const fraction = Math.min(spacing * 0.75 / length, 0.35);
        return {
            x: cut.x + (neighbor.x - cut.x) * fraction,
            y: cut.y + (neighbor.y - cut.y) * fraction,
        };
    };
    const a = cutPoint(prev);
    const b = cutPoint(next);
    const result: PipePath = [fromSide === 'a' ? a : b];
    for (let step = 1; step < n; step++) {
        result.push(ring[(cutIndex + (fromSide === 'a' ? -step : step) + n) % n]);
    }
    result.push(fromSide === 'a' ? b : a);
    return result;
}

function contourSelfIntersects(points: Point[]): boolean {
    const cross = (a: Point, b: Point, c: Point) =>
        (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        for (let j = i + 2; j < points.length; j++) {
            if (i === 0 && j === points.length - 1) continue;
            const c = points[j];
            const d = points[(j + 1) % points.length];
            if (cross(a, b, c) * cross(a, b, d) < -EPSILON &&
                cross(c, d, a) * cross(c, d, b) < -EPSILON) return true;
        }
    }
    return false;
}

function pointInsidePolygon(point: Point, polygon: Point[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i];
        const b = polygon[j];
        if ((a.y > point.y) !== (b.y > point.y) &&
            point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) {
            inside = !inside;
        }
    }
    return inside;
}

function contourStaysInside(inner: Point[], outer: Point[]): boolean {
    return inner.every((point, index) => {
        const next = inner[(index + 1) % inner.length];
        return [0, 0.25, 0.5, 0.75].every(fraction => pointInsidePolygon({
            x: point.x + (next.x - point.x) * fraction,
            y: point.y + (next.y - point.y) * fraction,
        }, outer));
    });
}

function contourPathIsValid(path: PipePath, polygon: Point[]): boolean {
    const cross = (a: Point, b: Point, c: Point) =>
        (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    for (let i = 1; i < path.length; i++) {
        const a = path[i - 1];
        const b = path[i];
        if (![0, 0.25, 0.5, 0.75, 1].every(fraction => pointInsidePolygon({
            x: a.x + (b.x - a.x) * fraction,
            y: a.y + (b.y - a.y) * fraction,
        }, polygon))) return false;
        for (let edge = 0; edge < polygon.length; edge++) {
            const c = polygon[edge];
            const d = polygon[(edge + 1) % polygon.length];
            if (cross(a, b, c) * cross(a, b, d) < -EPSILON &&
                cross(c, d, a) * cross(c, d, b) < -EPSILON) return false;
        }
        for (let j = i + 2; j < path.length; j++) {
            const c = path[j - 1];
            const d = path[j];
            if (cross(a, b, c) * cross(a, b, d) < -EPSILON &&
                cross(c, d, a) * cross(c, d, b) < -EPSILON) return false;
        }
    }
    return true;
}

/** Offset the complete outline, resolving the loops that form at concave corners. */
function insetPolygonContours(polygon: Polygon, distance: number): Point[][] {
    const scale = 1000;
    const offset = new ClipperLib.ClipperOffset(2, 0.25 * scale);
    offset.AddPath(
        polygon.points.map(point => ({
            X: Math.round(point.x * scale),
            Y: Math.round(point.y * scale),
        })),
        ClipperLib.JoinType.jtMiter,
        ClipperLib.EndType.etClosedPolygon,
    );
    const result = new ClipperLib.Paths();
    offset.Execute(result, -distance * scale);
    return result.map(path => ensureCCW(path.map(point => ({
        x: point.X / scale,
        y: point.Y / scale,
    }))));
}

/** Inward contours joined at an opening, with a return through that opening. */
function generatePolygonContourSerpentine(polygon: Polygon, spacing: number): PipePath {
    if (contourSelfIntersects(polygon.points)) return [];
    const rings: Point[][] = [];
    let previousArea = Math.abs(signedArea(polygon.points));
    for (let index = 0; index < 200; index++) {
        const insets = insetPolygonContours(polygon, spacing * (index + 0.5));
        // Once a neck closes, the remaining pockets need separate pipe circuits.
        if (insets.length !== 1) break;
        const inset = insets[0];
        const area = Math.abs(signedArea(inset));
        if (area >= previousArea - EPSILON || area < spacing * spacing ||
            contourSelfIntersects(inset) ||
            !contourStaysInside(inset, rings[rings.length - 1] ?? polygon.points)) break;
        rings.push(inset);
        previousArea = area;
    }
    if (rings.length === 0) return [];

    // Either bottom corner can be the opening. In a concave room one lobe may
    // collapse sooner, so choose the side that reaches the deepest valid contour.
    const cuts = [true, false].map(right => rings.map(ring => ring.reduce(
        (chosen, point, index, points) =>
            point.y > points[chosen].y + EPSILON ||
            (Math.abs(point.y - points[chosen].y) < EPSILON &&
                (right ? point.x > points[chosen].x : point.x < points[chosen].x))
                ? index : chosen,
        0,
    )));
    const buildPath = (count: number, cutIndices: number[]): PipePath => {
        const path: PipePath = [];
        for (let index = 0; index < count; index++) {
            const fromSide = index % 2 === 0 ? 'a' : 'b';
            for (const point of openContourRing(rings[index], cutIndices[index], spacing, fromSide)) {
                pushUnique(path, point);
            }
        }
        for (let index = count - 1; index >= 0; index--) {
            pushUnique(path, rings[index][cutIndices[index]]);
        }
        return path;
    };

    // A deep contour may move its opening across a concave neck. Keep the
    // deepest prefix whose connecting and return segments remain usable.
    for (let count = rings.length; count > 0; count--) {
        for (const cutIndices of cuts) {
            const path = buildPath(count, cutIndices);
            if (contourPathIsValid(path, polygon.points)) return path;
        }
    }
    return [];
}

/**
 * Clamp the horizontal range [minX, maxX] at height y to whichever polygon
 * interval is closest to anchorX (the endpoint that is already known to be
 * valid). Returns null when no polygon interval overlaps the range at all,
 * meaning this scanline has no usable material to route through.
 */
function clampRowExtent(
    polygon: Polygon,
    y: number,
    minX: number,
    maxX: number,
    anchorX: number,
): { min: number; max: number } | null {
    const intervals = polygonRowIntervals(polygon, y);

    let best: [number, number] | null = null;
    let bestDistance = Infinity;

    for (const interval of intervals) {
        const overlapMin = Math.max(interval[0], minX);
        const overlapMax = Math.min(interval[1], maxX);

        if (overlapMin > overlapMax + EPSILON) continue;

        const distance =
            anchorX < interval[0]
                ? interval[0] - anchorX
                : anchorX > interval[1]
                    ? anchorX - interval[1]
                    : 0;

        if (distance < bestDistance) {
            bestDistance = distance;
            best = [overlapMin, overlapMax];
        }
    }

    if (!best) return null;
    return { min: best[0], max: best[1] };
}

/**
 * Vertical counterpart of clampRowExtent.
 */
function clampColumnExtent(
    polygon: Polygon,
    x: number,
    minY: number,
    maxY: number,
    anchorY: number,
): { min: number; max: number } | null {
    const intervals = polygonColumnIntervals(polygon, x);

    let best: [number, number] | null = null;
    let bestDistance = Infinity;

    for (const interval of intervals) {
        const overlapMin = Math.max(interval[0], minY);
        const overlapMax = Math.min(interval[1], maxY);

        if (overlapMin > overlapMax + EPSILON) continue;

        const distance =
            anchorY < interval[0]
                ? interval[0] - anchorY
                : anchorY > interval[1]
                    ? anchorY - interval[1]
                    : 0;

        if (distance < bestDistance) {
            bestDistance = distance;
            best = [overlapMin, overlapMax];
        }
    }

    if (!best) return null;
    return { min: best[0], max: best[1] };
}

/**
 * Remove duplicate/collinear vertices from a closed polygon and verify every
 * remaining edge is purely horizontal or vertical. Returns null if the
 * polygon isn't a valid simple rectilinear polygon (e.g. it has a diagonal
 * wall) - callers should fall back to the bounding-box method in that case.
 */

/**
 * Snap tiny drawing inaccuracies to horizontal/vertical edges.
 *
 * Manual drawing often produces coordinates such as (100, 49.9997) instead
 * of (100, 50). Those tiny errors previously made an L-shape look diagonal
 * and caused cleanRectilinearPolygon() to return null.
 *
 * Real diagonal walls are still rejected: only edges whose smaller axis
 * movement is within `tolerance` are snapped.
 */
function snapManuallyDrawnRectilinearPolygon(
    points: Point[],
    tolerance: number,
): Point[] | null {
    if (points.length < 3) return null;

    const result = points.map(point => ({
        x: point.x,
        y: point.y,
    }));

    if (
        result.length > 1 &&
        samePoint(
            result[0],
            result[result.length - 1],
        )
    ) {
        result.pop();
    }

    if (result.length < 3) return null;

    for (let i = 0; i < result.length; i++) {
        const current = result[i];
        const next =
            result[(i + 1) % result.length];

        const dx = next.x - current.x;
        const dy = next.y - current.y;

        if (
            Math.abs(dx) < EPSILON &&
            Math.abs(dy) < EPSILON
        ) {
            continue;
        }

        if (Math.abs(dx) <= tolerance) {
            next.x = current.x;
            continue;
        }

        if (Math.abs(dy) <= tolerance) {
            next.y = current.y;
            continue;
        }

        // This is a real diagonal edge, not drawing noise.
        return null;
    }

    return result;
}

function cleanRectilinearPolygon(points: Point[]): Point[] | null {
    if (points.length < 4) return null;

    const dedup: Point[] = [];
    for (const p of points) {
        if (dedup.length === 0 || !samePoint(dedup[dedup.length - 1], p)) {
            dedup.push(p);
        }
    }
    if (dedup.length > 1 && samePoint(dedup[0], dedup[dedup.length - 1])) {
        dedup.pop();
    }
    if (dedup.length < 4) return null;

    const n = dedup.length;
    const merged: Point[] = [];

    for (let i = 0; i < n; i++) {
        const prev = dedup[(i - 1 + n) % n];
        const curr = dedup[i];
        const next = dedup[(i + 1) % n];

        const inDx = curr.x - prev.x;
        const inDy = curr.y - prev.y;
        const outDx = next.x - curr.x;

        // Every edge must be purely horizontal or vertical.
        if (Math.abs(inDx) > EPSILON && Math.abs(inDy) > EPSILON) return null;

        const inIsVertical = Math.abs(inDx) < EPSILON;
        const outIsVertical = Math.abs(outDx) < EPSILON;

        // Drop vertices where the incoming and outgoing edges run the same
        // direction - not an actual corner, just a redundant point.
        if (inIsVertical === outIsVertical) continue;

        merged.push(curr);
    }

    if (merged.length < 4) return null;

    for (let i = 0; i < merged.length; i++) {
        const a = merged[i];
        const b = merged[(i + 1) % merged.length];
        if (Math.abs(a.x - b.x) > EPSILON && Math.abs(a.y - b.y) > EPSILON) {
            return null;
        }
    }

    return merged;
}

/**
 * Erode a simple rectilinear polygon inward by distance d (mitered/sharp
 * corners, not rounded). Every edge keeps its vertex index across calls
 * with different d, which lets the spiral reuse the same "seam" edge index
 * on every ring.
 *
 * Returns null if the offset collapses the shape (an edge would have to
 * reverse direction to stay simple) - that's the erosion running out of
 * room, and callers should treat it as "this ring doesn't fit."
 */
function offsetRectilinearPolygon(points: Point[], d: number): Point[] | null {
    const n = points.length;
    if (n < 4) return null;

    let signedArea = 0;
    for (let i = 0; i < n; i++) {
        const a = points[i];
        const b = points[(i + 1) % n];
        signedArea += a.x * b.y - b.x * a.y;
    }
    if (Math.abs(signedArea) < EPSILON) return null;
    const orientation = signedArea >= 0 ? 1 : -1;

    const offsetCoord: number[] = new Array(n);
    const edgeIsVertical: boolean[] = new Array(n);

    for (let i = 0; i < n; i++) {
        const a = points[i];
        const b = points[(i + 1) % n];
        const dx = b.x - a.x;
        const dy = b.y - a.y;

        if (Math.abs(dx) > EPSILON && Math.abs(dy) > EPSILON) return null;

        edgeIsVertical[i] = Math.abs(dx) < EPSILON;

        // Inward normal: rotate the edge direction 90 degrees, oriented by
        // the polygon's winding so it always points into the interior.
        let nx = -dy;
        let ny = dx;
        const len = Math.hypot(nx, ny);
        if (len < EPSILON) return null;
        nx = (nx / len) * orientation;
        ny = (ny / len) * orientation;

        offsetCoord[i] = edgeIsVertical[i] ? a.x + nx * d : a.y + ny * d;
    }

    const result: Point[] = new Array(n);

    for (let i = 0; i < n; i++) {
        const prev = (i - 1 + n) % n;
        const prevVertical = edgeIsVertical[prev];
        const currVertical = edgeIsVertical[i];

        // Consecutive edges must alternate direction on a clean rectilinear
        // polygon; if they don't, something upstream wasn't simplified.
        if (prevVertical === currVertical) return null;

        result[i] = {
            x: prevVertical ? offsetCoord[prev] : offsetCoord[i],
            y: prevVertical ? offsetCoord[i] : offsetCoord[prev],
        };
    }

    // An edge that reversed direction relative to the original means the
    // shape closed up (a corridor got eroded away to nothing) at this d.
    for (let i = 0; i < n; i++) {
        const a = points[i];
        const b = points[(i + 1) % n];
        const ra = result[i];
        const rb = result[(i + 1) % n];

        if ((b.x - a.x) * (rb.x - ra.x) < -EPSILON) return null;
        if ((b.y - a.y) * (rb.y - ra.y) < -EPSILON) return null;
    }

    return result;
}

/**
 * Locate the leftmost vertical edge of a polygon. This is used as a fixed
 * "seam" - the same edge index is reused on every eroded ring so each ring
 * is entered and exited in a consistent place, matching the bounding-box
 * spiral's convention of always cutting along the left side.
 */
function findSeamEdgeIndex(points: Point[]): number | null {
    let bestIndex: number | null = null;
    let bestX = Infinity;

    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        if (Math.abs(a.x - b.x) > EPSILON) continue;

        if (a.x < bestX - EPSILON) {
            bestX = a.x;
            bestIndex = i;
        }
    }

    return bestIndex;
}

/**
 * Trace a ring's boundary starting just after the seam edge's top endpoint,
 * all the way around, ending at the seam edge's bottom endpoint - i.e. every
 * vertex of the ring except the seam edge itself, which is left open so the
 * spiral can pass through it to reach the next ring.
 */
function traceRingFromSeam(
    points: Point[],
    seamIndex: number,
): { seamTop: Point; seamBottom: Point; path: Point[] } | null {
    const n = points.length;
    const a = points[seamIndex];
    const b = points[(seamIndex + 1) % n];

    if (Math.abs(a.x - b.x) > EPSILON) return null;

    const aIsTop = a.y <= b.y;
    const top = aIsTop ? a : b;
    const bottom = aIsTop ? b : a;

    const path: Point[] = [];

    if (aIsTop) {
        let i = seamIndex;
        for (;;) {
            path.push(points[i]);
            if (i === (seamIndex + 1) % n) break;
            i = (i - 1 + n) % n;
        }
    } else {
        let i = (seamIndex + 1) % n;
        for (;;) {
            path.push(points[i]);
            if (i === seamIndex) break;
            i = (i + 1) % n;
        }
    }

    return { seamTop: top, seamBottom: bottom, path };
}

/**
 * Build one lane (supply or return) by walking successively-eroded copies
 * of the room's actual shape, connecting consecutive rings with a short
 * two-segment jog at the seam. `startOffset` is the erosion distance of the
 * outermost ring; each further ring erodes 2 * spacing more, matching the
 * bounding-box spiral's pitch.
 */
function buildBoundaryFollowingLane(
    basePolygon: Point[],
    seamIndex: number,
    spacing: number,
    height: number,
    startOffset: number,
): Point[] {
    let offset = startOffset;
    let ring = offsetRectilinearPolygon(basePolygon, offset);
    let trace = ring ? traceRingFromSeam(ring, seamIndex) : null;

    if (!trace) return [];

    const path: Point[] = [];

    // Open end at the manifold edge.
    path.push({ x: trace.seamTop.x, y: height });

    for (;;) {
        /*
         * Don't let this ring's trace close all the way back to its own
         * seam - the incoming bridge already occupies that line, so
         * finishing the loop there would cross straight back over it.
         * Instead, truncate the ring's last (horizontal) edge early. This
         * mirrors how the rectangle spiral never retraces its own left
         * edge either.
         */
        const withoutSeamBottom = trace.path.slice(0, -1);
        for (const p of withoutSeamBottom) {
            pushUnique(path, p);
        }

        const nextOffset = offset + 2 * spacing;
        const nextRing = offsetRectilinearPolygon(basePolygon, nextOffset);
        const nextTrace = nextRing ? traceRingFromSeam(nextRing, seamIndex) : null;

        if (!nextTrace) {
            /*
             * No further ring fits. Leave this end open here - no seam
             * bottom, no truncation jog - exactly like the rectangle
             * spiral, which stops right after its top+right sides and
             * lets addFinalCenterLeg/alignCenterEndpoints finish the
             * connection into the U-turn.
             */
            break;
        }

        const secondLast = withoutSeamBottom[withoutSeamBottom.length - 1];
        const lastEdgeY = trace.seamBottom.y;
        const nextSeamX = nextTrace.seamTop.x;

        const edgeMin = Math.min(secondLast.x, trace.seamBottom.x);
        const edgeMax = Math.max(secondLast.x, trace.seamBottom.x);

        if (nextSeamX >= edgeMin - EPSILON && nextSeamX <= edgeMax + EPSILON) {
            // The next ring's seam lands cleanly on this edge - truncate here.
            pushUnique(path, { x: nextSeamX, y: lastEdgeY });
        } else {
            /*
             * Rare fallback: the next ring's seam doesn't fall within this
             * edge's span (a big jump in shape between rings). Finish this
             * ring's own edge, then jog over - still never re-touches the
             * incoming bridge line, since the jog happens at a fresh Y.
             */
            pushUnique(path, trace.seamBottom);
            pushUnique(path, { x: nextSeamX, y: trace.seamBottom.y });
        }

        pushUnique(path, nextTrace.seamTop);

        ring = nextRing;
        trace = nextTrace;
        offset = nextOffset;
    }

    return simplifyOrthogonalPath(path);
}

/**
 * Generate the supply and return lanes by eroding the room's actual polygon
 * ring by ring, rather than clamping nested rectangles to it. This follows
 * concave boundaries (notches, L/T/U/staircase shapes) far more closely,
 * since every ring conforms to the true shape instead of a shrinking
 * bounding-box rectangle.
 *
 * Returns null when the polygon isn't a clean simple rectilinear shape (has
 * a diagonal wall, self-intersects, etc.) or when not even the outermost
 * ring fits - callers should fall back to the bounding-box method.
 */
function computeBoundaryFollowingSpiral(
    polygon: Polygon,
    spacing: number,
    height: number,
): { supply: Point[]; returnInward: Point[] } | null {
    const basePolygon = cleanRectilinearPolygon(polygon.points);
    if (!basePolygon) return null;

    const seamIndex = findSeamEdgeIndex(basePolygon);
    if (seamIndex === null) return null;

    const halfSpacing = spacing / 2;

    const supply = buildBoundaryFollowingLane(
        basePolygon,
        seamIndex,
        spacing,
        height,
        halfSpacing,
    );

    const returnInward = buildBoundaryFollowingLane(
        basePolygon,
        seamIndex,
        spacing,
        height,
        halfSpacing + spacing,
    );

    if (supply.length < 2 || returnInward.length < 2) return null;

    return { supply, returnInward };
}

/**
 * Find the furthest safe X coordinate for a new leftward horizontal segment.
 *
 * Besides the straight segment, this reserves room for:
 * - normal pipe-to-pipe clearance;
 * - the center U-turn, which bulges farther left by turnRadius;
 * - the polygon boundary itself, when provided.
 */
function clampLeftwardCenterLeg(
    startX: number,
    desiredX: number,
    y: number,
    paths: Point[][],
    spacing: number,
    turnReach: number,
    polygon?: Polygon,
): number {
    let safeX = desiredX;

    /*
     * The centerline must remain one spacing away from existing pipework.
     * The center turn also extends turnReach to the left.
     */
    const requiredClearance = spacing + turnReach;

    for (const path of paths) {
        const segments = getSegments(path);

        /*
         * Ignore the final segment of each path. That is the segment from which
         * the new center leg begins, so touching it is intentional.
         */
        for (let i = 0; i < segments.length - 1; i++) {
            const segment = segments[i];

            if (!isVertical(segment)) continue;

            const obstacleX = segment.a.x;
            const obstacleTop = Math.min(segment.a.y, segment.b.y);
            const obstacleBottom = Math.max(segment.a.y, segment.b.y);

            /*
             * Include vertical clearance as well. A rounded corner belonging to the
             * existing segment may extend slightly beyond its raw endpoints.
             */
            const intersectsYBand =
                y >= obstacleTop - spacing / 2 &&
                y <= obstacleBottom + spacing / 2;

            if (!intersectsYBand) continue;

            /*
             * Only obstacles lying along the proposed leftward route matter.
             */
            if (
                obstacleX < startX - EPSILON &&
                obstacleX > desiredX - requiredClearance
            ) {
                safeX = Math.max(
                    safeX,
                    obstacleX + requiredClearance,
                );
            }
        }
    }

    if (polygon) {
        /*
         * Don't let the leg (or the U-turn it feeds into) leave the polygon.
         * If the polygon has no usable material near startX at this height,
         * refuse to move at all so the caller drops the leg instead of
         * routing it outside the shape.
         */
        const row = clampRowExtent(polygon, y, safeX, startX, startX);
        safeX = row ? row.min : startX;
    }

    return safeX;
}

/**
 * Add one final pair of horizontal center legs, but only when both lanes have
 * a collision-free route.
 */
function addFinalCenterLeg(
    supply: Point[],
    returnInward: Point[],
    spacing: number,
    bendRadius: number,
    polygon?: Polygon,
): boolean {
    if (supply.length < 4 || returnInward.length < 4) {
        return false;
    }

    const supplyEnd = supply[supply.length - 1];
    const supplyPrevious = supply[supply.length - 2];

    const returnEnd = returnInward[returnInward.length - 1];
    const returnPrevious = returnInward[returnInward.length - 2];

    const supplyEndsVertically =
        Math.abs(supplyEnd.x - supplyPrevious.x) < EPSILON;

    const returnEndsVertically =
        Math.abs(returnEnd.x - returnPrevious.x) < EPSILON;

    if (!supplyEndsVertically || !returnEndsVertically) {
        return false;
    }

    const supplyInnerLeft = supply[supply.length - 4].x;
    const returnInnerLeft =
        returnInward[returnInward.length - 4].x;

    const desiredX = Math.max(
        supplyInnerLeft,
        returnInnerLeft,
    );

    const centerLaneDistance = Math.abs(
        supplyEnd.y - returnEnd.y,
    );

    if (centerLaneDistance < EPSILON) {
        return false;
    }

    /*
     * Turning a leg off the straight each lane currently ends on puts a corner at both ends
     * of that straight. It was only ever asked to carry one, so a leg is off the table when
     * it hasn't the length for two.
     */
    const minimumApproach = 2 * bendRadius - EPSILON;

    if (
        laneSegmentLength(supply, supply.length - 1) < minimumApproach ||
        laneSegmentLength(returnInward, returnInward.length - 1) < minimumApproach
    ) {
        return false;
    }

    /*
     * The turn joining the lanes is a half circle, over whatever the gap between them has
     * been opened out to, and so reaches its own radius past where they stop.
     */
    const turnReach = Math.max(bendRadius, centerLaneDistance / 2);
    const allPaths = [supply, returnInward];

    const safeSupplyX = clampLeftwardCenterLeg(
        supplyEnd.x,
        desiredX,
        supplyEnd.y,
        allPaths,
        spacing,
        turnReach,
        polygon,
    );

    const safeReturnX = clampLeftwardCenterLeg(
        returnEnd.x,
        desiredX,
        returnEnd.y,
        allPaths,
        spacing,
        turnReach,
        polygon,
    );

    /*
     * Both endpoints must share the same X coordinate for the semicircular
     * center turn. Use the more conservative result.
     */
    const safeX = Math.max(
        safeSupplyX,
        safeReturnX,
    );

    /*
     * Do not add a tiny leg. It carries the corner where it turns off the ring, which eats
     * a radius off it, and hands what is left to the center turn.
     */
    const minimumLegLength = Math.max(spacing / 2, bendRadius);

    if (
        supplyEnd.x - safeX < minimumLegLength ||
        returnEnd.x - safeX < minimumLegLength
    ) {
        return false;
    }

    supply.push({
        x: safeX,
        y: supplyEnd.y,
    });

    returnInward.push({
        x: safeX,
        y: returnEnd.y,
    });

    return true;
}

/**
 * Round the corners of a polyline. Right angles - every corner of a spiral - take an
 * exact quarter-circle fillet; other angles (a leader cutting diagonally into the
 * manifold) get the general tangent-length fillet, which reduces to the same thing at
 * 90 degrees.
 */
export function roundPathCorners(
    points: Point[],
    preferredRadius: number,
    arcSteps = 4,
): Point[] {
    if (points.length < 3) return [...points];

    const result: Point[] = [];
    pushUnique(result, points[0]);

    for (let i = 1; i < points.length - 1; i++) {
        const previous = points[i - 1];
        const corner = points[i];
        const next = points[i + 1];

        const incoming = {
            x: corner.x - previous.x,
            y: corner.y - previous.y,
        };

        const outgoing = {
            x: next.x - corner.x,
            y: next.y - corner.y,
        };

        const incomingLength = Math.hypot(incoming.x, incoming.y);
        const outgoingLength = Math.hypot(outgoing.x, outgoing.y);

        if (
            incomingLength < EPSILON ||
            outgoingLength < EPSILON
        ) {
            continue;
        }

        const inDirection = {
            x: incoming.x / incomingLength,
            y: incoming.y / incomingLength,
        };

        const outDirection = {
            x: outgoing.x / outgoingLength,
            y: outgoing.y / outgoingLength,
        };

        const alignment =
            inDirection.x * outDirection.x +
            inDirection.y * outDirection.y;

        // Straight through, or doubling back on itself: nothing to fillet.
        if (Math.abs(alignment) > 1 - EPSILON) {
            pushUnique(result, corner);
            continue;
        }

        const isRightAngle = Math.abs(alignment) < EPSILON;

        /*
         * How far back along each leg the arc has to start. A quarter-circle
         * fillet leaves exactly `radius`; a shallower turn leaves less, a
         * sharper one more, by the half-angle of the deflection.
         */
        const deflection = Math.acos(Math.max(-1, Math.min(1, alignment)));
        const tangentRatio = isRightAngle ? 1 : Math.tan(deflection / 2);

        /*
         * A straight between two corners is halved so both fillets get a share of it. The
         * two at the ends of the path are not shared with anything, so this corner may run
         * all the way out to the open end - which is what lets a path finish on a proper
         * radius instead of one scaled to its last straight.
         */
        const incomingShare = i === 1 ? incomingLength : incomingLength / 2;
        const outgoingShare =
            i === points.length - 2 ? outgoingLength : outgoingLength / 2;

        const tangentLength = Math.min(
            preferredRadius * tangentRatio,
            incomingShare,
            outgoingShare,
        );

        const radius = tangentLength / tangentRatio;

        if (radius < EPSILON) {
            pushUnique(result, corner);
            continue;
        }

        const arcStart = {
            x: corner.x - inDirection.x * tangentLength,
            y: corner.y - inDirection.y * tangentLength,
        };

        const arcEnd = {
            x: corner.x + outDirection.x * tangentLength,
            y: corner.y + outDirection.y * tangentLength,
        };

        /*
         * The center sits one radius off arcStart, square to the incoming leg
         * on the side being turned towards. For an axis-aligned 90-degree
         * fillet that direction is simply the outgoing one.
         */
        const turnSign = Math.sign(
            inDirection.x * outDirection.y -
            inDirection.y * outDirection.x,
        );
        const inwardDirection = isRightAngle
            ? outDirection
            : {
                x: -inDirection.y * turnSign,
                y: inDirection.x * turnSign,
            };

        const center = {
            x: arcStart.x + inwardDirection.x * radius,
            y: arcStart.y + inwardDirection.y * radius,
        };

        const startAngle = Math.atan2(
            arcStart.y - center.y,
            arcStart.x - center.x,
        );

        const endAngle = Math.atan2(
            arcEnd.y - center.y,
            arcEnd.x - center.x,
        );

        const cross =
            inDirection.x * outDirection.y -
            inDirection.y * outDirection.x;

        let angleDelta = endAngle - startAngle;

        if (cross > 0) {
            while (angleDelta <= 0) angleDelta += Math.PI * 2;
        } else {
            while (angleDelta >= 0) angleDelta -= Math.PI * 2;
        }

        pushUnique(result, arcStart);

        const arc = arcPts(
            center.x,
            center.y,
            radius,
            startAngle,
            startAngle + angleDelta,
            arcSteps,
        );

        for (let k = 1; k < arc.length; k++) {
            pushUnique(result, arc[k]);
        }
    }

    pushUnique(result, points[points.length - 1]);
    return result;
}

/**
 * One ring of the outer (supply) spiral, already clamped against the
 * polygon. `right`/`bottom` are this ring's far corner; `nextLeft`/`nextTop`
 * is where the following ring begins.
 */
type RingFrame = {
    right: number;
    bottom: number;
    nextLeft: number;
    nextTop: number;
};

/**
 * Walk the outer spiral ring-by-ring, conforming each ring to the polygon.
 *
 * Coordinates are canonical:
 * - the manifold is at the bottom;
 * - width runs left to right;
 * - height runs top to bottom.
 *
 * When `polygon` is supplied (also in canonical space), every ring is
 * conformed to it: each of the four edges of a ring is clamped against a
 * scanline through the polygon at that row/column, so the spiral hugs
 * concave boundaries while every run stays purely horizontal or vertical.
 * If a scanline has no usable polygon material at all, the spiral simply
 * stops there rather than routing outside the shape.
 *
 * This only computes ONE spiral (the outer/supply lane). The return lane is
 * derived from these exact frames by insetting them by `spacing` - see
 * `framesToPath` - rather than being clamped against the polygon
 * separately. Two independently-clamped lanes can drift toward each other
 * near a concave corner (each picks whichever polygon interval happens to
 * be closest to its own anchor) and end up overlapping; deriving the return
 * lane from the supply lane's own geometry guarantees the two stay exactly
 * `spacing` apart everywhere, including through notches.
 */
function computeSpiralFrames(
    width: number,
    height: number,
    spacing: number,
    polygon?: Polygon,
): { left: number; top: number; frames: RingFrame[] } | null {
    const halfSpacing = spacing / 2;

    let left = halfSpacing;
    let top = halfSpacing;
    let right = width - halfSpacing;
    let bottom = height - halfSpacing;

    if (
        right - left < spacing ||
        bottom - top < spacing
    ) {
        return null;
    }

    const initialLeft = left;
    const initialTop = top;
    const frames: RingFrame[] = [];

    for (;;) {
        /*
         * Across the top. Clamp how far right this edge can reach without
         * leaving the polygon, anchored at the already-valid left edge.
         */
        if (polygon) {
            const topRow = clampRowExtent(polygon, top, left, right, left);
            if (!topRow) break;
            right = topRow.max;
        }

        /*
         * Down the right side. Clamp how far down this edge can reach.
         */
        if (polygon) {
            const rightColumn = clampColumnExtent(polygon, right, top, bottom, top);
            if (!rightColumn) break;
            bottom = rightColumn.max;
        }

        let nextLeft = left + 2 * spacing;
        let nextTop = top + 2 * spacing;
        const nextRight = right - 2 * spacing;
        const nextBottom = bottom - 2 * spacing;

        /*
         * Continue toward the next inner ring when enough room remains.
         * The pitch is 2 * spacing because the return spiral occupies the
         * intermediate lane.
         */
        const minimumCenterSpan = 0;

        if (
            nextRight - nextLeft < minimumCenterSpan - EPSILON ||
            nextBottom - nextTop < minimumCenterSpan - EPSILON
        ) {
            break;
        }

        /*
         * Move along the lower side into the next ring, pulling nextLeft
         * rightward if the polygon boundary cuts in from the left here.
         */
        if (polygon) {
            const bottomRow = clampRowExtent(polygon, bottom, nextLeft, right, right);
            if (!bottomRow) break;
            nextLeft = Math.max(nextLeft, bottomRow.min);
        }

        /*
         * Move up the next inner left side, pulling nextTop downward if the
         * polygon boundary cuts in from above here.
         */
        if (polygon) {
            const leftColumn = clampColumnExtent(polygon, nextLeft, nextTop, bottom, bottom);
            if (!leftColumn) break;
            nextTop = Math.max(nextTop, leftColumn.min);
        }

        frames.push({ right, bottom, nextLeft, nextTop });

        left = nextLeft;
        top = nextTop;
        right = nextRight;
        bottom = nextBottom;
    }

    return { left: initialLeft, top: initialTop, frames };
}

/**
 * Turn a shared frame list into a concrete lane. `inset` is 0 for the
 * supply (outer) lane and `spacing` for the return (inner) lane, so the
 * return path is always exactly `spacing` inside the supply path on every
 * ring - never independently clamped, so it can never drift closer than
 * `spacing` or cross over.
 */
function framesToPath(
    initialLeft: number,
    initialTop: number,
    height: number,
    frames: RingFrame[],
    inset: number,
): Point[] {
    let left = initialLeft + inset;
    let top = initialTop + inset;

    const path: Point[] = [];

    // Open end at the manifold edge.
    path.push({ x: left, y: height });
    path.push({ x: left, y: top });

    for (const frame of frames) {
        const right = frame.right - inset;
        const bottom = frame.bottom - inset;

        // Insetting this ring left no room for this lane; stop here.
        if (right - left < EPSILON || bottom - top < EPSILON) break;

        path.push({ x: right, y: top });
        path.push({ x: right, y: bottom });

        const nextLeft = frame.nextLeft + inset;
        const nextTop = frame.nextTop + inset;

        if (right - nextLeft < EPSILON || bottom - nextTop < EPSILON) break;

        path.push({ x: nextLeft, y: bottom });
        path.push({ x: nextLeft, y: nextTop });

        left = nextLeft;
        top = nextTop;
    }

    return simplifyOrthogonalPath(path);
}

/** Length of the straight ending at `lane[index]`, or Infinity where there isn't one. */
function laneSegmentLength(lane: Point[], index: number): number {
    const end = lane[index];
    const start = lane[index - 1];

    if (!start || !end) return Infinity;

    return Math.hypot(end.x - start.x, end.y - start.y);
}

/**
 * Whether the innermost `length` points of a lane end in straights long enough to form
 * their corners at `bendRadius`.
 *
 * A corner eats one radius off each of the two straights meeting there, so a straight with
 * a corner at both ends needs twice the radius to give. The final one has a corner at one
 * end only - the other runs into the center turn, which leaves tangentially and so costs it
 * nothing - and needs a single radius.
 */
function laneTailFitsBendRadius(
    lane: Point[],
    length: number,
    bendRadius: number,
): boolean {
    return (
        laneSegmentLength(lane, length - 1) >= bendRadius - EPSILON &&
        laneSegmentLength(lane, length - 2) >= 2 * bendRadius - EPSILON
    );
}

/**
 * How much of both lanes can be kept before the corners they end on get tighter than the
 * pipe's bend radius.
 *
 * A spiral's innermost ring is whatever is left over when the winding runs out of room, so
 * its last sides can be arbitrarily short - down to a single pitch, which folds the pipe
 * back on itself far tighter than it bends. Giving that up costs a little coverage right at
 * the middle, where the center turn wants the room anyway.
 *
 * One length covers both lanes: they are built ring for ring from the same frames, so equal
 * lengths is what keeps point i of one the partner of point i of the other, which
 * everything downstream (the center leg, the center turn) assumes.
 */
function laneLengthWithinBendRadius(
    supply: Point[],
    returnInward: Point[],
    bendRadius: number,
    maxLength: number,
): number {
    let length = Math.min(maxLength, supply.length, returnInward.length);

    while (
        length > 2 &&
        (!laneTailFitsBendRadius(supply, length, bendRadius) ||
            !laneTailFitsBendRadius(returnInward, length, bendRadius))
    ) {
        length--;
    }

    return length;
}

/** The first `length` points of a lane, deep enough that the copy can be reshaped freely. */
function copyLane(lane: Point[], length: number): Point[] {
    return lane.slice(0, length).map(point => ({ x: point.x, y: point.y }));
}

/** Distance from a point to the nearest place on a segment. */
function pointToSegmentDistance(point: Point, from: Point, to: Point): number {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared < EPSILON) return Math.hypot(point.x - from.x, point.y - from.y);

    const t = Math.max(
        0,
        Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared),
    );

    return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
}

/**
 * How many of a lane's segments are further back than `tailMm` of pipe from its end.
 *
 * Clearance is a rule about how close two different passes may run, not about how close a
 * run comes to the pipe it is itself a continuation of - and the only way to tell those
 * apart is by how far apart they are along the pipe. Anything within a stride of the end is
 * the same run still going; a genuinely different pass is a whole ring away.
 */
function laneSegmentsBeyondTail(lane: Point[], tailMm: number): number {
    let fromEnd = 0;

    for (let i = lane.length - 2; i >= 0; i--) {
        if (fromEnd >= tailMm) return i + 1;
        fromEnd += Math.hypot(lane[i + 1].x - lane[i].x, lane[i + 1].y - lane[i].y);
    }

    return 0;
}

/**
 * How close a run of pipe comes to the first `segmentCount` segments of a lane. Callers
 * leave out the segments the run is a continuation of, which it is touching by definition.
 */
function clearanceToLane(
    from: Point,
    to: Point,
    lane: Point[],
    segmentCount: number,
): number {
    let closest = Infinity;

    for (let i = 0; i < segmentCount && i + 1 < lane.length; i++) {
        closest = Math.min(
            closest,
            pointToSegmentDistance(from, lane[i], lane[i + 1]),
            pointToSegmentDistance(to, lane[i], lane[i + 1]),
            pointToSegmentDistance(lane[i], from, to),
            pointToSegmentDistance(lane[i + 1], from, to),
        );
    }

    return closest;
}

/**
 * How far past its own lanes a center turn is entitled to stray, millimetres.
 *
 * A half circle drawn between lanes exactly two radii apart touches each of them and stays
 * between the two, so it is entitled to nothing. Only where the gap couldn't be opened out
 * that far does the turn have to swing wide to hold its radius, and this is exactly how
 * wide - a quarter of whatever the gap is still short by.
 */
function centerTurnStrayAllowanceMm(gapMm: number, bendRadius: number): number {
    return Math.max(0, (2 * bendRadius - gapMm) / 4);
}

/**
 * Whether the center turn keeps its distance from pipe that is already down.
 *
 * The turn has to hold the same spacing off its neighbours that every other pass does - it
 * reaches a full radius beyond where the lanes stop, and a pass sitting one spacing ahead
 * of them is only that one radius away from being touched.
 *
 * The straight each lane ends on is exempt: the turn leaves it tangentially, so it is
 * touching that one by definition.
 */
function turnClearanceToLane(turn: Point[], lane: Point[], bendRadius: number): number {
    // The turn is only about two radii across, so pipe within that of the lane's end is the
    // limb it springs from, corner and all - not a pass it has to keep away from.
    const segmentCount = laneSegmentsBeyondTail(lane, 2 * bendRadius);
    let closest = Infinity;

    for (let i = 0; i + 1 < turn.length; i++) {
        closest = Math.min(
            closest,
            clearanceToLane(turn[i], turn[i + 1], lane, segmentCount),
        );
    }

    return closest;
}

/**
 * Back both lanes off by `distanceMm` along the straights they end on, taking the turn with
 * them.
 *
 * A turn reaches a radius beyond where its lanes stop, so a pass crossing ahead of them
 * needs a radius and a spacing of room - and a spiral, by its nature, has laid one exactly
 * one spacing ahead. The answer is to stop the two lanes a little shorter, not to give up
 * the rings that got them there: the turn moves back with them and the pass gets its room.
 *
 * Both move by the same amount, so their ends stay level with each other and the turn stays
 * the half circle it was. Returns false when the straights have not got it to give - below
 * a radius they can no longer carry the corner they start on.
 */
function pullBackLaneEnds(
    lanes: Point[][],
    distanceMm: number,
    bendRadius: number,
): boolean {
    const pulls = lanes.map(lane => {
        const end = lane[lane.length - 1];
        const previous = lane[lane.length - 2];
        const run = Math.hypot(end.x - previous.x, end.y - previous.y);

        return { end, previous, run };
    });

    if (pulls.some(pull => pull.run - distanceMm < bendRadius - EPSILON)) return false;

    for (const { end, previous, run } of pulls) {
        end.x += ((previous.x - end.x) / run) * distanceMm;
        end.y += ((previous.y - end.y) / run) * distanceMm;
    }

    return true;
}

/**
 * Whether a point lies within the zone, judged the same way the rings are clamped: by the
 * span the polygon actually covers on that scanline. A point exactly on the outline counts
 * as inside, so a run laid hard against a wall isn't read as having left the room.
 */
function isPointInsidePolygon(polygon: Polygon, point: Point): boolean {
    return polygonRowIntervals(polygon, point.y).some(
        ([min, max]) => point.x >= min - EPSILON && point.x <= max + EPSILON,
    );
}

/**
 * Make the two center endpoints line up so that they can be joined by a
 * semicircle. The final supply and return segments must be parallel.
 */
function alignCenterEndpoints(
    supply: Point[],
    returnInward: Point[],
): void {
    if (supply.length < 2 || returnInward.length < 2) return;

    const supplyPrevious = supply[supply.length - 2];
    const supplyEnd = supply[supply.length - 1];

    const returnPrevious = returnInward[returnInward.length - 2];
    const returnEnd = returnInward[returnInward.length - 1];

    const supplyIsHorizontal =
        Math.abs(supplyEnd.y - supplyPrevious.y) < EPSILON;

    if (supplyIsHorizontal) {
        // Preserve the return lane's Y coordinate and align its X position.
        returnEnd.x = supplyEnd.x;

        if (Math.abs(returnEnd.x - returnPrevious.x) < EPSILON) {
            returnInward.pop();
        }
    } else {
        // Preserve the return lane's X coordinate and align its Y position.
        returnEnd.y = supplyEnd.y;

        if (Math.abs(returnEnd.y - returnPrevious.y) < EPSILON) {
            returnInward.pop();
        }
    }
}

/**
 * Open the last two passes out to twice the bend radius, so the turn joining them can be
 * the plain half circle it looks like it should be.
 *
 * Consecutive passes sit one spacing apart, and no half turn formed at `bendRadius` fits
 * between passes closer together than twice it - under 200 mm spacing the turn would have
 * to swing wide of both lanes to hold its radius. The room to avoid that is already there:
 * the inner lane's last straight has nothing but the middle of the zone beyond it, so it
 * can simply sit further in. Nothing else moves, and because the straight feeding it runs
 * that way anyway, that straight just gets longer - every corner stays square.
 *
 * The cost is a slightly wider gap between the last two passes; the return is a turn a
 * fitter can actually form, and one that reaches only its own radius past the lanes
 * instead of twice that, which is room the spiral gets to spend on another ring.
 */
function widenCenterGapToBendRadius(
    supply: Point[],
    returnInward: Point[],
    spacing: number,
    bendRadius: number,
    polygon?: Polygon,
): void {
    if (supply.length < 2 || returnInward.length < 3) return;

    const supplyEnd = supply[supply.length - 1];
    const returnEnd = returnInward[returnInward.length - 1];
    const returnCorner = returnInward[returnInward.length - 2];
    const returnFeed = returnInward[returnInward.length - 3];

    const gapX = returnEnd.x - supplyEnd.x;
    const gapY = returnEnd.y - supplyEnd.y;
    const gap = Math.hypot(gapX, gapY);
    const shortfall = 2 * bendRadius - gap;

    if (gap < EPSILON || shortfall <= EPSILON) return;

    const acrossGap = { x: gapX / gap, y: gapY / gap };

    // The lane's last straight has to stay square to the gap, or moving it along the gap
    // would change its length and throw the two lanes out of parallel.
    const lastRun = {
        x: returnEnd.x - returnCorner.x,
        y: returnEnd.y - returnCorner.y,
    };

    if (Math.abs(lastRun.x * acrossGap.x + lastRun.y * acrossGap.y) > EPSILON) return;

    /*
     * The straight feeding it absorbs the move. It grows when it already runs deeper into
     * the zone and shrinks when it doesn't - and it still has a corner at each end to carry
     * afterwards, so a move that would leave it short is not worth making.
     */
    const feedRun = {
        x: returnCorner.x - returnFeed.x,
        y: returnCorner.y - returnFeed.y,
    };

    const feedAlongGap = feedRun.x * acrossGap.x + feedRun.y * acrossGap.y;

    if (Math.abs(feedAlongGap + shortfall) < 2 * bendRadius - EPSILON) return;

    const moved = [returnCorner, returnEnd].map(point => ({
        x: point.x + acrossGap.x * shortfall,
        y: point.y + acrossGap.y * shortfall,
    }));

    // Deeper into the zone is only empty if the zone is still there to be deeper into.
    if (polygon && moved.some(point => !isPointInsidePolygon(polygon, point))) return;

    /*
     * And only if the middle really is empty. Where the winding stopped early the far side
     * of the hole can be closer than the move is long, and the straight would be laid down
     * on top of a pass that is already there. It must stay a spacing off everything, just
     * as it did before it moved - bar its own neighbours, and the lane opposite, which it
     * is now two radii from by construction.
     */
    if (
        clearanceToLane(moved[0], moved[1], supply, supply.length - 1) < spacing - EPSILON ||
        clearanceToLane(moved[0], moved[1], returnInward, returnInward.length - 3) <
            spacing - EPSILON
    ) {
        return;
    }

    returnCorner.x = moved[0].x;
    returnCorner.y = moved[0].y;
    returnEnd.x = moved[1].x;
    returnEnd.y = moved[1].y;
}

/**
 * How many times the lanes may be backed off to give the center turn its clearance before
 * the ring itself is given up instead. Each go corrects the whole shortfall, so this only
 * covers the pass the turn is measured against changing as the lanes shorten.
 */
const CENTER_PULL_BACK_ATTEMPTS = 3;

/** Angular resolution the center turn's arcs are drawn at. */
const CENTER_TURN_STEP_RADIANS = Math.PI / 12;

function arcStepCount(sweep: number): number {
    return Math.max(2, Math.ceil(Math.abs(sweep) / CENTER_TURN_STEP_RADIANS));
}

/**
 * How far the initial swing of a looping center turn goes the "wrong" way, radians.
 *
 * A turn made of a single arc joins two lanes exactly 2 × radius apart. To finish on a lane
 * that is closer than that, the pipe first swings out by this angle away from the far lane,
 * then comes back through 90 + this angle — the extra swing is what buys back the distance.
 * Solving the closing condition for the pair gives cos(swing) = (2r + gap) / 4r, which is 0
 * at the widest gap the loop is ever used for and grows as the lanes close up.
 */
function loopTurnSwing(gapMm: number, radiusMm: number): number {
    const cosSwing = (2 * radiusMm + gapMm) / (4 * radiusMm);
    return Math.acos(Math.max(-1, Math.min(1, cosSwing)));
}

/**
 * The center turn for lanes that couldn't be opened out to 2 × radius: the pipe swings wide
 * of its own lane, comes back round through more than a half turn, and drops into the
 * return lane — every part of it formed at `radius`, where a semicircle across the same gap
 * would have to be formed at half the gap.
 *
 * `widenCenterGapToBendRadius` spares the spiral this in all but the tightest middles, and
 * it is much the better turn when it can: one continuous sweep rather than a swing out and
 * back, and it reaches only its own radius past the lanes instead of twice that.
 *
 * Built in the turn's own frame (`u` along the pipe's travel, `v` across to the return
 * lane) and mapped back at the end, so it needs no case analysis per orientation. The
 * second half is the first mirrored about the gap's midline, which is what makes the two
 * halves meet tangentially at the far extremity.
 */
function generateCenterLoopTurn(
    supplyEnd: Point,
    forward: Point,
    returnEnd: Point,
    gap: number,
    radius: number,
): Point[] {
    const across = {
        x: (returnEnd.x - supplyEnd.x) / gap,
        y: (returnEnd.y - supplyEnd.y) / gap,
    };

    // Square the travel direction up against the gap, so the loop starts exactly tangent to
    // the lane even if the incoming segment is a hair off perpendicular.
    const alongDot = forward.x * across.x + forward.y * across.y;
    const alongRaw = {
        x: forward.x - across.x * alongDot,
        y: forward.y - across.y * alongDot,
    };
    const alongLength = Math.hypot(alongRaw.x, alongRaw.y);

    // The lane runs straight at the return lane rather than alongside it: no loop to build.
    if (alongLength < EPSILON) return [];

    const along = {
        x: alongRaw.x / alongLength,
        y: alongRaw.y / alongLength,
    };

    const swing = loopTurnSwing(gap, radius);

    // Swing away from the return lane, hinged on the near side of the lane.
    const outward = arcPts(
        0,
        -radius,
        radius,
        Math.PI / 2,
        Math.PI / 2 - swing,
        arcStepCount(swing),
    );

    // Then back the other way, through 90 + swing, to reach the extremity of the loop
    // travelling straight across the gap.
    const around = arcPts(
        2 * radius * Math.sin(swing),
        radius * (2 * Math.cos(swing) - 1),
        radius,
        (3 * Math.PI) / 2 - swing,
        2 * Math.PI,
        arcStepCount(Math.PI / 2 + swing),
    );

    const half = [...outward, ...around.slice(1)];

    // Mirroring the half about the gap's midline turns it into the run back down into the
    // return lane; the extremity itself sits on that line and is already in `half`.
    const full = [
        ...half,
        ...half
            .slice(0, -1)
            .reverse()
            .map(point => ({ x: point.x, y: gap - point.y })),
    ];

    return full.map(point => ({
        x: supplyEnd.x + along.x * point.x + across.x * point.y,
        y: supplyEnd.y + along.y * point.x + across.y * point.y,
    }));
}

/**
 * Generate the 180-degree center turn.
 *
 * The bulge is chosen in the direction in which the supply lane enters the
 * center, so the pipe turns naturally onto the reversed return spiral.
 *
 * The two lane ends are one pipe spacing apart, so the semicircle joining them has a radius
 * of half that spacing — under 2 × PIPE_BEND_RADIUS_MM of spacing that is tighter than the
 * pipe bends, and the turn is made as a wider loop instead.
 */
function generateCenterTurn(
    supplyPrevious: Point,
    supplyEnd: Point,
    returnEnd: Point,
    minRadius = 0,
    steps = 8,
): Point[] {
    const dx = returnEnd.x - supplyEnd.x;
    const dy = returnEnd.y - supplyEnd.y;
    const distance = Math.hypot(dx, dy);

    if (distance < EPSILON) return [supplyEnd];

    const center = {
        x: (supplyEnd.x + returnEnd.x) / 2,
        y: (supplyEnd.y + returnEnd.y) / 2,
    };

    const radius = distance / 2;

    const tangent = {
        x: supplyEnd.x - supplyPrevious.x,
        y: supplyEnd.y - supplyPrevious.y,
    };

    const tangentLength = Math.hypot(tangent.x, tangent.y);

    if (tangentLength < EPSILON) {
        return [supplyEnd, returnEnd];
    }

    tangent.x /= tangentLength;
    tangent.y /= tangentLength;

    if (minRadius > radius + EPSILON) {
        const loop = generateCenterLoopTurn(
            supplyEnd,
            tangent,
            returnEnd,
            distance,
            minRadius,
        );

        if (loop.length > 0) return loop;
    }

    const startAngle = Math.atan2(
        supplyEnd.y - center.y,
        supplyEnd.x - center.x,
    );

    const positiveMidAngle = startAngle + Math.PI / 2;
    const negativeMidAngle = startAngle - Math.PI / 2;

    const positiveBulge = {
        x: Math.cos(positiveMidAngle),
        y: Math.sin(positiveMidAngle),
    };

    const negativeBulge = {
        x: Math.cos(negativeMidAngle),
        y: Math.sin(negativeMidAngle),
    };

    const positiveScore =
        positiveBulge.x * tangent.x +
        positiveBulge.y * tangent.y;

    const negativeScore =
        negativeBulge.x * tangent.x +
        negativeBulge.y * tangent.y;

    const endAngle =
        positiveScore >= negativeScore
            ? startAngle + Math.PI
            : startAngle - Math.PI;

    return arcPts(
        center.x,
        center.y,
        radius,
        startAngle,
        endAngle,
        steps,
    );
}

/**
 * Generate a proper counter-flow rectangular spiral in canonical coordinates.
 *
 * The supply spiral has an offset of 0. The return spiral is shifted inward by
 * one pipe spacing. Both spirals use a pitch of 2 * spacing, so the return
 * lane sits halfway between consecutive supply lanes.
 *
 * `polygon`, when supplied, is also in canonical space and is used to
 * conform every ring of both spirals to the actual zone shape.
 */
function generateCanonicalSpiral(
    width: number,
    height: number,
    spacing: number,
    polygon?: Polygon,
): PipePath {
    const bendRadius = spiralBendRadiusMm(spacing);

    const boundaryFollowing = polygon
        ? computeBoundaryFollowingSpiral(polygon, spacing, height)
        : null;

    let supply: Point[];
    let returnInward: Point[];

    if (boundaryFollowing) {
        supply = boundaryFollowing.supply;
        returnInward = boundaryFollowing.returnInward;
    } else {
        /*
         * Fall back to a bounding-box rectangle spiral, still conformed to
         * the polygon edge-by-edge via scanline clamping. This covers
         * non-rectilinear polygons (diagonal walls) and any zone too small
         * or irregular for even the outermost eroded ring to fit.
         */
        const spiralFrames = computeSpiralFrames(width, height, spacing, polygon);

        if (!spiralFrames || spiralFrames.frames.length === 0) {
            return [];
        }

        supply = framesToPath(
            spiralFrames.left,
            spiralFrames.top,
            height,
            spiralFrames.frames,
            0,
        );

        returnInward = framesToPath(
            spiralFrames.left,
            spiralFrames.top,
            height,
            spiralFrames.frames,
            spacing,
        );
    }

    if (supply.length < 2 || returnInward.length < 2) {
        return [];
    }

    /*
     * Keep corresponding portions of both spirals. Depending on the rectangle's
     * proportions, one offset spiral can otherwise contain one extra center
     * segment. Pulling both back to the same length is also what keeps them
     * corresponding ring for ring, which the center turn relies on.
     */
    let length = laneLengthWithinBendRadius(
        supply,
        returnInward,
        bendRadius,
        Math.min(supply.length, returnInward.length),
    );

    /*
     * The center turn needs clear floor ahead of where the lanes stop, and how much is
     * only known once they have stopped. Give up a ring at a time until it fits: what a
     * lane gives up is exactly the floor the turn was short of.
     *
     * A turn that only overshoots the zone's outline is kept in reserve rather than
     * refused. Rings run out long before the search does in a zone this tight, and a
     * spiral whose middle nudges past the wall is worth more to whoever has to lay it than
     * no spiral at all. Pipe laid across pipe is not, so that one is never kept.
     */
    let overshooting: PipePath | null = null;

    while (length >= 4) {
        const joined = joinLanesAtCenter(
            copyLane(supply, length),
            copyLane(returnInward, length),
            spacing,
            bendRadius,
            polygon,
        );

        if (joined?.insideZone) return joined.path;
        if (joined && !overshooting) overshooting = joined.path;

        length = laneLengthWithinBendRadius(
            supply,
            returnInward,
            bendRadius,
            length - 1,
        );
    }

    return overshooting ?? [];
}

/**
 * Close the two lanes off against each other at the middle of the spiral: a last pair of
 * center legs where there is room for them, the turn that joins the lanes, and the whole
 * thing assembled into the single path the pipe actually follows.
 *
 * `insideZone` reports whether the center turn stayed within the zone's outline - the
 * caller's cue to stop the lanes further out and try again. Returns null outright when the
 * turn would be laid across pipe that is already down, which no amount of keeping is worth.
 * The lanes are consumed (mutated) either way.
 */
function joinLanesAtCenter(
    supply: Point[],
    returnInward: Point[],
    spacing: number,
    bendRadius: number,
    polygon?: Polygon,
): { path: PipePath; insideZone: boolean } | null {
    const addedCenterLeg = addFinalCenterLeg(
        supply,
        returnInward,
        spacing,
        bendRadius,
        polygon,
    );
    /*
     * Fallback for unusually small or narrow zones where there is not enough
     * geometry for another complete center leg.
     */
    if (!addedCenterLeg) {
        /*
         * Trim the longer spiral until both innermost endpoints lie on compatible
         * parallel segments. This is less dense than the extra center leg, but it
         * cannot cut across an existing ring.
         */
        while (supply.length > 2 && returnInward.length > 2) {
            const supplyEnd = supply[supply.length - 1];
            const returnEnd =
                returnInward[returnInward.length - 1];

            const supplyPrevious =
                supply[supply.length - 2];

            const returnPrevious =
                returnInward[returnInward.length - 2];

            const supplyVertical =
                Math.abs(supplyEnd.x - supplyPrevious.x) < EPSILON;

            const returnVertical =
                Math.abs(returnEnd.x - returnPrevious.x) < EPSILON;

            if (supplyVertical === returnVertical) {
                break;
            }

            if (supply.length > returnInward.length) {
                supply.pop();
            } else {
                returnInward.pop();
            }
        }

        alignCenterEndpoints(supply, returnInward);
    }
    if (supply.length < 2 || returnInward.length < 2) {
        return null;
    }

    widenCenterGapToBendRadius(supply, returnInward, spacing, bendRadius, polygon);

    /*
     * The turn is the one part of the spiral not laid out against the zone's outline. It
     * reaches a radius beyond where the lanes stop, and a spiral has by its nature laid a
     * pass one spacing ahead of them - so on its own it would be left a radius short of
     * clear. Backing the two lanes off by the shortfall moves the turn back with them; a
     * couple of goes settles it, because shortening the lanes moves what the turn is
     * measured against too.
     */
    let roundedSupply: Point[] = [];
    let roundedReturnInward: Point[] = [];
    let centerTurn: Point[] = [];

    for (let attempt = 0; ; attempt++) {
        roundedSupply = roundPathCorners(supply, bendRadius);
        roundedReturnInward = roundPathCorners(returnInward, bendRadius);

        const supplyEnd = roundedSupply[roundedSupply.length - 1];
        const supplyPrevious = roundedSupply[roundedSupply.length - 2];
        const returnEnd = roundedReturnInward[roundedReturnInward.length - 1];

        centerTurn = generateCenterTurn(
            supplyPrevious,
            supplyEnd,
            returnEnd,
            bendRadius,
        );

        /*
         * A turn that had to swing wide to hold its radius gives up exactly that much of
         * its clearance - it is out beyond its own lane, so it is that much nearer whatever
         * is on the far side. A turn that didn't owes the full spacing like any other pass.
         */
        const minimumClearance =
            spacing -
            centerTurnStrayAllowanceMm(
                Math.hypot(returnEnd.x - supplyEnd.x, returnEnd.y - supplyEnd.y),
                bendRadius,
            );

        const shortfall =
            minimumClearance -
            Math.min(
                turnClearanceToLane(centerTurn, roundedSupply, bendRadius),
                turnClearanceToLane(centerTurn, roundedReturnInward, bendRadius),
            );

        if (shortfall <= EPSILON) break;

        // Out of goes, or the lanes have no more to give: the caller drops a ring instead.
        if (
            attempt >= CENTER_PULL_BACK_ATTEMPTS ||
            !pullBackLaneEnds([supply, returnInward], shortfall, bendRadius)
        ) {
            return null;
        }
    }

    const insideZone =
        !polygon || centerTurn.every(point => isPointInsidePolygon(polygon, point));

    const path: Point[] = [...roundedSupply];

    // Skip the center turn's first point because it equals the supply endpoint.
    for (let i = 1; i < centerTurn.length; i++) {
        pushUnique(path, centerTurn[i]);
    }

    /*
     * The second spiral was generated from the manifold inward. Reverse it to
     * obtain the center-to-manifold return path.
     */
    for (let i = roundedReturnInward.length - 2; i >= 0; i--) {
        pushUnique(path, roundedReturnInward[i]);
    }

    return { path, insideZone };
}

/**
 * Convert the canonical bottom-manifold spiral into the selected orientation.
 */
function transformFromCanonical(
    point: Point,
    side: ManifoldSide,
    xMin: number,
    xMax: number,
    yMin: number,
    yMax: number,
): Point {
    switch (side) {
        case 'bottom':
            return {
                x: xMin + point.x,
                y: yMin + point.y,
            };

        case 'top':
            return {
                x: xMax - point.x,
                y: yMax - point.y,
            };

        case 'left':
            return {
                x: xMax - point.y,
                y: yMin + point.x,
            };

        case 'right':
            return {
                x: xMin + point.y,
                y: yMax - point.x,
            };
    }
}

/**
 * Inverse of transformFromCanonical: convert a world-space point (e.g. a
 * polygon vertex) into the canonical bottom-manifold coordinate space used
 * internally by the spiral generator.
 */
function toCanonicalSpace(
    point: Point,
    side: ManifoldSide,
    xMin: number,
    xMax: number,
    yMin: number,
    yMax: number,
): Point {
    switch (side) {
        case 'bottom':
            return {
                x: point.x - xMin,
                y: point.y - yMin,
            };

        case 'top':
            return {
                x: xMax - point.x,
                y: yMax - point.y,
            };

        case 'left':
            return {
                x: point.y - yMin,
                y: xMax - point.x,
            };

        case 'right':
            return {
                x: yMax - point.y,
                y: point.x - xMin,
            };
    }
}

function getClosestManifoldSide(
    hint: Point,
    xMin: number,
    xMax: number,
    yMin: number,
    yMax: number,
): ManifoldSide {
    const outLeft = Math.max(0, xMin - hint.x);
    const outRight = Math.max(0, hint.x - xMax);
    const outTop = Math.max(0, yMin - hint.y);
    const outBottom = Math.max(0, hint.y - yMax);

    const maxOutside = Math.max(
        outLeft,
        outRight,
        outTop,
        outBottom,
    );

    if (maxOutside > 0) {
        if (maxOutside === outBottom) return 'bottom';
        if (maxOutside === outTop) return 'top';
        if (maxOutside === outLeft) return 'left';
        return 'right';
    }

    const distances: Record<ManifoldSide, number> = {
        left: hint.x - xMin,
        right: xMax - hint.x,
        top: hint.y - yMin,
        bottom: yMax - hint.y,
    };

    let closest: ManifoldSide = 'bottom';

    for (const side of [
        'top',
        'right',
        'bottom',
        'left',
    ] as const) {
        if (distances[side] < distances[closest]) {
            closest = side;
        }
    }

    return closest;
}

/**
 * Generate a counter-flow underfloor-heating spiral.
 *
 * The path:
 * - starts at the manifold-facing edge;
 * - winds inward with a pitch of 2 * spacing;
 * - makes a 180-degree turn near the center;
 * - winds outward through the intermediate lanes;
 * - ends beside the starting connection.
 *
 * Rectilinear zones use the established orthogonal counter-flow generator.
 * Freeform zones use inset contours of their actual outline, including diagonal
 * edges. The contour route stops before an inset collapses or crosses itself;
 * a single route cannot fill disconnected pockets after a concave zone splits.
 *
 * When `mirror` is set, the spiral is reflected along the manifold edge. The
 * two open ends stay on the same edge but move to the opposite end of it, which
 * flips the winding direction (i.e. whether the first leg runs toward one wall
 * or the other) without changing the connection edge.
 */
export function generateSerpentine(
    polygon: Polygon,
    spacingMm: number,
    connectionHint?: Point,
    paddingMm = 0,
    mirror = false,
): PipePath {
    if (
        polygon.points.length < 3 ||
        !Number.isFinite(spacingMm) ||
        spacingMm <= 0 ||
        !Number.isFinite(paddingMm) ||
        paddingMm < 0
    ) {
        return [];
    }

    const snapTolerance = POLYGON_SNAP_TOLERANCE_MM;

    const snappedPoints = snapManuallyDrawnRectilinearPolygon(
        polygon.points,
        snapTolerance,
    );
    const rectilinearPoints = snappedPoints
        ? cleanRectilinearPolygon(snappedPoints)
        : null;

    // Preserve true diagonal edges for the contour generator. Only small drawing
    // errors near horizontal or vertical edges are snapped to rectilinear.
    const cleanedPoints = rectilinearPoints ?? polygon.points.filter((point, index, points) => {
        const previous = points[(index - 1 + points.length) % points.length];
        return !samePoint(point, previous);
    });

    if (cleanedPoints.length < 3 || Math.abs(signedArea(cleanedPoints)) < EPSILON) {
        return [];
    }
    
    const originalXs = cleanedPoints.map(
        point => point.x,
    );
    const originalYs = cleanedPoints.map(
        point => point.y,
    );

    const originalXMin = Math.min(...originalXs);
    const originalXMax = Math.max(...originalXs);
    const originalYMin = Math.min(...originalYs);
    const originalYMax = Math.max(...originalYs);

    const hint = connectionHint ?? {
        x: (originalXMin + originalXMax) / 2,
        y: originalYMax + 1e9,
    };

    const side = getClosestManifoldSide(
        hint,
        originalXMin,
        originalXMax,
        originalYMin,
        originalYMax,
    );

    /*
     * Apply padding to the real polygon, including concave edges.
     * Do not use the non-null assertion here: narrow arms can legitimately
     * collapse when padding is too large.
     */
    let paddedPoints: Point[] | null = cleanedPoints;
    if (paddingMm > EPSILON) {
        if (rectilinearPoints) {
            paddedPoints = offsetRectilinearPolygon(rectilinearPoints, paddingMm);
        } else {
            const contours = insetPolygonContours({ points: cleanedPoints }, paddingMm);
            paddedPoints = contours.length === 1 ? contours[0] : null;
        }
    }

    if (!paddedPoints || paddedPoints.length < 3) {
        return [];
    }

    const paddedPolygon: Polygon = {
        points: paddedPoints,
    };

    const xs = paddedPoints.map(point => point.x);
    const ys = paddedPoints.map(point => point.y);

    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);

    const zoneWidth = xMax - xMin;
    const zoneHeight = yMax - yMin;

    if (
        zoneWidth < spacingMm * 3 ||
        zoneHeight < spacingMm * 3
    ) {
        return [];
    }

    const canonicalWidth =
        side === 'left' || side === 'right'
            ? zoneHeight
            : zoneWidth;

    const canonicalHeight =
        side === 'left' || side === 'right'
            ? zoneWidth
            : zoneHeight;

    /*
     * The polygon is already padded, so use its own bounds here. Applying
     * padded bounds again would double-count the padding.
     */
    const canonicalPolygon: Polygon = {
        points: paddedPolygon.points.map(point => {
            const local = toCanonicalSpace(
                point,
                side,
                xMin,
                xMax,
                yMin,
                yMax,
            );

            return mirror
                ? {
                    x: canonicalWidth - local.x,
                    y: local.y,
                }
                : local;
        }),
    };

    const canonicalPath = rectilinearPoints
        ? generateCanonicalSpiral(
            canonicalWidth,
            canonicalHeight,
            spacingMm,
            canonicalPolygon,
        )
        : generatePolygonContourSerpentine(canonicalPolygon, spacingMm);

    return canonicalPath.map(point => {
        const canonicalPoint = mirror
            ? {
                x: canonicalWidth - point.x,
                y: point.y,
            }
            : point;

        return transformFromCanonical(
            canonicalPoint,
            side,
            xMin,
            xMax,
            yMin,
            yMax,
        );
    });
}

/**
 * Preferred name for the new generator.
 */
export const generateSpiral = generateSerpentine;

/**
 * Find the two manifold connection points.
 */
export function getSpiralStubs(
    path: PipePath,
): { start: Point; end: Point } | null {
    if (path.length < 2) return null;

    return {
        start: path[0],
        end: path[path.length - 1],
    };
}
