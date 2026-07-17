export interface Point {
  x: number;
  y: number;
}

export interface Polygon {
  points: Point[];
}

export type PipePath = Point[];

export interface Zone {
  id: string;
  name: string;
  color: string;
  polygon: Polygon;
  spacingMm: number;
  spiral: PipePath | null;
  spiralLengthM: number;
  leaderLengthM: number;
  areaM2: number;
}

export interface Manifold {
  position: Point;
}

export type ToolMode = 'select' | 'placeManifold' | 'drawZone' | 'drawRect' | 'editBoundary';

export interface DxfEntity {
  type: string;
  points?: Point[];
  center?: Point;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  startPoint?: Point;
  endPoint?: Point;
  vertices?: Point[];
  closed?: boolean;
}

export interface DxfTransform {
  offsetX: number;
  offsetY: number;
  scale: number;
}

/** Discriminated union for the background floor-plan layer */
export type Background =
  | { kind: 'dxf'; entities: DxfEntity[]; transform: DxfTransform }
  | {
      kind: 'image';
      src: string;
      naturalWidth: number;
      naturalHeight: number;
      /** Computed fit-to-viewport transform (set on load) */
      fitX: number;
      fitY: number;
      fitScale: number;
    };

export interface CalibrationState {
  active: boolean;
  point1: Point | null;
  point2: Point | null;
}
