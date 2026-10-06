import { memo, useCallback, useEffect, useRef, useState } from 'react';
import Konva from 'konva';
import { Circle, Group, Layer, Line } from 'react-konva';
import { Point, ToolMode, Zone } from '../../types';
import { useStore } from '../../state/store';
import { getSpiralStubs } from '../../geometry/spiral';
import { constrainRectCornerToAspect, isAxisAlignedRect, resizeRectFromCorner } from '../../geometry/rect';
import { scalePolygonFromVertex } from '../../geometry/polygonScale';
import { canvas, palette } from '../../theme';

const SELECTED_DASH = [6, 6];
const DASH_PERIOD = SELECTED_DASH.reduce((sum, value) => sum + value, 0);

function mixHexColors(color: string, target: string, amount: number): string {
  const normalized = color.replace('#', '');
  const normalizedTarget = target.replace('#', '');

  if (normalized.length !== 6 || normalizedTarget.length !== 6) {
    return color;
  }

  const factor = Math.max(0, Math.min(1, amount));
  const channels = [0, 2, 4].map((index) => {
    const sourceChannel = Number.parseInt(normalized.slice(index, index + 2), 16);
    const targetChannel = Number.parseInt(normalizedTarget.slice(index, index + 2), 16);

    if (Number.isNaN(sourceChannel) || Number.isNaN(targetChannel)) {
      return '00';
    }

    return Math.round(sourceChannel + (targetChannel - sourceChannel) * factor)
      .toString(16)
      .padStart(2, '0');
  });

  return `#${channels.join('')}`;
}

interface Props {
  zones: Zone[];
  selectedZoneId: string | null;
  toolMode: ToolMode;
  /** Screen pixels per millimetre — handles are sized in screen terms, not drawing ones. */
  pxPerMm: number;
  onCursorChange: (cursor: string | null) => void;
}

const VERTEX_HANDLE_RADIUS_PX = 6;
const STUB_DOT_RADIUS_PX = 4;

interface ActiveVertexDrag {
  node: Konva.Node;
  zoneId: string;
  vertexIndex: number;
  originalPoints: Point[];
  pointer: Point;
  shiftPressed: boolean;
}

