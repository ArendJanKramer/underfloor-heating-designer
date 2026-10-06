import { useCallback, useEffect, useRef, useState } from 'react';
import Konva from 'konva';
import { Arrow, Circle, Layer, Line, Rect, Stage, Text } from 'react-konva';
import { useStore } from '../../state/store';
import { getSpiralStubs, roundPathCorners } from '../../geometry/spiral';
import { mm2ToSquareMeters } from '../../geometry/length';
import {
  leaderBendRadiusMm,
  leaderPairPitchMm,
  computeLeaderPreviewPath,
  getIncomingLegDirection,
  getStubExitDirection,
  midpoint,
  offsetPolyline,
  snapElbowPoint,
  snapFirstLegPoint,
} from '../../geometry/manualRouting';
import DxfLayer from './DxfLayer';
import ImageLayer from './ImageLayer';
import LeaderLayer from './LeaderLayer';
import ManifoldLayer from './ManifoldLayer';
import MeasureLayer from './MeasureLayer';
import ZoneLayer from './ZoneLayer';
import { canvas } from '../../theme';

const PANEL_WIDTH = 320;
const TOP_TOOLBAR_HEIGHT = 44;
const ZOOM_FACTOR = 1.15;

export default function Canvas() {
  const stageRef = useRef<Konva.Stage>(null);
  const [viewport, setViewport] = useState({
    width: Math.max(window.innerWidth - PANEL_WIDTH, 320),
    height: window.innerHeight - TOP_TOOLBAR_HEIGHT,
  });
  // Live mouse position for rect-zone preview (in stage/world coords)
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  // Where the pointer was on the last background-pan tick (world coords), so each move
  // applies only its own increment; null whenever no pan drag is in progress.
  const backgroundPanFromRef = useRef<{ x: number; y: number } | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const [stageDragging, setStageDragging] = useState(false);
  const [zoneCursor, setZoneCursor] = useState<string | null>(null);

  const {
    background,
    zones,
    selectedZoneId,
    manifold,
    toolMode,
    drawingPoints,
    drawRectStart,
    routing,
    calibration,
    measurement,
    pxPerMm,
    stageX,
    stageY,
    setManifold,
    addDrawingPoint,
    closeZone,
    startDrawRect,
    finishDrawRect,
    addRoutePoint,
    addCalibrationPoint,
    addMeasurePoint,
    setStageTransform,
    selectZone,
    setToolMode,
    moveBackground,
  } = useStore();

  useEffect(() => setZoneCursor(null), [toolMode, selectedZoneId]);

  useEffect(() => {
    const handleResize = () => {
      setViewport({
        width: Math.max(window.innerWidth - PANEL_WIDTH, 320),
        height: window.innerHeight - TOP_TOOLBAR_HEIGHT,
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"]'))
      ) return;
      event.preventDefault();
      backgroundPanFromRef.current = null;
      setSpacePressed(true);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        stageRef.current?.stopDrag();
        setSpacePressed(false);
        setStageDragging(false);
      }
    };
    const handleBlur = () => {
      stageRef.current?.stopDrag();
      setSpacePressed(false);
      setStageDragging(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  // While Space is held, let the Stage receive the pointer even over draggable shapes.
  useEffect(() => {
    if (!spacePressed) return;
    const layers = stageRef.current?.getLayers() ?? [];
    const listening = layers.map((layer) => layer.listening());
    layers.forEach((layer) => layer.listening(false));
    return () => layers.forEach((layer, index) => layer.listening(listening[index]));
  }, [spacePressed]);

  // The view isn't part of the design, so a reloaded project arrives with no camera. Frame
  // whatever it contains once, on mount, rather than dropping the user at a fixed zoom
  // where a drawing measured in metres of millimetres could sit far off-screen.
  const fitViewToContent = useStore((state) => state.fitViewToContent);
  useEffect(() => {
    fitViewToContent(viewport.width, viewport.height);
    // Deliberately mount-only: refitting on every change would fight the user's own panning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getPointerPos = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return null;

    const position = stage.getPointerPosition();
    if (!position) return null;

    return {
      // Screen pixels back to drawing millimetres — the only direction this conversion
      // ever runs outside the Konva transform itself.
      x: (position.x - stageX) / pxPerMm,
      y: (position.y - stageY) / pxPerMm,
    };
  }, [pxPerMm, stageX, stageY]);

  const handleStageClick = useCallback(() => {
    if (spacePressed) return;
    const position = getPointerPos();
    if (!position) return;

    if (toolMode === 'placeManifold') {
      setManifold(position);
      return;
    }

    if (toolMode === 'drawZone') {
      addDrawingPoint(position);
      setMousePos(position);
      return;
    }

    if (toolMode === 'drawRect') {
      if (!drawRectStart) {
        startDrawRect(position);
      } else {
        finishDrawRect(position);
        setMousePos(null);
      }
      return;
    }

    if (toolMode === 'routeLeader') {
      if (routing) {
        addRoutePoint(position);
      }
      return;
    }

    if (toolMode === 'measure') {
      addMeasurePoint(position);
      return;
    }

    if (calibration.active) {
      addCalibrationPoint(position);
      setMousePos(position);
      return;
    }

    // Clicked empty canvas: finalize any boundary edit and deselect.
    if (toolMode === 'select' || toolMode === 'editBoundary') {
      selectZone(null);
      if (toolMode === 'editBoundary') {
        setToolMode('select');
      }
    }
  }, [
    addCalibrationPoint,
    addDrawingPoint,
    addMeasurePoint,
    addRoutePoint,
    calibration.active,
    drawRectStart,
    finishDrawRect,
    getPointerPos,
    routing,
    selectZone,
    setManifold,
    setToolMode,
    spacePressed,
    startDrawRect,
    toolMode,
  ]);

  const handleStageDblClick = useCallback(() => {
    if (spacePressed) return;
    if (toolMode === 'drawZone') {
      closeZone();
    }
  }, [closeZone, spacePressed, toolMode]);

  // Background panning is a press-drag-release on the stage itself rather than a draggable
  // Konva node: a DXF's thin lines are near-impossible to grab, so the whole canvas is the
  // handle. Deltas are taken in world coords, so a pan tracks the pointer at any zoom.
  const handleMouseDown = useCallback(() => {
    if (spacePressed) return;
    if (toolMode !== 'panBackground' || !background) return;
    backgroundPanFromRef.current = getPointerPos();
  }, [background, getPointerPos, spacePressed, toolMode]);

  const endBackgroundPan = useCallback(() => {
    backgroundPanFromRef.current = null;
  }, []);

  const handleMouseMove = useCallback(() => {
    if (spacePressed) return;
    const panFrom = backgroundPanFromRef.current;
    if (panFrom) {
      const pos = getPointerPos();
      if (pos) {
        moveBackground(pos.x - panFrom.x, pos.y - panFrom.y);
        backgroundPanFromRef.current = pos;
      }
      return;
    }
    if (calibration.active && calibration.point1 && !calibration.point2) {
      setMousePos(getPointerPos());
      return;
    }
    if (toolMode === 'drawZone') {
      setMousePos(getPointerPos());
      return;
    }
    if (toolMode === 'drawRect' && drawRectStart) {
      const pos = getPointerPos();
      if (pos) setMousePos(pos);
      return;
    }
    if (toolMode === 'routeLeader' && routing) {
      const pos = getPointerPos();
      if (pos) setMousePos(pos);
      return;
    }
    // While the tape's far end is unplaced, follow the pointer so the reading is live.
    if (toolMode === 'measure' && measurement.start && !measurement.end) {
      const pos = getPointerPos();
      if (pos) setMousePos(pos);
    }
  }, [calibration, drawRectStart, getPointerPos, measurement, moveBackground, routing, spacePressed, toolMode]);

  const handleWheel = useCallback(
    (event: Konva.KonvaEventObject<WheelEvent>) => {
      event.evt.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;

      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const mousePointTo = {
        x: (pointer.x - stageX) / pxPerMm,
        y: (pointer.y - stageY) / pxPerMm,
      };

      const newScale =
        event.evt.deltaY > 0 ? pxPerMm / ZOOM_FACTOR : pxPerMm * ZOOM_FACTOR;

      setStageTransform(
        newScale,
        pointer.x - mousePointTo.x * newScale,
        pointer.y - mousePointTo.y * newScale,
      );
    },
    [setStageTransform, pxPerMm, stageX, stageY],
  );

  const drawingFlatPoints = drawingPoints.flatMap((point) => [point.x, point.y]);
  const lastDrawingPoint = drawingPoints[drawingPoints.length - 1];
  const calibrationPreviewEnd = calibration.point2 ?? (!spacePressed ? mousePos : null);

  const cursor = spacePressed
    ? stageDragging ? 'grabbing' : 'grab'
    : calibration.active ||
    toolMode === 'drawZone' ||
    toolMode === 'drawRect' ||
    toolMode === 'placeManifold' ||
    toolMode === 'routeLeader' ||
    toolMode === 'measure'
      ? 'crosshair'
      : toolMode === 'panBackground'
        ? 'grab'
        : zoneCursor ?? 'default';

  // Live preview of the leader path (rendered doubled) while routing.
  const routePreview = (() => {
    if (!routing || !mousePos) return null;
    const zone = zones.find((candidate) => candidate.id === routing.zoneId);
    if (!zone || !zone.spiral) return null;
    const stubs = getSpiralStubs(zone.spiral);
    if (!stubs) return null;

    const anchor = midpoint(stubs.start, stubs.end);
    const exitDir = getStubExitDirection(zone.spiral, 'start');
    const previewPoint =
      routing.points.length === 0
        ? snapFirstLegPoint(anchor, exitDir, mousePos)
        : snapElbowPoint(
            routing.points[routing.points.length - 1],
            mousePos,
            getIncomingLegDirection(exitDir, routing.points),
          );

    const drawn = computeLeaderPreviewPath(zone.spiral, [...routing.points, previewPoint]);
    if (!drawn) return null;

    // Filleted like the committed leader, so the preview shows the pipe that will be laid.
    const halfGapMm = leaderPairPitchMm(zone.spacingMm) / 2;
    const path = roundPathCorners(drawn, leaderBendRadiusMm(zone.spacingMm));

    return {
      path,
      lineA: offsetPolyline(path, halfGapMm),
      lineB: offsetPolyline(path, -halfGapMm),
      color: zone.color,
    };
  })();

  // Rectangle preview while in drawRect mode
  const rectPreview =
    toolMode === 'drawRect' && drawRectStart && mousePos
      ? {
          x: Math.min(drawRectStart.x, mousePos.x),
          y: Math.min(drawRectStart.y, mousePos.y),
          width: Math.abs(mousePos.x - drawRectStart.x),
          height: Math.abs(mousePos.y - drawRectStart.y),
        }
      : null;

  const rectPreviewAreaM2 = rectPreview
    ? mm2ToSquareMeters(rectPreview.width * rectPreview.height)
    : null;

  return (
    <Stage
      ref={stageRef}
      width={viewport.width}
      height={viewport.height}
      onClick={handleStageClick}
      onDblClick={handleStageDblClick}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={endBackgroundPan}
      onMouseLeave={() => {
        endBackgroundPan();
        setMousePos(null);
        setZoneCursor(null);
      }}
      onWheel={handleWheel}
      draggable={spacePressed}
      x={stageX}
      y={stageY}
      scaleX={pxPerMm}
      scaleY={pxPerMm}
      onDragStart={(event) => {
        if (event.target === stageRef.current) setStageDragging(true);
      }}
      onDragEnd={(event) => {
        // Dragend bubbles up from any draggable descendant (vertex handles,
        // the manifold, ...) with event.target left as that node — only
        // react when the Stage itself was the thing being dragged (panning).
        if (event.target !== stageRef.current) return;
        setStageDragging(false);
        setStageTransform(pxPerMm, event.target.x(), event.target.y());
      }}
      style={{ cursor, background: canvas.background }}
    >
      {/* Background layer */}
      {background?.kind === 'dxf' && (
        <DxfLayer entities={background.entities} transform={background.transform} />
      )}
      {background?.kind === 'image' && (
        <ImageLayer
          src={background.src}
          x={background.x}
          y={background.y}
          mmPerPixel={background.mmPerPixel}
          naturalWidth={background.naturalWidth}
          naturalHeight={background.naturalHeight}
        />
      )}

      <ZoneLayer
        zones={zones}
        selectedZoneId={selectedZoneId}
        toolMode={toolMode}
        pxPerMm={pxPerMm}
        onCursorChange={setZoneCursor}
      />
      <LeaderLayer zones={zones} manifold={manifold} pxPerMm={pxPerMm} />
      <ManifoldLayer manifold={manifold} zones={zones} pxPerMm={pxPerMm} />
      <MeasureLayer measurement={measurement} pointer={mousePos} pxPerMm={pxPerMm} />

      <Layer>
        {/* Free-polygon drawing preview */}
        {toolMode === 'drawZone' && drawingPoints.length > 0 && (
          <>
            <Line
              points={drawingFlatPoints}
              stroke={canvas.drawPreview}
              strokeWidth={3}
              strokeScaleEnabled={false}
              listening={false}
            />
            {mousePos && !spacePressed && (
              <Line
                points={[lastDrawingPoint.x, lastDrawingPoint.y, mousePos.x, mousePos.y]}
                stroke={canvas.drawPreview}
                strokeWidth={3}
                strokeScaleEnabled={false}
                dash={[8, 5]}
                listening={false}
              />
            )}
            {drawingPoints.map((point, index) => (
              <Circle
                key={index}
                x={point.x}
                y={point.y}
                radius={7 / pxPerMm}
                fill={canvas.drawPreview}
                stroke={canvas.vertexFill}
                strokeWidth={2}
                strokeScaleEnabled={false}
                listening={false}
              />
            ))}
          </>
        )}

        {/* Manual leader-routing preview: the single drawn path, rendered doubled */}
        {routePreview && (
          <>
            <Arrow
              points={routePreview.lineA.flatMap((point) => [point.x, point.y])}
              stroke={routePreview.color}
              strokeWidth={2}
              fill={routePreview.color}
              pointerLength={8}
              pointerWidth={6}
              opacity={0.9}
              dash={[6, 3]}
              listening={false}
            />
            <Arrow
              points={routePreview.lineB.flatMap((point) => [point.x, point.y])}
              stroke={routePreview.color}
              strokeWidth={2}
              fill={routePreview.color}
              pointerLength={8}
              pointerWidth={6}
              opacity={0.5}
              dash={[3, 3]}
              listening={false}
            />
            {routePreview.path.slice(0, -1).map((point, index) => (
              <Circle key={index} x={point.x} y={point.y} radius={3} fill={routePreview.color} listening={false} />
            ))}
          </>
        )}

        {/* Rectangle drawing preview */}
        {drawRectStart && (
          <Circle x={drawRectStart.x} y={drawRectStart.y} radius={5} fill={canvas.drawPreview} listening={false} />
        )}
        {rectPreview && (
          <>
            <Rect
              x={rectPreview.x}
              y={rectPreview.y}
              width={rectPreview.width}
              height={rectPreview.height}
              stroke={canvas.drawPreview}
              strokeWidth={2}
              dash={[6, 3]}
              fill="rgba(243,156,18,0.1)"
              listening={false}
            />
            {rectPreviewAreaM2 !== null && (
              <Text
                x={rectPreview.x + 6}
                y={rectPreview.y + 6}
                text={`Area: ${rectPreviewAreaM2.toFixed(2)} m²`}
                fill={canvas.drawPreview}
                fontSize={14}
                fontStyle="bold"
                listening={false}
              />
            )}
          </>
        )}

        {/* Calibration overlay */}
        {calibration.active && calibration.point1 && (
          <Circle
            x={calibration.point1.x}
            y={calibration.point1.y}
            radius={7 / pxPerMm}
            fill={canvas.calibration}
            stroke={canvas.vertexFill}
            strokeWidth={2}
            strokeScaleEnabled={false}
            listening={false}
          />
        )}
        {calibration.active && calibration.point2 && (
          <Circle
            x={calibration.point2.x}
            y={calibration.point2.y}
            radius={7 / pxPerMm}
            fill={canvas.calibration}
            stroke={canvas.vertexFill}
            strokeWidth={2}
            strokeScaleEnabled={false}
            listening={false}
          />
        )}
        {calibration.active && calibration.point1 && calibrationPreviewEnd && (
          <Line
            points={[
              calibration.point1.x,
              calibration.point1.y,
              calibrationPreviewEnd.x,
              calibrationPreviewEnd.y,
            ]}
            stroke={canvas.calibration}
            strokeWidth={3}
            strokeScaleEnabled={false}
            dash={[8, 5]}
            listening={false}
          />
        )}
      </Layer>
    </Stage>
  );
}
