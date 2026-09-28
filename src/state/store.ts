import { create, type StateCreator } from 'zustand';
import { createJSONStorage, persist, type PersistOptions } from 'zustand/middleware';
import {
  Background,
  CalibrationState,
  LeaderRoutingState,
  Manifold,
  MeasurementState,
  Point,
  SpiralStartDirection,
  ToolMode,
  Zone,
  ZoneConnectionCorner,
} from '../types';
import { generateSerpentine, getSpiralStubs } from '../geometry/spiral';
import { distanceMm, pathLengthMm } from '../geometry/length';
import { polygonArea } from '../geometry/offset';
import {
  clampManifoldOffset,
  getManifoldLayout,
  getZoneManifoldPorts,
  projectPointOntoManifold,
} from '../geometry/manifoldRouting';
import { isAxisAlignedRect, resizeRectFromCorner } from '../geometry/rect';
import { DEFAULT_PIPE_OUTER_DIAMETER_MM } from '../geometry/heat';
import { dxfBoundingBox } from '../geometry/dxfHelpers';
import { ZONE_COLORS } from '../theme';
import {
  assembleLeaderPath,
  getIncomingLegDirection,
  getStubExitDirection,
  isPointOnManifold,
  midpoint,
  reflowLeaderWaypoints,
  snapElbowPoint,
  snapFirstLegPoint,
} from '../geometry/manualRouting';

const MANIFOLD_CLICK_MARGIN_MM = 100;
const MIN_LEADER_SEGMENT_MM = 150;
/** Below this, a zone resize is treated as not having moved the connection point — existing leader routing is kept. */
const ZONE_RESIZE_ROUTING_TOLERANCE_MM = 200;

const DEFAULT_ZONE_PADDING_MM = 100;
const DEFAULT_ZONE_CONNECTION_CORNER: ZoneConnectionCorner = 'bottom-left';

/**
 * Historically each connection corner was hard-wired to a single manifold edge:
 * bottom-left/top-right left the manifold vertically, bottom-right/top-left left
 * horizontally. Keeping those as the defaults means existing designs look
 * unchanged until the user explicitly picks a start direction.
 */
function getDefaultStartDirection(corner: ZoneConnectionCorner): SpiralStartDirection {
  return corner === 'bottom-left' || corner === 'top-right' ? 'vertical' : 'horizontal';
}

const DEFAULT_ZONE_START_DIRECTION: SpiralStartDirection = getDefaultStartDirection(
  DEFAULT_ZONE_CONNECTION_CORNER,
);

/**
 * Screen pixels per millimetre at the default view. A 10 m wall is 10 000 mm, so at 0.1
 * it spans 1000 px — a whole house fits a laptop screen. This is the Konva stage scale,
 * i.e. the single place the drawing's millimetres become pixels.
 */
export const DEFAULT_PX_PER_MM = 0.1;

interface StoreState {
  /** Screen pixels per millimetre: zoom and unit conversion in one number. */
  pxPerMm: number;
  maxCircuitLengthM: number;
  defaultSpacingMm: number;
  /** Flow-water supply temperature at the manifold, °C. */
  supplyTempC: number;
  /** Flow-water return temperature at the manifold, °C. */
  returnTempC: number;
  /** Loop flow rate, in L/min per 100m of pipe — scales each zone's flow by its own circuit length. */
  flowLpmPer100m: number;
  /** Outside diameter of the loop tube, mm. The wall is taken as 2 mm, as on the common sizes. */
  pipeOuterDiameterMm: number;
  /** Discriminated-union background layer (DXF or raster image, or null) */
  background: Background | null;
  zones: Zone[];
  selectedZoneId: string | null;
  manifold: Manifold | null;
  toolMode: ToolMode;
  drawingPoints: Point[];
  /** First corner for rectangle-zone drawing */
  drawRectStart: Point | null;
  /** In-progress manual leader-routing session, if any */
  routing: LeaderRoutingState | null;
  calibration: CalibrationState;
  /** The tape measure's two ends, in mm; both null when nothing is being measured. */
  measurement: MeasurementState;
  /** Stage translation, in screen pixels. */
  stageX: number;
  stageY: number;

