declare module 'clipper-lib' {
  type ClipperPoint = { X: number; Y: number };
  type ClipperPath = ClipperPoint[];

  const ClipperLib: {
    ClipperOffset: new (miterLimit?: number, arcTolerance?: number) => {
      AddPath(path: ClipperPath, joinType: number, endType: number): void;
      Execute(solution: ClipperPath[], delta: number): void;
    };
    Paths: new () => ClipperPath[];
    JoinType: { jtMiter: number };
    EndType: { etClosedPolygon: number };
  };

  export = ClipperLib;
}
