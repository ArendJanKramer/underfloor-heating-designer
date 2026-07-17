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
}

export interface Manifold {
  position: Point;
}

export type ToolMode = 'select' | 'placeManifold' | 'drawZone' | 'editBoundary';

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

export interface Project {
  pixelsPerMeter: number;
  zones: Zone[];
  manifold: Manifold | null;
  dxfEntities: DxfEntity[];
  maxCircuitLengthM: number;
  defaultSpacingMm: number;
}

export interface CalibrationState {
  active: boolean;
  point1: Point | null;
  point2: Point | null;
}