  setBackground: (bg: Background | null) => void;
  /**
   * Shift the floor plan by a world-space delta, leaving zones and the manifold where
   * they are — for lining an imported plan up with work already drawn against it.
   */
  moveBackground: (deltaX: number, deltaY: number) => void;
  setToolMode: (mode: ToolMode) => void;
  setManifold: (pos: Point) => void;
  updateManifoldPosition: (pos: Point) => void;
  setManifoldRotation: (rotationDeg: number) => void;
  addDrawingPoint: (pt: Point) => void;
  closeZone: () => void;
  cancelDrawing: () => void;
  /** Start a rectangle zone: record the first corner */
  startDrawRect: (pt: Point) => void;
  /** Finish a rectangle zone: record the opposite corner and create the zone */
  finishDrawRect: (pt: Point) => void;
  cancelDrawRect: () => void;
  deleteZone: (id: string) => void;
  selectZone: (id: string | null) => void;
  updateZoneSpacing: (id: string, spacingMm: number) => void;
  updateZonePadding: (id: string, paddingMm: number) => void;
  updateZoneConnectionCorner: (id: string, corner: ZoneConnectionCorner) => void;
  updateZoneStartDirection: (id: string, direction: SpiralStartDirection) => void;
  updateZoneName: (id: string, name: string) => void;
  updateZoneVertex: (zoneId: string, vertexIdx: number, pt: Point) => void;
  /** Begin (or restart) manual leader routing for a zone. */
  startRouteZone: (zoneId: string) => void;
  /** Add a click to the in-progress leader path; finishes routing automatically if the click lands on the manifold. */
  addRoutePoint: (pt: Point) => void;
  /** Commit the drawn leader path, connecting it into the manifold point the user clicked. */
  finishRouting: (clickPos: Point) => void;
  /** Abandon the in-progress route without saving it. */
  cancelRouting: () => void;
  /** Drag a single waypoint of an already-drawn leader path; adjacent bends are repaired to stay orthogonal. */
  updateLeaderWaypoint: (zoneId: string, waypointIndex: number, pt: Point, reflow: boolean) => void;
  /** Slide a purely horizontal/vertical leader segment by moving its two endpoint waypoints together along the perpendicular axis. */
  updateLeaderSegment: (
    zoneId: string,
    waypointIndexA: number,
    waypointIndexB: number,
    axis: 'x' | 'y',
    value: number,
    reflow: boolean,
  ) => void;
  /**
   * Slide the leader's final segment (the one connecting into the manifold) by moving its
   * last waypoint and the manifold connection point together, repairing the trailing
   * connector to stay orthogonal.
   */
  updateLeaderManifoldSegment: (
    zoneId: string,
    waypointIndex: number,
    axis: 'x' | 'y',
    value: number,
    reflow: boolean,
  ) => void;
  /**
   * Slide a zone's manifold connection along the manifold's edge by dragging its port
   * dot to `pt`; the dot isn't confined to the edge itself, the point is projected onto
   * it. The drawn waypoints stay put — only the derived approach re-aims.
   */
  slideZoneManifoldPort: (zoneId: string, pt: Point) => void;
  /** Resize the plan and traced geometry about the measured calibration point. */
  rescaleBackground: (factor: number, anchor: Point) => void;
  setMaxCircuitLength: (m: number) => void;
  setDefaultSpacing: (mm: number) => void;
  setSupplyTempC: (celsius: number) => void;
  setReturnTempC: (celsius: number) => void;
  setFlowLpmPer100m: (lpm: number) => void;
  setPipeOuterDiameter: (mm: number) => void;
  /**
   * Place a tape-measure end. The first click starts a reading, the second completes it,
   * and a third starts a fresh one — so repeated measurements need no reset in between.
   */
  addMeasurePoint: (pt: Point) => void;
  clearMeasurement: () => void;
  startCalibration: () => void;
  addCalibrationPoint: (pt: Point) => void;
  finishCalibration: (realDistanceMm: number) => void;
  cancelCalibration: () => void;
  setStageTransform: (pxPerMm: number, x: number, y: number) => void;
  /** Frame the whole drawing in a viewport of the given screen size. */
  fitViewToContent: (viewportWidth: number, viewportHeight: number) => void;
  recomputeZoneSpiral: (zoneId: string) => void;
}

export type PersistedZone = Pick<
  Zone,
  | 'id'
  | 'name'
  | 'color'
  | 'polygon'
  | 'spacingMm'
  | 'paddingMm'
  | 'connectionCorner'
  | 'startDirection'
  | 'leaderWaypoints'
  | 'manifoldPortOffsetMm'
>;

export interface PersistedStoreState {
  /** Bumped when the on-disk shape changes; drives migration on load. */
  schemaVersion: number;
  maxCircuitLengthM: number;
  defaultSpacingMm: number;
  supplyTempC: number;
  returnTempC: number;
  flowLpmPer100m: number;
  pipeOuterDiameterMm: number;
  background: Background | null;
  zones: PersistedZone[];
  manifold: Manifold | null;
}

export const UFH_STORE_STORAGE_KEY = 'ufh-designer-store';

let zoneCounter = 1;

function createTransientState(): Pick<
  StoreState,
  | 'selectedZoneId'
  | 'toolMode'
  | 'drawingPoints'
  | 'drawRectStart'
  | 'routing'
  | 'calibration'
  | 'measurement'
> {
  return {
    selectedZoneId: null,
    toolMode: 'select',
    drawingPoints: [],
    drawRectStart: null,
    routing: null,
    calibration: { active: false, point1: null, point2: null },
    measurement: { start: null, end: null },
  };
}

/**
 * Recompute spirals for freshly-hydrated zones, keeping their persisted manual
 * leader waypoints intact, then re-derive `leaderLengthMm` (also derived data,
 * not persisted) from those waypoints against the current stub/port geometry.
 */
function recomputeZones(
  zones: Zone[],
  manifold: Manifold | null,
): Zone[] {
  const withSpirals = zones.map((zone) =>
    recomputeSpiral(zone, manifold, { preserveLeaderRouting: true }),
  );

  if (!manifold) return withSpirals;

  return withSpirals.map((zone) => {
    if (!zone.leaderWaypoints) return zone;
    const stubs = zone.spiral ? getSpiralStubs(zone.spiral) : null;
    const pair = getZoneManifoldPorts(manifold, zone);
    if (!stubs || !pair) return { ...zone, leaderLengthMm: 0 };

    const fullPath = assembleLeaderPath(
      midpoint(stubs.start, stubs.end),
      zone.leaderWaypoints,
      midpoint(pair.supplyPort, pair.returnPort),
    );
    // One drawn path represents the supply+return pair, so it accounts for two pipe runs.
    return { ...zone, leaderLengthMm: pathLengthMm(fullPath) * 2 };
  });
}

/**
 * Resize a placed floor plan about `anchor`: the anchor point keeps its place in the
 * drawing and everything on the plan moves away from (or toward) it by `factor`.
 */
function scaleBackgroundAbout(background: Background, factor: number, anchor: Point): Background {
  const about = (value: number, origin: number) => origin + (value - origin) * factor;

  if (background.kind === 'image') {
    return {
      ...background,
      x: about(background.x, anchor.x),
      y: about(background.y, anchor.y),
      mmPerPixel: background.mmPerPixel * factor,
    };
  }

  // A DXF point lands at `unit * scale + offset` (y negated), so scaling the offset about
  // the anchor and the scale by the factor moves the whole plan the same way.
  return {
    ...background,
    transform: {
      offsetX: about(background.transform.offsetX, anchor.x),
      offsetY: about(background.transform.offsetY, anchor.y),
      scale: background.transform.scale * factor,
    },
  };
}

/**
 * Extent of everything drawn, in mm — zones, the manifold and the imported plan — for
 * framing the view. Null when the drawing is empty and there's nothing to frame.
 */
