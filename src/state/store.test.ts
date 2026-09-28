import { beforeEach, describe, expect, it } from 'vitest';
import type { Background, Zone } from '../types';
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_PX_PER_MM,
  createUfhStore,
  partializeStoreState,
  UFH_STORE_STORAGE_KEY,
} from './store';

const persistedImageBackground: Background = {
  kind: 'image',
  src: 'data:image/png;base64,abc123',
  naturalWidth: 640,
  naturalHeight: 320,
  x: 100,
  y: 200,
  mmPerPixel: 5,
};

const persistedZone: Zone = {
  id: 'zone-1',
  name: 'Zone 4',
  color: '#3498db',
  polygon: {
    points: [
      { x: 0, y: 0 },
      { x: 2000, y: 0 },
      { x: 2000, y: 2000 },
      { x: 0, y: 2000 },
    ],
  },
  spacingMm: 150,
  paddingMm: 100,
  connectionCorner: 'bottom-left',
  startDirection: 'vertical',
  spiral: null,
  spiralLengthMm: 0,
  leaderLengthMm: 0,
  areaMm2: 0,
  leaderWaypoints: null,
  manifoldPortOffsetMm: null,
};

describe('useStore persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('persists durable design state and clears transient state on reload', async () => {
    const store = createUfhStore();

    store.setState({
      background: persistedImageBackground,
      zones: [persistedZone],
      manifold: { position: { x: 400, y: 400 } },
      maxCircuitLengthM: 120,
      defaultSpacingMm: 200,
      pxPerMm: 0.5,
      stageX: 12,
      stageY: -8,
      selectedZoneId: 'zone-1',
      toolMode: 'drawZone',
      drawingPoints: [{ x: 25, y: 25 }],
      drawRectStart: { x: 5, y: 5 },
      calibration: {
        active: true,
        point1: { x: 0, y: 0 },
        point2: { x: 50, y: 0 },
      },
    });

    const serializedStore = window.localStorage.getItem(UFH_STORE_STORAGE_KEY);
    expect(serializedStore).toContain('zone-1');
    expect(serializedStore).toContain('polygon');
    expect(serializedStore).toContain('paddingMm');
    expect(serializedStore).toContain('connectionCorner');
    expect(serializedStore).not.toContain('spiralLengthM');
    expect(serializedStore).not.toContain('leaderLengthM');
    expect(serializedStore).not.toContain('areaM2');
    expect(serializedStore).not.toContain('"spiral"');

    const reloadedStore = createUfhStore();
    await reloadedStore.persist.rehydrate();

    const state = reloadedStore.getState();

    expect(state.background).toEqual(persistedImageBackground);
    expect(state.manifold).toEqual({ position: { x: 400, y: 400 }, rotationDeg: 0 });
    expect(state.maxCircuitLengthM).toBe(120);
    expect(state.defaultSpacingMm).toBe(200);
    // The view (zoom/pan) is intentionally not persisted — it isn't part of the design.
    expect(state.pxPerMm).toBe(DEFAULT_PX_PER_MM);
    expect(state.stageX).toBe(0);
    expect(state.stageY).toBe(0);

    expect(state.zones).toHaveLength(1);
    expect(state.zones[0].polygon.points).toEqual(persistedZone.polygon.points);
    expect(state.zones[0].connectionCorner).toBe('bottom-left');
    expect(state.zones[0].spiral).not.toBeNull();
    expect(state.zones[0].spiralLengthMm).toBeGreaterThan(0);
    expect(state.zones[0].areaMm2).toBeGreaterThan(0);

    expect(state.selectedZoneId).toBeNull();
    expect(state.toolMode).toBe('select');
    expect(state.drawingPoints).toEqual([]);
    expect(state.drawRectStart).toBeNull();
    expect(state.calibration).toEqual({ active: false, point1: null, point2: null });
  });

  it('continues auto zone numbering after a persisted restore', async () => {
    const store = createUfhStore();

    store.setState({
      zones: [{ ...persistedZone, name: 'Zone 7' }],
    });

    const reloadedStore = createUfhStore();
    await reloadedStore.persist.rehydrate();

    reloadedStore.getState().addDrawingPoint({ x: 0, y: 0 });
    reloadedStore.getState().addDrawingPoint({ x: 1000, y: 0 });
    reloadedStore.getState().addDrawingPoint({ x: 0, y: 1000 });
    reloadedStore.getState().closeZone();

    const zones = reloadedStore.getState().zones;
    expect(zones).toHaveLength(2);
    expect(zones[1].name).toBe('Zone 8');
  });

  it('can still hydrate older saved data that included computed zone fields', async () => {
    window.localStorage.setItem(
      UFH_STORE_STORAGE_KEY,
      JSON.stringify({
        state: {
              maxCircuitLengthM: 100,
          defaultSpacingMm: 150,
          background: null,
          zones: [
            {
              id: persistedZone.id,
              name: persistedZone.name,
              color: persistedZone.color,
              polygon: persistedZone.polygon,
              spacingMm: persistedZone.spacingMm,
              paddingMm: persistedZone.paddingMm,
              spiral: [{ x: 999, y: 999 }],
              spiralLengthMm: 999,
              leaderLengthMm: 999,
              areaMm2: 999,
            },
          ],
          manifold: { position: { x: 400, y: 400 } },
        },
        version: 0,
      }),
    );

    const reloadedStore = createUfhStore();
    await reloadedStore.persist.rehydrate();

    const [zone] = reloadedStore.getState().zones;
    expect(zone.polygon.points).toEqual(persistedZone.polygon.points);
    expect(zone.paddingMm).toBe(100);
    expect(zone.connectionCorner).toBe('bottom-left');
    expect(zone.spiral).not.toEqual([{ x: 999, y: 999 }]);
    expect(zone.spiralLengthMm).not.toBe(999);
    expect(zone.leaderLengthMm).not.toBe(999);
    expect(zone.areaMm2).not.toBe(999);
  });

  it('recomputes a zone when its padding changes', () => {
    const store = createUfhStore();

    store.setState({
      manifold: { position: { x: 400, y: 400 } },
      zones: [
        {
          ...persistedZone,
          spiral: null,
          spiralLengthMm: 0,
          leaderLengthMm: 0,
          areaMm2: 0,
        },
      ],
    });

    const before = store.getState().zones[0];
    store.getState().updateZonePadding(before.id, 200);
    const after = store.getState().zones[0];

    expect(after.paddingMm).toBe(200);
    expect(after.spiral).not.toBeNull();
    expect(after.spiralLengthMm).not.toBe(before.spiralLengthMm);
  });

  it('normalizes and persists manifold rotation', async () => {
    const store = createUfhStore();
    store.getState().setManifold({ x: 10, y: 20 });
    store.getState().setManifoldRotation(370);

    expect(store.getState().manifold).toEqual({ position: { x: 10, y: 20 }, rotationDeg: 10 });

    const reloadedStore = createUfhStore();
    await reloadedStore.persist.rehydrate();

    expect(reloadedStore.getState().manifold).toEqual({ position: { x: 10, y: 20 }, rotationDeg: 10 });
  });

  it('moves spiral start when connection corner changes', () => {
    const store = createUfhStore();

    store.setState({
      zones: [
        {
          ...persistedZone,
          spiral: null,
          spiralLengthMm: 0,
          leaderLengthMm: 0,
          areaMm2: 0,
        },
      ],
    });

    // Force a recompute from the current corner.
    store.getState().updateZoneConnectionCorner(persistedZone.id, 'bottom-left');
    const bottomLeftStart = store.getState().zones[0].spiral?.[0];

    store.getState().updateZoneConnectionCorner(persistedZone.id, 'top-right');
    const topRightStart = store.getState().zones[0].spiral?.[0];

    expect(bottomLeftStart).toBeDefined();
    expect(topRightStart).toBeDefined();
    expect(topRightStart!.x).toBeGreaterThan(bottomLeftStart!.x);
    expect(topRightStart!.y).toBeLessThan(bottomLeftStart!.y);
  });

  it('flips the spiral start axis while keeping the connection corner', () => {
    const store = createUfhStore();

    const squareZone: Zone = {
      id: 'zone-dir',
      name: 'Direction',
      color: '#3498db',
      polygon: {
        points: [
          { x: 0, y: 0 },
          { x: 4000, y: 0 },
          { x: 4000, y: 4000 },
          { x: 0, y: 4000 },
        ],
      },
      spacingMm: 400,
      paddingMm: 0,
      connectionCorner: 'bottom-left',
      startDirection: 'vertical',
      spiral: null,
      spiralLengthMm: 0,
      leaderLengthMm: 0,
      areaMm2: 0,
      leaderWaypoints: null,
      manifoldPortOffsetMm: null,
    };

    store.setState({ zones: [squareZone] });

    const firstLegAxis = (path: Array<{ x: number; y: number }>) =>
      Math.abs(path[1].x - path[0].x) > Math.abs(path[1].y - path[0].y) ? 'x' : 'y';

    store.getState().updateZoneStartDirection(squareZone.id, 'vertical');
    const verticalSpiral = store.getState().zones[0].spiral!;
    const verticalStart = verticalSpiral[0];
    const verticalEnd = verticalSpiral[verticalSpiral.length - 1];

    // Vertical start: first leg runs along Y, both stubs on the bottom edge.
    expect(firstLegAxis(verticalSpiral)).toBe('y');
    expect(verticalStart.y).toBeGreaterThan(3800);
    expect(verticalEnd.y).toBeGreaterThan(3800);

    store.getState().updateZoneStartDirection(squareZone.id, 'horizontal');
    const horizontalSpiral = store.getState().zones[0].spiral!;
    const horizontalStart = horizontalSpiral[0];
    const horizontalEnd = horizontalSpiral[horizontalSpiral.length - 1];

    // Horizontal start: first leg runs along X, both stubs on the left edge.
    expect(firstLegAxis(horizontalSpiral)).toBe('x');
    expect(horizontalStart.x).toBeLessThan(200);
    expect(horizontalEnd.x).toBeLessThan(200);

    // The connection stays anchored at the same (bottom-left) corner.
    expect(Math.abs(horizontalStart.x - verticalStart.x)).toBeLessThan(300);
    expect(Math.abs(horizontalStart.y - verticalStart.y)).toBeLessThan(300);
  });

  it('carries leader routing along when the manifold is moved or turned', () => {
    const store = createUfhStore();

    store.setState({
      manifold: { position: { x: 5000, y: 1000 }, rotationDeg: 90 },
      zones: [persistedZone],
    });
    store.getState().recomputeZoneSpiral(persistedZone.id);
    store.getState().startRouteZone(persistedZone.id);
    store.getState().addRoutePoint({ x: 3000, y: 1900 });
    store.getState().finishRouting({ x: 5000, y: 1000 });

    const routed = store.getState().zones[0];
    expect(routed.leaderWaypoints).not.toBeNull();
    const spiralBefore = routed.spiral;

    store.getState().updateManifoldPosition({ x: 7000, y: 2500 });

    const moved = store.getState().zones[0];
    // The drawn waypoints and the connection's place along the manifold are untouched;
    // the ports travel with the manifold, so the run between them simply re-aims.
    expect(moved.leaderWaypoints).toEqual(routed.leaderWaypoints);
    expect(moved.manifoldPortOffsetMm).toBe(routed.manifoldPortOffsetMm);
    // The spiral doesn't depend on where the manifold sits, only on the zone's own corner.
    expect(moved.spiral).toEqual(spiralBefore);
    // The leader is longer now that the manifold is further away.
    expect(moved.leaderLengthMm).toBeGreaterThan(routed.leaderLengthMm);

    store.getState().setManifoldRotation(180);
    expect(store.getState().zones[0].leaderWaypoints).toEqual(routed.leaderWaypoints);
    expect(store.getState().zones[0].manifoldPortOffsetMm).toBe(routed.manifoldPortOffsetMm);
  });

  it('calibrates the imported plan without touching the design', () => {
    const store = createUfhStore();
    const manifold = { position: { x: 5000, y: 1000 }, rotationDeg: 90 };

    store.setState({
      background: persistedImageBackground,
      manifold,
      zones: [persistedZone],
      pxPerMm: DEFAULT_PX_PER_MM,
    });
    store.getState().recomputeZoneSpiral(persistedZone.id);
    store.getState().startRouteZone(persistedZone.id);
    store.getState().addRoutePoint({ x: 3000, y: 1900 });
    store.getState().finishRouting({ x: 5000, y: 1000 });

    const before = store.getState().zones[0];
    expect(before.leaderWaypoints).not.toBeNull();

    // The user clicks a span the plan draws as 2 000 mm and says it is really 2 500.
    store.getState().startCalibration();
    store.getState().addCalibrationPoint({ x: 0, y: 0 });
    store.getState().addCalibrationPoint({ x: 2000, y: 0 });
    store.getState().finishCalibration(2500);

    const factor = 1.25;
    const state = store.getState();

    // The plan resizes about the first clicked point...
    expect(state.background).toMatchObject({
      x: 100 * factor,
      y: 200 * factor,
      mmPerPixel: 5 * factor,
    });

    // ...and nothing else does. Zones are authored in real millimetres already.
    expect(state.zones[0].polygon.points).toEqual(persistedZone.polygon.points);
    expect(state.zones[0].spacingMm).toBe(persistedZone.spacingMm);
    expect(state.zones[0].spiralLengthMm).toBe(before.spiralLengthMm);
    expect(state.zones[0].leaderWaypoints).toEqual(before.leaderWaypoints);
    expect(state.zones[0].manifoldPortOffsetMm).toBe(before.manifoldPortOffsetMm);
    expect(state.manifold).toEqual(manifold);
    // The view is left alone too — the plan visibly changes size, which is the point.
    expect(state.pxPerMm).toBe(DEFAULT_PX_PER_MM);
    expect(state.calibration.active).toBe(false);
  });

  it('gives calibration clicks priority over an unfinished polygon', () => {
    const store = createUfhStore();
    store.setState({
      background: persistedImageBackground,
      toolMode: 'drawZone',
      drawingPoints: [{ x: 100, y: 100 }],
    });

    store.getState().startCalibration();

    expect(store.getState().toolMode).toBe('select');
    expect(store.getState().drawingPoints).toEqual([]);
    expect(store.getState().calibration).toEqual({ active: true, point1: null, point2: null });
  });

  it('holds the first calibration point still while the plan resizes around it', () => {
    const store = createUfhStore();
    store.setState({ background: { ...persistedImageBackground, x: 1000, y: 0, mmPerPixel: 10 } });

    // Anchored on (1000, 0) — the plan's own left edge — so that edge must not move.
    store.getState().rescaleBackground(2, { x: 1000, y: 0 });

    expect(store.getState().background).toMatchObject({ x: 1000, y: 0, mmPerPixel: 20 });
  });

  it('leaves the design alone when there is no plan to calibrate', () => {
    const store = createUfhStore();
    store.setState({ background: null, zones: [persistedZone] });

    store.getState().rescaleBackground(2, { x: 0, y: 0 });

    expect(store.getState().background).toBeNull();
    expect(store.getState().zones[0].polygon.points).toEqual(persistedZone.polygon.points);
  });

  it('migrates a pixel-era project into millimetres on load', async () => {
    // 50 px/m means one pixel was 20 mm.
    window.localStorage.setItem(
      UFH_STORE_STORAGE_KEY,
      JSON.stringify({
        state: {
          pixelsPerMeter: 50,
          maxCircuitLengthM: 100,
          defaultSpacingMm: 150,
          background: {
            kind: 'image',
            src: 'data:image/png;base64,abc123',
            naturalWidth: 640,
            naturalHeight: 320,
            fitX: 10,
            fitY: 20,
            fitScale: 0.5,
          },
          zones: [
            {
              id: 'legacy',
              name: 'Legacy',
              color: '#3498db',
              spacingMm: 150,
              paddingMm: 100,
              polygon: {
                points: [
                  { x: 0, y: 0 },
                  { x: 100, y: 0 },
                  { x: 100, y: 100 },
                  { x: 0, y: 100 },
                ],
              },
              leaderWaypoints: [{ x: 120, y: 50 }],
              manifoldPortOffsetPx: 4,
            },
          ],
          manifold: { position: { x: 200, y: 50 } },
        },
        version: 0,
      }),
    );

    const store = createUfhStore();
    await store.persist.rehydrate();
    const state = store.getState();

    // Every stored coordinate comes back multiplied by the file's own mm-per-pixel.
    expect(state.zones[0].polygon.points[2]).toEqual({ x: 2000, y: 2000 });
    expect(state.zones[0].leaderWaypoints).toEqual([{ x: 2400, y: 1000 }]);
    expect(state.zones[0].manifoldPortOffsetMm).toBe(80);
    expect(state.manifold!.position).toEqual({ x: 4000, y: 1000 });
    expect(state.background).toMatchObject({ x: 200, y: 400, mmPerPixel: 10 });

    // ...and saving it again writes the current schema, with no pixel factor in sight.
    const saved = partializeStoreState(state);
    expect(saved.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(JSON.stringify(saved)).not.toContain('pixelsPerMeter');
  });
});
