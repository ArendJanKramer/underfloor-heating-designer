import { Group, Layer, Rect, Text } from 'react-konva';
import { Manifold } from '../../types';
import { useStore } from '../../state/store';

interface Props {
  manifold: Manifold | null;
}

export default function ManifoldLayer({ manifold }: Props) {
  const updateManifoldPosition = useStore((state) => state.updateManifoldPosition);

  if (!manifold) return <Layer />;

  const { x, y } = manifold.position;
  const width = 60;
  const height = 30;

  return (
    <Layer>
      <Group
        x={x - width / 2}
        y={y - height / 2}
        draggable
        onDragEnd={(event) => {
          updateManifoldPosition({
            x: event.target.x() + width / 2,
            y: event.target.y() + height / 2,
          });
        }}
      >
        <Rect
          width={width}
          height={height}
          fill="#1e3a5f"
          stroke="#4a9eff"
          strokeWidth={2}
          cornerRadius={4}
        />
        <Text
          text="MANIFOLD"
          fontSize={8}
          fill="white"
          width={width}
          height={height}
          align="center"
          verticalAlign="middle"
        />
      </Group>
    </Layer>
  );
}
