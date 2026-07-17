# Underfloor Heating Circuit Designer

An interactive React + Vite + TypeScript single-page application for designing underfloor (radiant floor) heating circuits.

## Features

- **Background Import** — Load a raster image (PNG, JPG, WEBP, GIF) **or** a DXF file as the floor-plan reference layer
- **Scale Calibration** — Click two points on the background and enter the real-world distance to calibrate pixel→meter conversion; works with both images and DXF
- **Manifold Placement** — Drop a draggable manifold marker as the central connection point
- **Zone Creation (polygon)** — Draw freeform polygon zones by clicking vertices; double-click to close
- **Zone Creation (rectangle)** — "Draw Rect" mode: click first corner, then opposite corner for an axis-aligned rectangle zone
- **Boundary Editing** — Drag zone vertices in "Select" mode with Edit Boundary active
- **Per-zone Pipe Spacing** — Set spacing per zone (50–500 mm)
- **Rectilinear Serpentine Spirals** — Auto-generated inside each zone using only horizontal/vertical runs joined by rounded U-turns (see algorithm below)
- **Manifold Leader Pipes** — Both supply and return leaders connect each zone back to the manifold
- **Length Computation** — Spiral + leader length per zone, with over-length warnings
- **Pan & Zoom** — Mouse-wheel zoom and drag-to-pan

## Tech Stack

- **Vite** + **React** + **TypeScript**
- **react-konva** / **konva** — Interactive 2D canvas
- **dxf-parser** — DXF file parsing
- **zustand** — State management
- **Vitest** — Unit tests

## Getting Started

```bash
npm install
npm run dev      # Start development server
npm run build    # Production build
npm test         # Run unit tests
```

## Usage

1. **Import background**: Click "Import DXF or Image" to load a floor plan as PNG/JPG/etc. (preferred) or as a DXF. The background is auto-fitted to the viewport.
2. **Calibrate scale**: Click "Calibrate Scale", click two known points on the image/DXF, then enter the real-world distance between them in metres.
3. **Place manifold**: Select the "Manifold" tool and click on the canvas.
4. **Draw zones**:
   - *Polygon zone*: Select "Draw Zone", click to add vertices, double-click to close.
   - *Rectangle zone*: Select "Draw Rect", click the first corner, then click the opposite corner.
5. **Adjust spacing**: In each zone card, enter the desired pipe spacing.
6. **View lengths**: The side panel shows spiral length, leader length, and total per zone.

## Image Import (recommended)

Raster images are the primary background workflow:

- Accepted formats: **PNG, JPG/JPEG, WEBP, GIF**
- The image is loaded via `URL.createObjectURL`, displayed on a dedicated Konva layer, and auto-fitted (centered + scaled to fill the viewport with 40 px padding).
- The fit transform (`fitX`, `fitY`, `fitScale`) is stored in state at import time so calibration coordinates remain stable after the initial load.
- Pan, zoom, and scale calibration all work on top of the image exactly as for DXF.

### DXF import

DXF import is retained for compatibility. Supported entity types: `LINE`, `LWPOLYLINE`, `POLYLINE`, `CIRCLE`, `ARC`. Note that some DXF exporters produce entities not covered by these types or put all geometry at Y=0 (invisible after Y-flip). If the DXF renders nothing, use image import instead.

## Serpentine / Rounded-Corner Algorithm

The pipe fill algorithm is a **rectilinear boustrophedon** ("even-N serpentine with U-turn arcs"):

1. **Bounding box** of the zone polygon is computed.
2. **Orientation** (vertical or horizontal passes) is chosen based on which edge of the bounding box is nearest the manifold:
   - Manifold above/below the zone → **vertical passes** (parallel to Y axis)
   - Manifold left/right of the zone → **horizontal passes** (parallel to X axis)
3. **Even pass count** `N` is enforced (odd N is decremented by 1). An even-N boustrophedon starts and ends on the *same side* of the bounding box, ensuring both path endpoints land near the manifold-facing edge.
4. **Rounded U-turns**: at each end of a pass a 180° semicircular arc of radius `spacing/2` is inserted (generated as 8 linear segments). This replaces mitered corners with smooth rounded turns and keeps all geometry rectilinear + arced (no diagonals).
5. **Both endpoints** (supply entry and return exit) land near the manifold-facing edge and are individually connected back to the manifold via leader arrows.
6. **Length accuracy**: path length is computed over the full polyline including arc segments, so arc overheads are accounted for.

This "even-N boustrophedon" behaves as the double-lane / counter-flow-with-return-lane arrangement: the even-indexed passes carry the outgoing flow and the odd-indexed passes carry the returning flow, interleaved at `spacing` intervals.

## Rectangle Zone Mode

The **"Draw Rect"** toolbar button activates rectangle drawing:

- Click to set the **first corner**.
- Click again at the **opposite corner** to create an axis-aligned 4-vertex rectangle polygon.
- A live dashed-rectangle preview is shown while moving the mouse.
- The resulting zone flows through the same pipeline as a polygon zone (spiral generation, leader routing, length calculation).

## Architecture

```text
src/
  types.ts                 — TypeScript types (Point, Zone, Manifold, Background, ...)
  geometry/
    offset.ts              — Polygon inward-offset helpers (used by tests)
    spiral.ts              — Rectilinear serpentine generation (generateSerpentine)
    length.ts              — Path length calculations
    dxfHelpers.ts          — DXF parsing and viewport fitting
  state/
    store.ts               — Zustand store (app state + all actions)
  components/
    Canvas/                — Konva stage, background layers, zone layer, manifold, leaders
      ImageLayer.tsx       — Raster image background layer
      DxfLayer.tsx         — DXF entity rendering
      ZoneLayer.tsx        — Zone polygons + spirals + vertex editing
      LeaderLayer.tsx      — Supply/return leader arrows to manifold
      ManifoldLayer.tsx    — Manifold marker
    SidePanel/             — Import UI, calibration, toolbar, zone list
    Toolbar/               — Tool mode buttons
```

### Background state shape

```typescript
type Background =
  | { kind: 'dxf';   entities: DxfEntity[]; transform: DxfTransform }
  | { kind: 'image'; src: string; naturalWidth: number; naturalHeight: number;
      fitX: number; fitY: number; fitScale: number }
  | null;
```

## Known Limitations

- **Polygon clipping**: The serpentine uses the zone's axis-aligned bounding box for pass extents; it does not clip individual passes to the actual polygon boundary. This is accurate for rectangular zones; for irregular polygons some pass ends may protrude slightly beyond the zone outline.
- **Concave polygons**: Vertex editing and spiral generation work best for convex or mildly concave zones.
- **Leader routing**: Leaders are straight arrow lines; orthogonal routing and collision avoidance are not implemented.
- **Large DXF files**: Very complex DXF files may be slow to render.
