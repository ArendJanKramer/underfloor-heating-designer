import { Arc, Circle, Layer, Line } from 'react-konva';
import { DxfEntity } from '../../types';

interface Props {
  entities: DxfEntity[];
  transform: { offsetX: number; offsetY: number; scale: number };
}

function transformPoint(
  x: number,
  y: number,
  transform: { offsetX: number; offsetY: number; scale: number },
) {
  return {
    x: x * transform.scale + transform.offsetX,
    y: -y * transform.scale + transform.offsetY,
  };
}

export default function DxfLayer({ entities, transform }: Props) {
  const elements: JSX.Element[] = [];

  entities.forEach((entity, idx) => {
    switch (entity.type) {
      case 'LINE': {
        if (!entity.startPoint || !entity.endPoint) break;
        const start = transformPoint(entity.startPoint.x, entity.startPoint.y, transform);
        const end = transformPoint(entity.endPoint.x, entity.endPoint.y, transform);
        elements.push(
          <Line
            key={`line-${idx}`}
            points={[start.x, start.y, end.x, end.y]}
            stroke="#94a3b8"
            strokeWidth={1}
            listening={false}
          />,
        );
        break;
      }
      case 'LWPOLYLINE':
      case 'POLYLINE': {
        if (!entity.vertices || entity.vertices.length < 2) break;
        const points = entity.vertices.flatMap((vertex) => {
          const point = transformPoint(vertex.x, vertex.y, transform);
          return [point.x, point.y];
        });
        elements.push(
          <Line
            key={`poly-${idx}`}
            points={points}
            stroke="#94a3b8"
            strokeWidth={1}
            closed={entity.closed}
            listening={false}
          />,
        );
        break;
      }
      case 'CIRCLE': {
        if (!entity.center || entity.radius === undefined) break;
        const center = transformPoint(entity.center.x, entity.center.y, transform);
        elements.push(
          <Circle
            key={`circle-${idx}`}
            x={center.x}
            y={center.y}
            radius={entity.radius * transform.scale}
            stroke="#94a3b8"
            strokeWidth={1}
            listening={false}
          />,
        );
        break;
      }
      case 'ARC': {
        if (!entity.center || entity.radius === undefined) break;
        const center = transformPoint(entity.center.x, entity.center.y, transform);
        const startAngle = -(entity.endAngle ?? 0);
        const endAngle = -(entity.startAngle ?? 0);
        elements.push(
          <Arc
            key={`arc-${idx}`}
            x={center.x}
            y={center.y}
            innerRadius={0}
            outerRadius={entity.radius * transform.scale}
            angle={Math.abs(endAngle - startAngle)}
            rotation={startAngle}
            stroke="#94a3b8"
            strokeWidth={1}
            fill=""
            listening={false}
          />,
        );
        break;
      }
      default:
        break;
    }
  });

  return <Layer listening={false}>{elements}</Layer>;
}
