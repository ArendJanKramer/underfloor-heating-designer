import { DxfEntity, Point } from '../types';

interface DxfData {
  entities: unknown[];
  header?: Record<string, unknown>;
}

/**
 * Parse raw DXF data into our internal DxfEntity format.
 */
export function parseDxfEntities(dxfData: DxfData): DxfEntity[] {
  if (!dxfData?.entities) return [];

  const entities: DxfEntity[] = [];

  for (const raw of dxfData.entities as Record<string, unknown>[]) {
    const type = (raw.type as string) ?? '';

    switch (type) {
      case 'LINE': {
        const start = raw.start as { x: number; y: number } | undefined;
        const end = raw.end as { x: number; y: number } | undefined;
        if (start && end) {
          entities.push({
            type: 'LINE',
            startPoint: { x: start.x, y: start.y },
            endPoint: { x: end.x, y: end.y },
          });
        }
        break;
      }
      case 'LWPOLYLINE':
      case 'POLYLINE': {
        const verts = (raw.vertices as { x: number; y: number }[]) ?? [];
        if (verts.length > 0) {
          entities.push({
            type,
            vertices: verts.map((v) => ({ x: v.x, y: v.y })),
            closed: Boolean(raw.shape || raw.closed),
          });
        }
        break;
      }
      case 'CIRCLE': {
        const center = raw.center as { x: number; y: number } | undefined;
        const radius = raw.radius as number | undefined;
        if (center && radius !== undefined) {
          entities.push({
            type: 'CIRCLE',
            center: { x: center.x, y: center.y },
            radius,
          });
        }
        break;
      }
      case 'ARC': {
        const center = raw.center as { x: number; y: number } | undefined;
        const radius = raw.radius as number | undefined;
        const startAngle = raw.startAngle as number | undefined;
        const endAngle = raw.endAngle as number | undefined;
        if (center && radius !== undefined) {
          entities.push({
            type: 'ARC',
            center: { x: center.x, y: center.y },
            radius,
            startAngle: startAngle ?? 0,
            endAngle: endAngle ?? 360,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  return entities;
}

/**
 * Compute bounding box of DXF entities.
 */
export function dxfBoundingBox(
  entities: DxfEntity[],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hasPoints = false;

  const updateBounds = (p: Point) => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    hasPoints = true;
  };

  for (const e of entities) {
    switch (e.type) {
      case 'LINE':
        if (e.startPoint) updateBounds(e.startPoint);
        if (e.endPoint) updateBounds(e.endPoint);
        break;
      case 'LWPOLYLINE':
      case 'POLYLINE':
        e.vertices?.forEach(updateBounds);
        break;
      case 'CIRCLE':
      case 'ARC':
        if (e.center && e.radius !== undefined) {
          updateBounds({ x: e.center.x - e.radius, y: e.center.y - e.radius });
          updateBounds({ x: e.center.x + e.radius, y: e.center.y + e.radius });
        }
        break;
    }
  }

  if (!hasPoints) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Compute the transform to fit DXF entities into the viewport.
 */
export function fitDxfToViewport(
  entities: DxfEntity[],
  viewportWidth: number,
  viewportHeight: number,
  padding = 40,
): { offsetX: number; offsetY: number; scale: number } {
  const bb = dxfBoundingBox(entities);
  if (!bb) return { offsetX: 0, offsetY: 0, scale: 1 };

  const drawW = bb.maxX - bb.minX;
  const drawH = bb.maxY - bb.minY;
  if (drawW <= 0 || drawH <= 0) return { offsetX: 0, offsetY: 0, scale: 1 };

  const scaleX = (viewportWidth - 2 * padding) / drawW;
  const scaleY = (viewportHeight - 2 * padding) / drawH;
  const scale = Math.min(scaleX, scaleY);

  const scaledW = drawW * scale;
  const scaledH = drawH * scale;
  const offsetX = (viewportWidth - scaledW) / 2 - bb.minX * scale;
  const offsetY = (viewportHeight + scaledH) / 2 + bb.minY * scale;

  return { offsetX, offsetY, scale };
}