function getDrawingBoundsMm(
  state: Pick<StoreState, 'zones' | 'manifold' | 'background'>,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const points: Point[] = [];

  for (const zone of state.zones) points.push(...zone.polygon.points);
  if (state.manifold) points.push(state.manifold.position);

  const { background } = state;
  if (background?.kind === 'image') {
    points.push({ x: background.x, y: background.y });
    points.push({
      x: background.x + background.naturalWidth * background.mmPerPixel,
      y: background.y + background.naturalHeight * background.mmPerPixel,
    });
  } else if (background?.kind === 'dxf') {
    const bounds = dxfBoundingBox(background.entities);
    if (bounds) {
      const { offsetX, offsetY, scale } = background.transform;
      // DXF y grows upward and the drawing's grows down, so the box flips as it lands.
      points.push({ x: bounds.minX * scale + offsetX, y: offsetY - bounds.maxY * scale });
      points.push({ x: bounds.maxX * scale + offsetX, y: offsetY - bounds.minY * scale });
    }
  }

  if (points.length === 0) return null;

  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

/** Clear a zone's manual leader routing (and chosen manifold outlet) — used whenever the manifold or spiral geometry moves. */
function clearZoneLeaderRouting(zone: Zone): Zone {
  if (
    zone.leaderWaypoints === null &&
    zone.manifoldPortOffsetMm === null &&
    zone.leaderLengthMm === 0
  ) {
    return zone;
  }
  return {
    ...zone,
    leaderWaypoints: null,
    manifoldPortOffsetMm: null,
    leaderLengthMm: 0,
  };
}

/** The leader path's fixed ends: between the spiral's two stub ends, and between the zone's two manifold ports. */
function resolveLeaderAnchorTarget(
  zone: Zone,
  manifold: Manifold,
): { anchor: Point; target: Point } | null {
  const stubs = zone.spiral ? getSpiralStubs(zone.spiral) : null;
  if (!stubs) return null;
  const pair = getZoneManifoldPorts(manifold, zone);
  if (!pair) return null;
  return { anchor: midpoint(stubs.start, stubs.end), target: midpoint(pair.supplyPort, pair.returnPort) };
}

/**
 * Commit a new set of user-drawn leader waypoints onto a zone. The approach into the
 * manifold is never stored — it's rebuilt from the waypoints on every render — so only
 * the drawn part is repaired when `reflow` is set (on drag release), and the recorded
 * length is measured against the assembled path including that approach.
 *
 * Returns null when the zone has no spiral or manifold connection to route between.
 */
function withLeaderWaypoints(
  zone: Zone,
  manifold: Manifold,
  waypoints: Point[],
  reflow: boolean,
): Zone | null {
  const anchorTarget = resolveLeaderAnchorTarget(zone, manifold);
  if (!anchorTarget) return null;

  const repaired = reflow ? reflowLeaderWaypoints(anchorTarget.anchor, waypoints) : waypoints;
  const fullPath = assembleLeaderPath(anchorTarget.anchor, repaired, anchorTarget.target);

  return {
    ...zone,
    leaderWaypoints: repaired,
    // One drawn path represents the supply+return pair, so it accounts for two pipe runs.
    leaderLengthMm: pathLengthMm(fullPath) * 2,
  };
}

function getZoneBounds(zone: Zone) {
  const xs = zone.polygon.points.map((point) => point.x);
  const ys = zone.polygon.points.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

type ZoneEdge = 'top' | 'bottom' | 'left' | 'right';

/**
 * Resolve which manifold edge the spiral connects to, plus whether the
 * canonical spiral must be mirrored so its open ends land at the requested
 * corner.
 *
 * Each corner touches two edges: a horizontal one (start direction `vertical`)
 * and a vertical one (start direction `horizontal`). The mirror flag keeps the
 * open ends pinned to the corner while switching between those two edges.
 */
function getConnectionEdgeAndMirror(
  corner: ZoneConnectionCorner,
  direction: SpiralStartDirection,
): { edge: ZoneEdge; mirror: boolean } {
  const vertical = direction === 'vertical';

  switch (corner) {
    case 'bottom-left':
      return vertical ? { edge: 'bottom', mirror: false } : { edge: 'left', mirror: true };
    case 'bottom-right':
      return vertical ? { edge: 'bottom', mirror: true } : { edge: 'right', mirror: false };
    case 'top-left':
      return vertical ? { edge: 'top', mirror: true } : { edge: 'left', mirror: false };
    case 'top-right':
      return vertical ? { edge: 'top', mirror: false } : { edge: 'right', mirror: true };
  }
}

function getZoneConnection(
  zone: Zone,
  manifold: Manifold | null,
): { hint: Point | undefined; mirror: boolean } {
  if (zone.polygon.points.length < 3) {
    return { hint: manifold?.position, mirror: false };
  }

  const bounds = getZoneBounds(zone);
  const insetY = (bounds.minY + bounds.maxY) / 2;
  const insetX = (bounds.minX + bounds.maxX) / 2;
  const far = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1000) * 4;

  const { edge, mirror } = getConnectionEdgeAndMirror(
    zone.connectionCorner,
    getZoneStartDirection(zone),
  );

  switch (edge) {
    case 'left':
      return { hint: { x: bounds.minX - far, y: insetY }, mirror };
    case 'right':
      return { hint: { x: bounds.maxX + far, y: insetY }, mirror };
    case 'top':
      return { hint: { x: insetX, y: bounds.minY - far }, mirror };
    case 'bottom':
      return { hint: { x: insetX, y: bounds.maxY + far }, mirror };
  }
}

function getZonePaddingMm(zone: Partial<Pick<Zone, 'paddingMm'>>): number {
  if (!Number.isFinite(zone.paddingMm)) {
    return DEFAULT_ZONE_PADDING_MM;
  }

  return Math.max(0, zone.paddingMm ?? DEFAULT_ZONE_PADDING_MM);
}

function getZoneConnectionCorner(
  zone: Partial<Pick<Zone, 'connectionCorner'>>,
): ZoneConnectionCorner {
  const corner = zone.connectionCorner;
  if (
    corner === 'top-left' ||
    corner === 'top-right' ||
    corner === 'bottom-left' ||
    corner === 'bottom-right'
  ) {
    return corner;
  }

  return DEFAULT_ZONE_CONNECTION_CORNER;
}

function getZoneStartDirection(
  zone: Partial<Pick<Zone, 'startDirection' | 'connectionCorner'>>,
): SpiralStartDirection {
  if (zone.startDirection === 'horizontal' || zone.startDirection === 'vertical') {
    return zone.startDirection;
  }

  return getDefaultStartDirection(getZoneConnectionCorner(zone));
}

function toPersistedZone(zone: Zone): PersistedZone {
  return {
    id: zone.id,
    name: zone.name,
    color: zone.color,
    polygon: zone.polygon,
    spacingMm: zone.spacingMm,
    paddingMm: zone.paddingMm,
    connectionCorner: zone.connectionCorner,
    startDirection: zone.startDirection,
    leaderWaypoints: zone.leaderWaypoints,
    manifoldPortOffsetMm: zone.manifoldPortOffsetMm,
  };
}

function hydrateZone(zone: Partial<PersistedZone> & Pick<Zone, 'id' | 'name' | 'color' | 'polygon' | 'spacingMm'>): Zone {
  return {
    id: zone.id,
    name: zone.name,
    color: zone.color,
    polygon: zone.polygon,
    paddingMm: getZonePaddingMm(zone),
    connectionCorner: getZoneConnectionCorner(zone),
    startDirection: getZoneStartDirection(zone),
    spacingMm: zone.spacingMm,
    spiral: null,
    spiralLengthMm: 0,
    leaderLengthMm: 0,
    areaMm2: 0,
    leaderWaypoints: Array.isArray(zone.leaderWaypoints) ? zone.leaderWaypoints : null,
    manifoldPortOffsetMm: Number.isFinite(zone.manifoldPortOffsetMm) ? (zone.manifoldPortOffsetMm as number) : null,
  };
}

function getNextZoneCounter(zones: Zone[]): number {
  const highestAutoZoneNumber = zones.reduce((highest, zone) => {
    const match = zone.name.match(/^Zone (\d+)$/);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);

  return Math.max(zones.length + 1, highestAutoZoneNumber + 1, 1);
}

function normalizeRotation(rotationDeg: number): number {
  const wrapped = rotationDeg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function normalizeManifold(manifold: Manifold | null): Manifold | null {
  if (!manifold) return null;
  return {
    ...manifold,
    rotationDeg: normalizeRotation(manifold.rotationDeg ?? 0),
  };
}

/**
 * Recompute a zone's spiral. Leader routing is manual, so any geometry change
 * that could move the spiral's stubs invalidates the previously-drawn leader
 * paths — unless `preserveLeaderRouting` is set (used only when hydrating
 * from storage, where the saved routes should survive a reload).
 */
function recomputeSpiral(
  zone: Zone,
  manifold: Manifold | null,
  options: { preserveLeaderRouting?: boolean } = {},
): Zone {
  // Spacing and padding are authored in mm and the drawing is in mm, so they go straight
  // in — no conversion, which is the point of keeping one unit throughout.
  const { hint, mirror } = getZoneConnection(zone, manifold);
  const spiral = generateSerpentine(zone.polygon, zone.spacingMm, hint, zone.paddingMm, mirror);
  const spiralLengthMm = pathLengthMm(spiral);
  const areaMm2 = polygonArea(zone.polygon.points);

  if (options.preserveLeaderRouting) {
    return { ...zone, spiral, spiralLengthMm, areaMm2 };
  }

  return {
    ...zone,
    spiral,
    spiralLengthMm,
    areaMm2,
    leaderWaypoints: null,
    manifoldPortOffsetMm: null,
    leaderLengthMm: 0,
  };
}

/** Build a rectangular polygon from two opposite corners */
function rectPolygon(a: Point, b: Point) {
  return {
    points: [
      { x: a.x, y: a.y },
      { x: b.x, y: a.y },
      { x: b.x, y: b.y },
      { x: a.x, y: b.y },
    ],
  };
}


/**
 * Version 1 stored every coordinate in screen pixels, with a `pixelsPerMeter` factor
 * recording what those pixels meant. Version 2 stores millimetres outright.
 */
export const CURRENT_SCHEMA_VERSION = 2;

/** The version-1 fields, present only in files saved before the move to millimetres. */
interface LegacyPixelState {
  pixelsPerMeter?: number;
  zones?: Array<Record<string, unknown>>;
  background?: Record<string, unknown> | null;
}

function scalePoint(point: Point, factor: number): Point {
  return { x: point.x * factor, y: point.y * factor };
}

/**
 * Bring a pre-millimetre project forward. Everything positional was in pixels, so one
 * factor — millimetres per pixel, read off the file's own calibration — converts the lot.
 * A project already at the current version passes through untouched.
 */
function migrateToMillimetres(
  persisted: Partial<PersistedStoreState> & LegacyPixelState,
): Partial<PersistedStoreState> {
  const { schemaVersion, pixelsPerMeter, ...rest } = persisted as Partial<PersistedStoreState> &
    LegacyPixelState & { schemaVersion?: number };

  if (schemaVersion === CURRENT_SCHEMA_VERSION) return rest as Partial<PersistedStoreState>;
  if (!Number.isFinite(pixelsPerMeter) || !pixelsPerMeter || pixelsPerMeter <= 0) {
    // No calibration to convert with: the coordinates are unrecoverable as real lengths,
    // so keep the design and let the user recalibrate rather than silently mis-scaling it.
    return rest as Partial<PersistedStoreState>;
  }

  const mmPerPx = 1000 / pixelsPerMeter;
  const legacyZones = Array.isArray(persisted.zones) ? persisted.zones : [];
  const legacyBackground = persisted.background as Record<string, unknown> | null | undefined;

  return {
    ...(rest as Partial<PersistedStoreState>),
    zones: legacyZones.map((zone) => {
      const polygon = zone.polygon as { points?: Point[] } | undefined;
      const waypoints = zone.leaderWaypoints as Point[] | null | undefined;
      const offsetPx = (zone as Record<string, unknown>).manifoldPortOffsetPx as
        | number
        | null
        | undefined;
      return {
        ...zone,
        polygon: { points: (polygon?.points ?? []).map((point) => scalePoint(point, mmPerPx)) },
        leaderWaypoints: Array.isArray(waypoints)
          ? waypoints.map((point) => scalePoint(point, mmPerPx))
          : null,
        manifoldPortOffsetMm: Number.isFinite(offsetPx) ? (offsetPx as number) * mmPerPx : null,
      };
    }) as PersistedStoreState['zones'],
    manifold: persisted.manifold
      ? { ...persisted.manifold, position: scalePoint(persisted.manifold.position, mmPerPx) }
      : (persisted.manifold ?? null),
    background: migrateBackgroundToMillimetres(legacyBackground, mmPerPx),
  };
}

function migrateBackgroundToMillimetres(
  background: Record<string, unknown> | null | undefined,
  mmPerPx: number,
): Background | null {
  if (!background) return null;

  if (background.kind === 'image') {
    return {
      kind: 'image',
      src: background.src as string,
      naturalWidth: background.naturalWidth as number,
      naturalHeight: background.naturalHeight as number,
      x: (background.fitX as number) * mmPerPx,
      y: (background.fitY as number) * mmPerPx,
      // Was image-pixels-to-screen-pixels; screen pixels are now millimetres.
      mmPerPixel: (background.fitScale as number) * mmPerPx,
    };
  }

  const transform = background.transform as { offsetX: number; offsetY: number; scale: number };
  return {
    kind: 'dxf',
    entities: background.entities as Background extends { kind: 'dxf'; entities: infer E }
      ? E
      : never,
    transform: {
      offsetX: transform.offsetX * mmPerPx,
      offsetY: transform.offsetY * mmPerPx,
      scale: transform.scale * mmPerPx,
    },
  };
}

export function partializeStoreState(state: StoreState): PersistedStoreState {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    maxCircuitLengthM: state.maxCircuitLengthM,
    defaultSpacingMm: state.defaultSpacingMm,
    supplyTempC: state.supplyTempC,
    returnTempC: state.returnTempC,
    flowLpmPer100m: state.flowLpmPer100m,
    pipeOuterDiameterMm: state.pipeOuterDiameterMm,
    background: state.background,
    zones: state.zones.map(toPersistedZone),
    manifold: state.manifold,
  };
}

export function mergePersistedStoreState(
  persistedState: unknown,
  currentState: StoreState,
): StoreState {
  const persisted = migrateToMillimetres(
    persistedState && typeof persistedState === 'object'
      ? (persistedState as Partial<PersistedStoreState> & LegacyPixelState)
      : {},
  );
  const hydratedZones = Array.isArray(persisted.zones)
    ? persisted.zones.map((zone) =>
        hydrateZone(zone as Partial<PersistedZone> & Pick<Zone, 'id' | 'name' | 'color' | 'polygon' | 'spacingMm'>),
      )
    : currentState.zones;
  const merged = {
    ...currentState,
    ...persisted,
    // Drawings saved before pipe size was a setting predate 18x2 tube, so they get 16x2.
    pipeOuterDiameterMm:
      typeof persisted.pipeOuterDiameterMm === 'number' && persisted.pipeOuterDiameterMm > 0
        ? persisted.pipeOuterDiameterMm
        : DEFAULT_PIPE_OUTER_DIAMETER_MM,
    manifold: normalizeManifold(persisted.manifold ?? currentState.manifold),
    zones: hydratedZones,
  };
  const zones = recomputeZones(merged.zones, merged.manifold);

  zoneCounter = getNextZoneCounter(zones);

  return {
    ...merged,
    zones,
    ...createTransientState(),
  };
}

const createStoreState: StateCreator<StoreState, [], []> = (set, get) => ({
  pxPerMm: DEFAULT_PX_PER_MM,
  maxCircuitLengthM: 100,
  defaultSpacingMm: 150,
  supplyTempC: 40,
  returnTempC: 35,
  flowLpmPer100m: 2,
  pipeOuterDiameterMm: DEFAULT_PIPE_OUTER_DIAMETER_MM,
  background: null,
  zones: [],
  manifold: null,
  stageX: 0,
  stageY: 0,
  ...createTransientState(),

  setBackground: (bg) => set({ background: bg }),

  moveBackground: (deltaX, deltaY) => {
    const { background } = get();
    if (!background) return;
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;

    set({
      background:
        background.kind === 'image'
          ? { ...background, x: background.x + deltaX, y: background.y + deltaY }
          : {
              ...background,
              transform: {
                ...background.transform,
                offsetX: background.transform.offsetX + deltaX,
                offsetY: background.transform.offsetY + deltaY,
              },
            },
    });
  },

  setToolMode: (mode) => set({ toolMode: mode, drawingPoints: [], drawRectStart: null, routing: null }),

  setManifold: (pos) => {
    const rotationDeg = get().manifold?.rotationDeg ?? 0;
    const manifold = { position: pos, rotationDeg };
    set({ manifold, toolMode: 'select', routing: null, zones: recomputeZones(get().zones, manifold) });
  },

  updateManifoldPosition: (pos) => {
    const rotationDeg = get().manifold?.rotationDeg ?? 0;
    const manifold = { position: pos, rotationDeg };
    /*
     * Moving the manifold keeps every routed leader. A zone's connection is stored as an
     * offset along the manifold's own length, and the spiral's shape depends on the zone's
     * connection corner rather than on where the manifold sits — so the ports travel with
     * the manifold, the drawn waypoints stay where they were put, and the run between them
     * re-aims itself. Only the recorded lengths need redoing.
     */
    set({ manifold, routing: null, zones: recomputeZones(get().zones, manifold) });
  },

  setManifoldRotation: (rotationDeg) => {
    const current = get().manifold;
    if (!current) return;
    // Rotating swings the ports around the manifold's centre; as with moving it, the
    // leaders follow rather than being thrown away.
    const manifold = { ...current, rotationDeg: normalizeRotation(rotationDeg) };
    set({ manifold, routing: null, zones: recomputeZones(get().zones, manifold) });
  },

  addDrawingPoint: (pt) => set((state) => ({ drawingPoints: [...state.drawingPoints, pt] })),

  closeZone: () => {
    const { drawingPoints, zones, manifold, defaultSpacingMm } = get();
    if (drawingPoints.length < 3) {
      set({ drawingPoints: [] });
      return;
    }

    const colorIdx = zones.length % ZONE_COLORS.length;
    const id = `zone-${Date.now()}`;
    const newZone: Zone = {
      id,
      name: `Zone ${zoneCounter++}`,
      color: ZONE_COLORS[colorIdx],
      polygon: { points: drawingPoints },
      spacingMm: defaultSpacingMm,
      paddingMm: DEFAULT_ZONE_PADDING_MM,
      connectionCorner: DEFAULT_ZONE_CONNECTION_CORNER,
      startDirection: DEFAULT_ZONE_START_DIRECTION,
      spiral: null,
      spiralLengthMm: 0,
      leaderLengthMm: 0,
      areaMm2: 0,
      leaderWaypoints: null,
      manifoldPortOffsetMm: null,
    };

    const computed = recomputeSpiral(newZone, manifold);
    set({
      zones: [...zones, computed],
      drawingPoints: [],
      toolMode: 'select',
      selectedZoneId: id,
    });
  },

  cancelDrawing: () => set({ drawingPoints: [], drawRectStart: null, toolMode: 'select' }),

  startDrawRect: (pt) => set({ drawRectStart: pt }),

  finishDrawRect: (pt) => {
    const { drawRectStart, zones, manifold, defaultSpacingMm } = get();
    if (!drawRectStart) return;

    // Need at least a minimal area (avoid degenerate rects)
    if (Math.abs(pt.x - drawRectStart.x) < 2 || Math.abs(pt.y - drawRectStart.y) < 2) {
      set({ drawRectStart: null, toolMode: 'select' });
      return;
    }

    const colorIdx = zones.length % ZONE_COLORS.length;
    const id = `zone-${Date.now()}`;
    const newZone: Zone = {
      id,
      name: `Zone ${zoneCounter++}`,
      color: ZONE_COLORS[colorIdx],
      polygon: rectPolygon(drawRectStart, pt),
      spacingMm: defaultSpacingMm,
      paddingMm: DEFAULT_ZONE_PADDING_MM,
      connectionCorner: DEFAULT_ZONE_CONNECTION_CORNER,
      startDirection: DEFAULT_ZONE_START_DIRECTION,
      spiral: null,
      spiralLengthMm: 0,
      leaderLengthMm: 0,
      areaMm2: 0,
      leaderWaypoints: null,
      manifoldPortOffsetMm: null,
    };

    const computed = recomputeSpiral(newZone, manifold);
    set({
      zones: [...zones, computed],
      drawRectStart: null,
      toolMode: 'select',
      selectedZoneId: id,
    });
  },

  cancelDrawRect: () => set({ drawRectStart: null, toolMode: 'select' }),

  deleteZone: (id) =>
    set((state) => ({
      zones: state.zones.filter((zone) => zone.id !== id),
      selectedZoneId: state.selectedZoneId === id ? null : state.selectedZoneId,
    })),

  selectZone: (id) => set({ selectedZoneId: id }),

  updateZoneSpacing: (id, spacingMm) => {
    const { zones, manifold } = get();
    const updated = zones.map((zone) =>
      zone.id === id ? recomputeSpiral({ ...zone, spacingMm }, manifold) : zone,
    );
    set({ zones: updated });
  },

  updateZonePadding: (id, paddingMm) => {
    const { zones, manifold } = get();
    const normalizedPaddingMm = Math.max(0, paddingMm);
    const updated = zones.map((zone) =>
      zone.id === id
        ? recomputeSpiral({ ...zone, paddingMm: normalizedPaddingMm }, manifold)
        : zone,
    );
    set({ zones: updated });
  },

  updateZoneConnectionCorner: (id, corner) =>
    set((state) => {
      const updated = state.zones.map((zone) => {
        if (zone.id !== id) return zone;
        return recomputeSpiral(
          { ...zone, connectionCorner: corner },
          state.manifold,
        );
      });
      return { zones: updated };
    }),

  updateZoneStartDirection: (id, direction) =>
    set((state) => {
      const updated = state.zones.map((zone) => {
        if (zone.id !== id) return zone;
        return recomputeSpiral(
          { ...zone, startDirection: direction },
          state.manifold,
        );
      });
      return { zones: updated };
    }),

  updateZoneName: (id, name) =>
    set((state) => ({
      zones: state.zones.map((zone) => (zone.id === id ? { ...zone, name } : zone)),
    })),

  updateZoneVertex: (zoneId, vertexIdx, pt) => {
    const { zones, manifold } = get();
    const updated = zones.map((zone) => {
      if (zone.id !== zoneId) return zone;
      const originalPoints = zone.polygon.points;
      let points: Point[];
      if (isAxisAlignedRect(originalPoints)) {
        points = resizeRectFromCorner(originalPoints, vertexIdx, pt);
      } else {
        points = [...originalPoints];
        points[vertexIdx] = pt;
      }

      const previousStubs = zone.spiral ? getSpiralStubs(zone.spiral) : null;
      const recomputed = recomputeSpiral({ ...zone, polygon: { points } }, manifold, {
        preserveLeaderRouting: true,
      });

      if (!zone.leaderWaypoints || !previousStubs || !recomputed.spiral || !manifold) {
        // Nothing routed yet, or no spiral/manifold to compare against — nothing to preserve.
        return { ...recomputed, leaderWaypoints: null, manifoldPortOffsetMm: null, leaderLengthMm: 0 };
      }

      const newStubs = getSpiralStubs(recomputed.spiral);
      const anchorShiftMm = newStubs
        ? distanceMm(midpoint(previousStubs.start, previousStubs.end), midpoint(newStubs.start, newStubs.end))
        : Infinity;

      if (anchorShiftMm > ZONE_RESIZE_ROUTING_TOLERANCE_MM) {
        // The connection point moved enough that the old routing no longer makes sense.
        return { ...recomputed, leaderWaypoints: null, manifoldPortOffsetMm: null, leaderLengthMm: 0 };
      }

      // Barely moved — keep the routing, just repair the first segment against the new anchor.
      return (
        withLeaderWaypoints(recomputed, manifold, zone.leaderWaypoints, true) ?? recomputed
      );
    });
    set({ zones: updated });
  },

  startRouteZone: (zoneId) => {
    const zone = get().zones.find((candidate) => candidate.id === zoneId);
    if (!zone || !zone.spiral || zone.spiral.length < 2) return;

    const zones = get().zones.map((candidate) =>
      candidate.id === zoneId ? clearZoneLeaderRouting(candidate) : candidate,
    );
    set({
      zones,
      routing: { zoneId, points: [] },
      selectedZoneId: zoneId,
    });
  },

  addRoutePoint: (rawPt) => {
    const { routing, zones, manifold } = get();
    if (!routing || !manifold) return;
    const zone = zones.find((candidate) => candidate.id === routing.zoneId);
    if (!zone || !zone.spiral) return;

    const layout = getManifoldLayout(manifold, zones);
    if (isPointOnManifold(rawPt, manifold, layout, MANIFOLD_CLICK_MARGIN_MM)) {
      get().finishRouting(rawPt);
      return;
    }

    const stubs = getSpiralStubs(zone.spiral);
    if (!stubs) return;

    const anchor = midpoint(stubs.start, stubs.end);
    const exitDir = getStubExitDirection(zone.spiral, 'start');
    const snapped =
      routing.points.length === 0
        ? snapFirstLegPoint(anchor, exitDir, rawPt, MIN_LEADER_SEGMENT_MM)
        : snapElbowPoint(
            routing.points[routing.points.length - 1],
            rawPt,
            getIncomingLegDirection(exitDir, routing.points),
          );

    set({ routing: { ...routing, points: [...routing.points, snapped] } });
  },

  finishRouting: (clickPos) => {
    const { routing, zones, manifold } = get();
    if (!routing || !manifold) return;
    const zone = zones.find((candidate) => candidate.id === routing.zoneId);
    if (!zone || !zone.spiral) return;

    // The user picks the outlet by clicking it directly; it can be slid afterward.
    const rawOffsetMm = projectPointOntoManifold(manifold, clickPos);
    const manifoldPortOffsetMm = clampManifoldOffset(manifold, zones, rawOffsetMm);

    // Only the drawn elbows are stored — the run from the last elbow into the manifold is
    // derived, so it can cut diagonally or grow a bend as the geometry changes.
    const updatedZone = withLeaderWaypoints(
      { ...zone, manifoldPortOffsetMm },
      manifold,
      routing.points,
      false,
    );
    if (!updatedZone) return;
    const updatedZones = zones.map((candidate) => (candidate.id === zone.id ? updatedZone : candidate));

    set({ zones: updatedZones, routing: null });
  },

  cancelRouting: () => set({ routing: null }),

  updateLeaderWaypoint: (zoneId, waypointIndex, pt, reflow) => {
    const { zones, manifold } = get();
    if (!manifold) return;
    const zone = zones.find((candidate) => candidate.id === zoneId);
    if (!zone || !zone.leaderWaypoints) return;

    const updatedWaypoints = zone.leaderWaypoints.map((point, i) => (i === waypointIndex ? pt : point));
    // Only restructure the array (insert/drop bend points) on drag-end. Doing it on every
    // live drag-move would change the array's length mid-gesture, invalidating the dragged
    // circle's waypointIndex (captured when the drag started) for subsequent move events.
    const updatedZone = withLeaderWaypoints(zone, manifold, updatedWaypoints, reflow);
    if (!updatedZone) return;
    set({ zones: zones.map((candidate) => (candidate.id === zoneId ? updatedZone : candidate)) });
  },

  updateLeaderSegment: (zoneId, waypointIndexA, waypointIndexB, axis, value, reflow) => {
    const { zones, manifold } = get();
    if (!manifold) return;
    const zone = zones.find((candidate) => candidate.id === zoneId);
    if (!zone || !zone.leaderWaypoints) return;

    const updatedWaypoints = zone.leaderWaypoints.map((point, i) => {
      if (i !== waypointIndexA && i !== waypointIndexB) return point;
      return axis === 'x' ? { x: value, y: point.y } : { x: point.x, y: value };
    });
    // Same drag-move-vs-drag-end split as updateLeaderWaypoint: keep the array shape stable
    // (both waypointIndexA/B still valid) while dragging, only restructuring at the end.
    const updatedZone = withLeaderWaypoints(zone, manifold, updatedWaypoints, reflow);
    if (!updatedZone) return;
    set({ zones: zones.map((candidate) => (candidate.id === zoneId ? updatedZone : candidate)) });
  },

  updateLeaderManifoldSegment: (zoneId, waypointIndex, axis, value, reflow) => {
    const { zones, manifold } = get();
    if (!manifold) return;
    const zone = zones.find((candidate) => candidate.id === zoneId);
    if (!zone || !zone.leaderWaypoints || zone.leaderWaypoints.length === 0) return;

    const pair = getZoneManifoldPorts(manifold, zone);
    if (!pair) return;
    const currentTarget = midpoint(pair.supplyPort, pair.returnPort);
    // Slide the manifold connection to wherever the segment's far end lands, by projecting
    // that proposed point onto the manifold's tangent — robust to any manifold rotation,
    // not just axis-aligned ones.
    const proposedTarget = axis === 'x' ? { x: value, y: currentTarget.y } : { x: currentTarget.x, y: value };
    const clampedOffsetMm = clampManifoldOffset(
      manifold,
      zones,
      projectPointOntoManifold(manifold, proposedTarget),
    );

    const updatedWaypoints = zone.leaderWaypoints.map((point, i) => {
      if (i !== waypointIndex) return point;
      return axis === 'x' ? { x: value, y: point.y } : { x: point.x, y: value };
    });

    // Same drag-move-vs-drag-end split as updateLeaderWaypoint: the drawn waypoints are
    // only re-bent once, on release, not on every live-drag tick.
    const updatedZone = withLeaderWaypoints(
      { ...zone, manifoldPortOffsetMm: clampedOffsetMm },
      manifold,
      updatedWaypoints,
      reflow,
    );
    if (!updatedZone) return;
    set({ zones: zones.map((candidate) => (candidate.id === zoneId ? updatedZone : candidate)) });
  },

  slideZoneManifoldPort: (zoneId, pt) => {
    const { zones, manifold } = get();
    if (!manifold) return;
    const zone = zones.find((candidate) => candidate.id === zoneId);
    if (!zone || !zone.leaderWaypoints) return;

    const clampedOffsetMm = clampManifoldOffset(
      manifold,
      zones,
      projectPointOntoManifold(manifold, pt),
    );

    // The drawn waypoints don't move at all: the approach into the manifold is derived, so
    // it just re-aims at the new port — cutting across diagonally, or growing a bend once
    // that diagonal would run past its limit.
    const updatedZone = withLeaderWaypoints(
      { ...zone, manifoldPortOffsetMm: clampedOffsetMm },
      manifold,
      zone.leaderWaypoints,
      false,
    );
    if (!updatedZone) return;
    set({ zones: zones.map((candidate) => (candidate.id === zoneId ? updatedZone : candidate)) });
  },

  rescaleBackground: (factor, anchor) => {
    if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return;
    const { background, zones, manifold } = get();
    if (!background) return;

    // The zone boundaries and routed paths were traced on the plan at its old scale.
    // Keep them on the same features when the scale changes. Pipe spacing and padding
    // are physical measurements, so they retain their values in millimetres.
    const about = (point: Point): Point => ({
      x: anchor.x + (point.x - anchor.x) * factor,
      y: anchor.y + (point.y - anchor.y) * factor,
    });
    const scaledManifold = manifold ? { ...manifold, position: about(manifold.position) } : null;
    const scaledZones = zones.map((zone) => ({
      ...zone,
      polygon: { points: zone.polygon.points.map(about) },
      leaderWaypoints: zone.leaderWaypoints?.map(about) ?? null,
      manifoldPortOffsetMm: zone.manifoldPortOffsetMm === null
        ? null
        : zone.manifoldPortOffsetMm * factor,
    }));
    set({
      background: scaleBackgroundAbout(background, factor, anchor),
      manifold: scaledManifold,
      zones: recomputeZones(scaledZones, scaledManifold),
    });
  },

  setMaxCircuitLength: (m) => set({ maxCircuitLengthM: m }),

  setDefaultSpacing: (mm) => set({ defaultSpacingMm: mm }),

  setSupplyTempC: (celsius) => set({ supplyTempC: celsius }),

  setReturnTempC: (celsius) => set({ returnTempC: celsius }),

  setFlowLpmPer100m: (lpm) => set({ flowLpmPer100m: lpm }),

  setPipeOuterDiameter: (mm) => set({ pipeOuterDiameterMm: mm }),

  addMeasurePoint: (pt) => {
    const { measurement } = get();
    // A completed reading is replaced rather than extended, so measuring twice in a row
    // is just click-click, click-click.
    const startFresh = !measurement.start || measurement.end;
    set({ measurement: startFresh ? { start: pt, end: null } : { ...measurement, end: pt } });
  },

  clearMeasurement: () => set({ measurement: { start: null, end: null } }),

  startCalibration: () =>
    set({
      calibration: { active: true, point1: null, point2: null },
      // Calibration owns the next two canvas clicks. Clear any drawing mode so those
      // clicks cannot accidentally become polygon vertices instead.
      toolMode: 'select',
      drawingPoints: [],
      drawRectStart: null,
      routing: null,
    }),

  addCalibrationPoint: (pt) => {
    const { calibration } = get();
    if (!calibration.point1) {
      set({ calibration: { ...calibration, point1: pt } });
      return;
    }

    if (!calibration.point2) {
      set({ calibration: { ...calibration, point2: pt } });
    }
  },

  finishCalibration: (realDistanceMm) => {
    const { calibration } = get();
    if (!calibration.point1 || !calibration.point2) return;

    // The span the user just clicked, as the plan currently claims it to be. The ratio
    // against what they say it really is, is how wrong the plan's own scale is.
    const measuredMm = distanceMm(calibration.point1, calibration.point2);
    if (measuredMm > 0 && realDistanceMm > 0) {
      get().rescaleBackground(realDistanceMm / measuredMm, calibration.point1);
    }

    set({ calibration: { active: false, point1: null, point2: null } });
  },

  cancelCalibration: () => set({ calibration: { active: false, point1: null, point2: null } }),

  setStageTransform: (pxPerMm, x, y) => set({ pxPerMm, stageX: x, stageY: y }),

  fitViewToContent: (viewportWidth, viewportHeight) => {
    const bounds = getDrawingBoundsMm(get());
    if (!bounds || viewportWidth <= 0 || viewportHeight <= 0) {
      set({ pxPerMm: DEFAULT_PX_PER_MM, stageX: 0, stageY: 0 });
      return;
    }

    const widthMm = Math.max(bounds.maxX - bounds.minX, 1);
    const heightMm = Math.max(bounds.maxY - bounds.minY, 1);
    const marginPx = 40;
    const pxPerMm = Math.min(
      (viewportWidth - marginPx * 2) / widthMm,
      (viewportHeight - marginPx * 2) / heightMm,
    );

    // Centre the content: the stage offset is in screen pixels, so the drawing's mm
    // centre is scaled before being subtracted from the viewport's centre.
    set({
      pxPerMm,
      stageX: viewportWidth / 2 - ((bounds.minX + bounds.maxX) / 2) * pxPerMm,
      stageY: viewportHeight / 2 - ((bounds.minY + bounds.maxY) / 2) * pxPerMm,
    });
  },

  recomputeZoneSpiral: (zoneId) => {
    const { zones, manifold } = get();
    const updated = zones.map((zone) =>
      zone.id === zoneId ? recomputeSpiral(zone, manifold) : zone,
    );
    set({ zones: updated });
  },
});

const persistOptions: PersistOptions<StoreState, PersistedStoreState> = {
  name: UFH_STORE_STORAGE_KEY,
  storage: createJSONStorage(() => localStorage),
  partialize: partializeStoreState,
  merge: (persistedState, currentState) => mergePersistedStoreState(persistedState, currentState),
};

export const createUfhStore = () =>
  create<StoreState>()(persist<StoreState, [], [], PersistedStoreState>(createStoreState, persistOptions));

export const useStore = createUfhStore();
