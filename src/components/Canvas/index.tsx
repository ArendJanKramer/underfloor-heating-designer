import { useCallback, useEffect, useRef, useState } from 'react';
import Konva from 'konva';
import { Circle, Layer, Line, Rect, Stage, Text } from 'react-konva';
import { useStore } from '../../state/store';
import DxfLayer from './DxfLayer';
import ImageLayer from './ImageLayer';
import LeaderLayer from './LeaderLayer';
import ManifoldLayer from './ManifoldLayer';
import ZoneLayer from './ZoneLayer';

const PANEL_WIDTH = 320;
const ZOOM_FACTOR = 1.15;

export default function Canvas() {
  const stageRef = useRef<Konva.Stage>(null);
  const [viewport, setViewport] = useState({
    width: Math.max(window.innerWidth - PANEL_WIDTH, 320),
    height: window.innerHeight,
  });
  // Live mouse position for rect-zone preview (in stage/world coords)
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  const {
    background,
    zones,
    selectedZoneId,
    manifold,
    toolMode,
    drawingPoints,
    drawRectStart,
    calibration,
    pixelsPerMeter,
    stageScale,
    stageX,
    stageY,
    setManifold,
    addDrawingPoint,
    closeZone,
    startDrawRect,
    finishDrawRect,
    addCalibrationPoint,
    setStageTransform,
  } = useStore();

  useEffect(() => {
    const handleResize = () => {
      setViewport({
        width: Math.max(window.innerWidth - PANEL_WIDTH, 320),
        height: window.innerHeight,
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const getPointerPos = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return null;

    const position = stage.getPointerPosition();
    if (!position) return null;

    return {
      x: (position.x - stageX) / stageScale,
      y: (position.y - stageY) / stageScale,
    };
  }, [stageScale, stageX, stageY]);

  const handleStageClick = useCallback(() => {
    const position = getPointerPos();
    if (!position) return;

    if (toolMode === 'placeManifold') {
      setManifold(position);
      return;
    }

    if (toolMode === 'drawZone') {
      addDrawingPoint(position);
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

    if (calibration.active) {
      addCalibrationPoint(position);
    }
  }, [
    addCalibrationPoint,
    addDrawingPoint,
    calibration.active,
    drawRectStart,
    finishDrawRect,
    getPointerPos,
    setManifold,
    startDrawRect,
    toolMode,
  ]);

  const handleStageDblClick = useCallback(() => {
    if (toolMode === 'drawZone') {
      closeZone();
    }
  }, [closeZone, toolMode]);

  const handleMouseMove = useCallback(() => {
    if (toolMode !== 'drawRect' || !drawRectStart) return;
    const pos = getPointerPos();
    if (pos) setMousePos(pos);
  }, [drawRectStart, getPointerPos, toolMode]);

  const handleWheel = useCallback(
    (event: Konva.KonvaEventObject<WheelEvent>) => {
      event.evt.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;

      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const mousePointTo = {
        x: (pointer.x - stageX) / stageScale,
        y: (pointer.y - stageY) / stageScale,
      };

      const newScale =
        event.evt.deltaY > 0 ? stageScale / ZOOM_FACTOR : stageScale * ZOOM_FACTOR;

      setStageTransform(
        newScale,
        pointer.x - mousePointTo.x * newScale,
        pointer.y - mousePointTo.y * newScale,
      );
    },
    [setStageTransform, stageScale, stageX, stageY],
  );

  const drawingFlatPoints = drawingPoints.flatMap((point) => [point.x, point.y]);

  const cursor =
    calibration.active ||
    toolMode === 'drawZone' ||
    toolMode === 'drawRect' ||
    toolMode === 'placeManifold'
      ? 'crosshair'
      : 'default';

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

  const rectPreviewAreaM2 =
    rectPreview && pixelsPerMeter > 0
      ? (rectPreview.width * rectPreview.height) / (pixelsPerMeter * pixelsPerMeter)
      : null;

  return (
    <Stage
      ref={stageRef}
      width={viewport.width}
      height={viewport.height}
      onClick={handleStageClick}
      onDblClick={handleStageDblClick}
      onMouseMove={handleMouseMove}
      onWheel={handleWheel}
      draggable={toolMode === 'select' && !calibration.active}
      x={stageX}
      y={stageY}
      scaleX={stageScale}
      scaleY={stageScale}
      onDragEnd={(event) => {
        setStageTransform(stageScale, event.target.x(), event.target.y());
      }}
      style={{ cursor, background: '#1a1a2e' }}
    >
      {/* Background layer */}
      {background?.kind === 'dxf' && (
        <DxfLayer entities={background.entities} transform={background.transform} />
      )}
      {background?.kind === 'image' && (
        <ImageLayer
          src={background.src}
          fitX={background.fitX}
          fitY={background.fitY}
          fitScale={background.fitScale}
          naturalWidth={background.naturalWidth}
          naturalHeight={background.naturalHeight}
        />
      )}

      <ZoneLayer zones={zones} selectedZoneId={selectedZoneId} toolMode={toolMode} />
      <LeaderLayer zones={zones} manifold={manifold} />
      <ManifoldLayer manifold={manifold} />

      <Layer>
        {/* Free-polygon drawing preview */}
        {toolMode === 'drawZone' && drawingPoints.length > 0 && (
          <>
            <Line
              points={drawingFlatPoints}
              stroke="#f39c12"
              strokeWidth={2}
              dash={[5, 3]}
              listening={false}
            />
            {drawingPoints.map((point, index) => (
              <Circle
                key={index}
                x={point.x}
                y={point.y}
                radius={4}
                fill="#f39c12"
                listening={false}
              />
            ))}
          </>
        )}

        {/* Rectangle drawing preview */}
        {drawRectStart && (
          <Circle x={drawRectStart.x} y={drawRectStart.y} radius={5} fill="#f39c12" listening={false} />
        )}
        {rectPreview && (
          <>
            <Rect
              x={rectPreview.x}
              y={rectPreview.y}
              width={rectPreview.width}
              height={rectPreview.height}
              stroke="#f39c12"
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
                fill="#f39c12"
                fontSize={14}
                fontStyle="bold"
                listening={false}
              />
            )}
          </>
        )}

        {/* Calibration overlay */}
        {calibration.active && calibration.point1 && (
          <Circle x={calibration.point1.x} y={calibration.point1.y} radius={5} fill="#e74c3c" />
        )}
        {calibration.active && calibration.point2 && (
          <Circle x={calibration.point2.x} y={calibration.point2.y} radius={5} fill="#e74c3c" />
        )}
        {calibration.active && calibration.point1 && calibration.point2 && (
          <Line
            points={[
              calibration.point1.x,
              calibration.point1.y,
              calibration.point2.x,
              calibration.point2.y,
            ]}
            stroke="#e74c3c"
            strokeWidth={2}
            dash={[5, 3]}
          />
        )}
      </Layer>
    </Stage>
  );
}
