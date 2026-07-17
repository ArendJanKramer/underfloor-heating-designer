import { create } from 'zustand';
import { Background, CalibrationState, Manifold, Point, ToolMode, Zone } from '../types';
import { generateSerpentine, getSpiralStubs } from '../geometry/spiral';
import { leaderLengthPx, pathLengthPx, pxToMeters } from '../geometry/length';
import { polygonArea } from '../geometry/offset';

const ZONE_COLORS = [
  '#e74c3c',
  '#3498db',
  '#2ecc71',
  '#f39c12',
  '#9b59b6',
  '#1abc9c',
  '#e67e22',
  '#34495e',
  '#e91e63',
  '#00bcd4',
];

interface StoreState {
  pixelsPerMeter: number;
  maxCircuitLengthM: number;
  defaultSpacingMm: number;
  /** Discriminated-union background layer (DXF or raster image, or null) */
  background: Background | null;
  zones: Zone[];
  selectedZoneId: string | null;
  manifold: Manifold | null;
  toolMode: ToolMode;
  drawingPoints: Point[];
  /** First corner for rectangle-zone drawing */
  drawRectStart: Point | null;
  calibration: CalibrationState;
  stageScale: number;
  stageX: number;
  stageY: number;

  setBackground: (bg: Background | null) => void;
  setToolMode: (mode: ToolMode) => void;
  setManifold: (pos: Point) => void;
  updateManifoldPosition: (pos: Point) => void;
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
  updateZoneName: (id: string, name: string) => void;
  updateZoneVertex: (zoneId: string, vertexIdx: number, pt: Point) => void;
  setPixelsPerMeter: (ppm: number) => void;
  setMaxCircuitLength: (m: number) => void;
  setDefaultSpacing: (mm: number) => void;
  startCalibration: () => void;
  addCalibrationPoint: (pt: Point) => void;
  finishCalibration: (realDistanceM: number) => void;
  cancelCalibration: () => void;
  setStageTransform: (scale: number, x: number, y: number) => void;
  recomputeZoneSpiral: (zoneId: string) => void;
}

let zoneCounter = 1;

