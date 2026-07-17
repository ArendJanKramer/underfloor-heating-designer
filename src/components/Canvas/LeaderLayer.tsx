import { Fragment } from 'react';
import { Arrow, Layer } from 'react-konva';
import { Manifold, Zone } from '../../types';
import { getSpiralStubs } from '../../geometry/spiral';

interface Props {
  zones: Zone[];
  manifold: Manifold | null;
}

export default function LeaderLayer({ zones, manifold }: Props) {
  if (!manifold) return <Layer />;

  return (
    <Layer listening={false}>
      {zones.map((zone) => {
        if (!zone.spiral || zone.spiral.length < 2) return null;
        const stubs = getSpiralStubs(zone.spiral);
        if (!stubs) return null;

        const manifoldPosition = manifold.position;

        return (
          <Fragment key={zone.id}>
            <Arrow
              points={[stubs.start.x, stubs.start.y, manifoldPosition.x, manifoldPosition.y]}
              stroke={zone.color}
              strokeWidth={2}
              fill={zone.color}
              pointerLength={8}
              pointerWidth={6}
              opacity={0.7}
              dash={[6, 3]}
            />
            <Arrow
              points={[stubs.end.x, stubs.end.y, manifoldPosition.x, manifoldPosition.y]}
              stroke={zone.color}
              strokeWidth={2}
              fill={zone.color}
              pointerLength={8}
              pointerWidth={6}
              opacity={0.5}
              dash={[3, 3]}
            />
          </Fragment>
        );
      })}
    </Layer>
  );
}