function ZoneLayer({ zones, selectedZoneId, toolMode, pxPerMm, onCursorChange }: Props) {
  const updateZoneVertex = useStore((state) => state.updateZoneVertex);
  const updateZonePolygon = useStore((state) => state.updateZonePolygon);
  const moveZone = useStore((state) => state.moveZone);
  const selectZone = useStore((state) => state.selectZone);
  const setToolMode = useStore((state) => state.setToolMode);
  const startRouteZone = useStore((state) => state.startRouteZone);
  const routing = useStore((state) => state.routing);
  const selectedLineRefWhite = useRef<Konva.Line | null>(null);
  const selectedLineRefBlack = useRef<Konva.Line | null>(null);
  const activeVertexDragRef = useRef<ActiveVertexDrag | null>(null);
  const hoveredPolygonVertexRef = useRef(false);
  const [dragPreview, setDragPreview] = useState<{ zoneId: string; points: Point[] } | null>(null);

  const previewVertexDrag = useCallback((drag: ActiveVertexDrag) => {
    const isRect = isAxisAlignedRect(drag.originalPoints);
    const points = isRect
      ? resizeRectFromCorner(
          drag.originalPoints,
          drag.vertexIndex,
          drag.shiftPressed
            ? constrainRectCornerToAspect(drag.originalPoints, drag.vertexIndex, drag.pointer)
            : drag.pointer,
        )
      : drag.shiftPressed
        ? scalePolygonFromVertex(drag.originalPoints, drag.vertexIndex, drag.pointer)
        : drag.originalPoints.map((point, index) =>
            index === drag.vertexIndex ? drag.pointer : point,
          );
    drag.node.position(points[drag.vertexIndex]);
    setDragPreview({ zoneId: drag.zoneId, points });
  }, []);

  useEffect(() => {
    const updateShift = (pressed: boolean) => {
      const drag = activeVertexDragRef.current;
      if (!drag) {
        if (hoveredPolygonVertexRef.current) onCursorChange(pressed ? 'nwse-resize' : 'move');
        return;
      }
      if (drag.shiftPressed === pressed) return;
      drag.shiftPressed = pressed;
      previewVertexDrag(drag);
      if (!isAxisAlignedRect(drag.originalPoints)) {
        onCursorChange(pressed ? 'nwse-resize' : 'move');
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') updateShift(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') updateShift(event.shiftKey);
    };
    const onBlur = () => updateShift(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [onCursorChange, previewVertexDrag]);

  useEffect(() => {
    const whiteNode = selectedLineRefWhite.current;
    const blackNode = selectedLineRefBlack.current;
    if (!whiteNode || !blackNode) return;

    const anim = new Konva.Animation((frame) => {
      if (!frame) return;
      const offset = -(frame.time / 30) % DASH_PERIOD;
      whiteNode.dashOffset(offset);
      blackNode.dashOffset(offset + DASH_PERIOD / 2);
    }, whiteNode.getLayer());
    anim.start();

    return () => {
      anim.stop();
    };
  }, [selectedZoneId]);

  const vertexHandleRadiusMm = VERTEX_HANDLE_RADIUS_PX / pxPerMm;
  const stubDotRadiusMm = STUB_DOT_RADIUS_PX / pxPerMm;
  // Konva hit testing uses draw order. Put the active zone and its handles last,
  // so another zone cannot cover a corner while the user edits it.
  const orderedZones = [
    ...zones.filter((zone) => zone.id !== selectedZoneId),
    ...zones.filter((zone) => zone.id === selectedZoneId),
  ];

  return (
    <Layer>
      {orderedZones.map((zone) => {
        const isSelected = zone.id === selectedZoneId;
        const displayPoints =
          dragPreview && dragPreview.zoneId === zone.id ? dragPreview.points : zone.polygon.points;
        const points = displayPoints.flatMap((point) => [point.x, point.y]);
        const zoneBorderColor = mixHexColors(zone.color, palette.slate900, 0.18);
        const isRect = isAxisAlignedRect(zone.polygon.points);

        return (
          <Group
            key={zone.id}
            draggable={isSelected && (toolMode === 'select' || toolMode === 'editBoundary')}
            onDragStart={(event) => {
              if (event.target === event.currentTarget) onCursorChange('grabbing');
            }}
            onDragEnd={(event) => {
              if (event.target !== event.currentTarget) return;
              event.cancelBubble = true;
              const delta = { x: event.target.x(), y: event.target.y() };
              event.target.position({ x: 0, y: 0 });
              if (delta.x !== 0 || delta.y !== 0) moveZone(zone.id, delta);
              onCursorChange('grab');
            }}
          >
            <Line
              points={points}
              closed
              // Transparent (not undefined) when unselected, so the zone stays clickable —
              // an undefined fill/stroke would drop it out of Konva's hit detection.
              fill={isSelected ? `${zone.color}33` : 'transparent'}
              onMouseEnter={() => {
                if (toolMode === 'select' || toolMode === 'editBoundary') {
                  onCursorChange(isSelected ? 'grab' : 'pointer');
                }
              }}
              onMouseLeave={() => onCursorChange(null)}
              onClick={(event) => {
                if (toolMode === 'routeLeader') {
                  if (!routing) {
                    startRouteZone(zone.id);
                    event.cancelBubble = true;
                  }
                  // While a leg is already in progress, let the click bubble to
                  // the Stage so it's treated as a normal elbow point.
                  return;
                }
                selectZone(zone.id);
                if (toolMode === 'select' || toolMode === 'editBoundary') {
                  // Keep this click from also reaching the Stage's "clicked empty
                  // space" deselect handler.
                  event.cancelBubble = true;
                }
              }}
              onDblClick={(event) => {
                if (toolMode !== 'select' && toolMode !== 'editBoundary') return;
                event.cancelBubble = true;
                selectZone(zone.id);
                setToolMode('editBoundary');
              }}
              onTap={() => selectZone(zone.id)}
            />

            {isSelected && (
              <>
                <Line
                  ref={selectedLineRefWhite}
                  points={points}
                  closed
                  stroke={canvas.selectionDashAlt}
                  strokeWidth={2.5}
                  strokeScaleEnabled={false}
                  dash={SELECTED_DASH}
                  listening={false}
                />
                <Line
                  ref={selectedLineRefBlack}
                  points={points}
                  closed
                  stroke={canvas.selectionDash}
                  strokeWidth={2.5}
                  strokeScaleEnabled={false}
                  dash={SELECTED_DASH}
                  listening={false}
                />
              </>
            )}

            {zone.spiral && zone.spiral.length > 1 && (
              <Line
                points={zone.spiral.flatMap((point) => [point.x, point.y])}
                stroke={zone.color}
                strokeWidth={1.5}
                strokeScaleEnabled={false}
                opacity={0.85}
                listening={false}
              />
            )}

            {toolMode === 'routeLeader' &&
              zone.spiral &&
              zone.spiral.length > 1 &&
              (() => {
                const stubs = getSpiralStubs(zone.spiral);
                if (!stubs) return null;
                return (
                  <>
                    <Circle
                      x={stubs.start.x}
                      y={stubs.start.y}
                      radius={stubDotRadiusMm}
                      fill={zone.leaderWaypoints ? canvas.stubRouted : canvas.stubUnrouted}
                      stroke={canvas.stubOutline}
                      strokeWidth={1}
                      strokeScaleEnabled={false}
                      listening={false}
                    />
                    <Circle
                      x={stubs.end.x}
                      y={stubs.end.y}
                      radius={stubDotRadiusMm}
                      fill={zone.leaderWaypoints ? canvas.stubRouted : canvas.stubUnrouted}
                      stroke={canvas.stubOutline}
                      strokeWidth={1}
                      strokeScaleEnabled={false}
                      listening={false}
                    />
                  </>
                );
              })()}

            {isSelected &&
              toolMode === 'editBoundary' &&
              displayPoints.map((point, vertexIndex) => (
                <Circle
                  key={vertexIndex}
                  x={point.x}
                  y={point.y}
                  radius={vertexHandleRadiusMm}
                  fill={canvas.vertexFill}
                  stroke={zoneBorderColor}
                  strokeWidth={2}
                  strokeScaleEnabled={false}
                  draggable
                  onMouseEnter={(event) => {
                    if (!isRect) {
                      hoveredPolygonVertexRef.current = true;
                      onCursorChange(event.evt.shiftKey ? 'nwse-resize' : 'move');
                      return;
                    }
                    const opposite = displayPoints[(vertexIndex + 2) % 4];
                    onCursorChange((point.x - opposite.x) * (point.y - opposite.y) >= 0
                      ? 'nwse-resize'
                      : 'nesw-resize');
                  }}
                  onMouseLeave={() => {
                    hoveredPolygonVertexRef.current = false;
                    onCursorChange(null);
                  }}
                  onClick={(event) => {
                    event.cancelBubble = true;
                  }}
                  onDragStart={(event) => {
                    activeVertexDragRef.current = {
                      node: event.target,
                      zoneId: zone.id,
                      vertexIndex,
                      originalPoints: zone.polygon.points,
                      pointer: { x: event.target.x(), y: event.target.y() },
                      shiftPressed: event.evt.shiftKey,
                    };
                  }}
                  onDragMove={(event) => {
                    const drag = activeVertexDragRef.current;
                    if (!drag) return;
                    drag.pointer = { x: event.target.x(), y: event.target.y() };
                    drag.shiftPressed = event.evt.shiftKey;
                    previewVertexDrag(drag);
                  }}
                  onDragEnd={(event) => {
                    event.cancelBubble = true;
                    const drag = activeVertexDragRef.current;
                    activeVertexDragRef.current = null;
                    if (drag?.shiftPressed && !isRect) {
                      updateZonePolygon(zone.id, scalePolygonFromVertex(
                        drag.originalPoints, vertexIndex, drag.pointer,
                      ));
                    } else {
                      const pos = drag?.shiftPressed && isRect
                        ? constrainRectCornerToAspect(drag.originalPoints, vertexIndex, drag.pointer)
                        : drag?.pointer ?? { x: event.target.x(), y: event.target.y() };
                      updateZoneVertex(zone.id, vertexIndex, pos);
                    }
                    setDragPreview(null);
                  }}
                />
              ))}
          </Group>
        );
      })}
    </Layer>
  );
}

export default memo(ZoneLayer);