function recomputeSpiral(
  zone: Zone,
  manifold: Manifold | null,
  pixelsPerMeter: number,
): Zone {
  const spacingPx = (zone.spacingMm / 1000) * pixelsPerMeter;
  const hint = manifold?.position;
  const spiral = generateSerpentine(zone.polygon, spacingPx, hint);
  const spiralLengthPx = pathLengthPx(spiral);
  const spiralLengthM = pxToMeters(spiralLengthPx, pixelsPerMeter);
  const areaPx = polygonArea(zone.polygon.points);
  const areaM2 = pixelsPerMeter > 0 ? areaPx / (pixelsPerMeter * pixelsPerMeter) : 0;

  let leaderLengthM = 0;
  if (manifold && spiral.length > 0) {
    const stubs = getSpiralStubs(spiral);
    if (stubs) {
      const leaderLength =
        leaderLengthPx(stubs.start, manifold.position) +
        leaderLengthPx(stubs.end, manifold.position);
      leaderLengthM = pxToMeters(leaderLength, pixelsPerMeter);
    }
  }

  return { ...zone, spiral, spiralLengthM, leaderLengthM, areaM2 };
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

export const useStore = create<StoreState>((set, get) => ({
  pixelsPerMeter: 100,
  maxCircuitLengthM: 100,
  defaultSpacingMm: 150,
  background: null,
  zones: [],
  selectedZoneId: null,
  manifold: null,
  toolMode: 'select',
  drawingPoints: [],
  drawRectStart: null,
  calibration: { active: false, point1: null, point2: null },
  stageScale: 1,
  stageX: 0,
  stageY: 0,

  setBackground: (bg) => set({ background: bg }),

  setToolMode: (mode) => set({ toolMode: mode, drawingPoints: [], drawRectStart: null }),

  setManifold: (pos) => {
    set({ manifold: { position: pos }, toolMode: 'select' });
    const { zones, pixelsPerMeter } = get();
    const updated = zones.map((zone) => recomputeSpiral(zone, { position: pos }, pixelsPerMeter));
    set({ zones: updated });
  },

  updateManifoldPosition: (pos) => {
    set({ manifold: { position: pos } });
    const { zones, pixelsPerMeter } = get();
    const updated = zones.map((zone) => recomputeSpiral(zone, { position: pos }, pixelsPerMeter));
    set({ zones: updated });
  },

  addDrawingPoint: (pt) => set((state) => ({ drawingPoints: [...state.drawingPoints, pt] })),

  closeZone: () => {
    const { drawingPoints, zones, manifold, pixelsPerMeter, defaultSpacingMm } = get();
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
      spiral: null,
      spiralLengthM: 0,
      leaderLengthM: 0,
      areaM2: 0,
    };

    const computed = recomputeSpiral(newZone, manifold, pixelsPerMeter);
    set({
      zones: [...zones, computed],
      drawingPoints: [],
      toolMode: 'select',
      selectedZoneId: id,
    });
  },

  cancelDrawing: () => set({ drawingPoints: [], toolMode: 'select' }),

  startDrawRect: (pt) => set({ drawRectStart: pt }),

  finishDrawRect: (pt) => {
    const { drawRectStart, zones, manifold, pixelsPerMeter, defaultSpacingMm } = get();
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
      spiral: null,
      spiralLengthM: 0,
      leaderLengthM: 0,
      areaM2: 0,
    };

    const computed = recomputeSpiral(newZone, manifold, pixelsPerMeter);
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
    const { zones, manifold, pixelsPerMeter } = get();
    const updated = zones.map((zone) =>
      zone.id === id ? recomputeSpiral({ ...zone, spacingMm }, manifold, pixelsPerMeter) : zone,
    );
    set({ zones: updated });
  },

  updateZoneName: (id, name) =>
    set((state) => ({
      zones: state.zones.map((zone) => (zone.id === id ? { ...zone, name } : zone)),
    })),

  updateZoneVertex: (zoneId, vertexIdx, pt) => {
    const { zones, manifold, pixelsPerMeter } = get();
    const updated = zones.map((zone) => {
      if (zone.id !== zoneId) return zone;
      const points = [...zone.polygon.points];
      points[vertexIdx] = pt;
      return recomputeSpiral({ ...zone, polygon: { points } }, manifold, pixelsPerMeter);
    });
    set({ zones: updated });
  },

  setPixelsPerMeter: (ppm) => {
    set({ pixelsPerMeter: ppm });
    const { zones, manifold } = get();
    const updated = zones.map((zone) => recomputeSpiral(zone, manifold, ppm));
    set({ zones: updated });
  },

  setMaxCircuitLength: (m) => set({ maxCircuitLengthM: m }),

  setDefaultSpacing: (mm) => set({ defaultSpacingMm: mm }),

  startCalibration: () => set({ calibration: { active: true, point1: null, point2: null } }),

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

  finishCalibration: (realDistanceM) => {
    const { calibration } = get();
    if (!calibration.point1 || !calibration.point2) return;

    const dx = calibration.point2.x - calibration.point1.x;
    const dy = calibration.point2.y - calibration.point1.y;
    const pixelDist = Math.sqrt(dx * dx + dy * dy);
    if (pixelDist > 0 && realDistanceM > 0) {
      get().setPixelsPerMeter(pixelDist / realDistanceM);
    }

    set({ calibration: { active: false, point1: null, point2: null } });
  },

  cancelCalibration: () => set({ calibration: { active: false, point1: null, point2: null } }),

  setStageTransform: (scale, x, y) => set({ stageScale: scale, stageX: x, stageY: y }),

  recomputeZoneSpiral: (zoneId) => {
    const { zones, manifold, pixelsPerMeter } = get();
    const updated = zones.map((zone) =>
      zone.id === zoneId ? recomputeSpiral(zone, manifold, pixelsPerMeter) : zone,
    );
    set({ zones: updated });
  },
}));
