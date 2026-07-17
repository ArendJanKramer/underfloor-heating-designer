import { Circle, Group, Layer, Line } from 'react-konva';
import { ToolMode, Zone } from '../../types';
import { useStore } from '../../state/store';

interface Props {
  zones: Zone[];
  selectedZoneId: string | null;
  toolMode: ToolMode;
}

export default function ZoneLayer({ zones, selectedZoneId, toolMode }: Props) {
  const updateZoneVertex = useStore((state) => state.updateZoneVertex);
  const selectZone = useStore((state) => state.selectZone);

  return (
    <Layer>
      {zones.map((zone) => {
        const isSelected = zone.id === selectedZoneId;
        const points = zone.polygon.points.flatMap((point) => [point.x, point.y]);

        return (
          <Group key={zone.id}>
            <Line
              points={points}
              closed
              fill={`${zone.color}33`}
              stroke={zone.color}
              strokeWidth={isSelected ? 2.5 : 1.5}
              onClick={() => selectZone(zone.id)}
              onTap={() => selectZone(zone.id)}
            />

            {zone.spiral && zone.spiral.length > 1 && (
              <Line
                points={zone.spiral.flatMap((point) => [point.x, point.y])}
                stroke={zone.color}
                strokeWidth={1.5}
                opacity={0.85}
                listening={false}
              />
            )}

            {isSelected &&
              toolMode === 'editBoundary' &&
              zone.polygon.points.map((point, vertexIndex) => (
                <Circle
                  key={vertexIndex}
                  x={point.x}
                  y={point.y}
                  radius={6}
                  fill="white"
                  stroke={zone.color}
                  strokeWidth={2}
                  draggable
                  onDragEnd={(event) => {
                    updateZoneVertex(zone.id, vertexIndex, {
                      x: event.target.x(),
                      y: event.target.y(),
                    });
                  }}
                />
              ))}
          </Group>
        );
      })}
    </Layer>
  );
}
