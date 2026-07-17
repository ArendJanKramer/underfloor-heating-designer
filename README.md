# Underfloor Heating Circuit Designer

An interactive React + Vite + TypeScript single-page application for designing underfloor (radiant floor) heating circuits.

## Features

- **DXF Import** — Load a `.dxf` floor plan as a non-editable reference layer on the canvas
- **Scale Calibration** — Click two points and enter the real-world distance to calibrate pixel→meter conversion
- **Manifold Placement** — Drop a manifold marker (draggable) as the central connection point
- **Zone Creation** — Draw polygon zones by clicking vertices; double-click or press Enter to close
- **Boundary Editing** — Drag zone vertices to adjust boundaries
- **Per-zone Pipe Spacing** — Set spacing (100/150/200/250 mm or custom) per zone
- **Automatic Spiral Generation** — Bifilar counter-flow pipe spiral auto-generated inside each zone
- **Manifold Connections** — Leader pipes route from each zone's spiral back to the manifold
- **Length Computation** — Spiral length + leader length per zone, with warnings for circuits exceeding max length
- **Pan & Zoom** — Mouse wheel zoom and drag to pan the canvas

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

1. **Import DXF**: Click "Import DXF" in the side panel to load a floor plan
2. **Calibrate Scale**: Click "Calibrate Scale", click two points on the plan, enter the real distance
3. **Place Manifold**: Select "Manifold" tool, click on the canvas to place it
4. **Draw Zones**: Select "Draw Zone" tool, click to add polygon vertices, double-click or press Enter to close
5. **Adjust Spacing**: In each zone card, select a pipe spacing preset or enter a custom value
6. **View Lengths**: The side panel shows spiral length, leader length, and total per zone

## Architecture

```text
src/
  types.ts                 — TypeScript types (Point, Zone, Manifold, etc.)
  geometry/
    offset.ts              — Polygon inward-offset algorithm
    spiral.ts              — Bifilar spiral generation
    length.ts              — Path length calculations
    dxfHelpers.ts          — DXF parsing and viewport fitting
  state/
    store.ts               — Zustand store (app state + actions)
  components/
    Canvas/                — Konva stage, DXF layer, zone layer, manifold, leaders
    SidePanel/             — Toolbar, DXF import, calibration, zone list
```

## Known Limitations

- **Concave polygons**: The inward-offset algorithm uses simple vertex-normal offsetting and may produce artifacts or fail for highly concave shapes. A robust implementation would use Clipper2 or similar.
- **Self-intersecting offsets**: For polygons with tight angles, the offset rings may self-intersect. The algorithm rejects obviously wrong offsets (area check) but does not fully resolve all cases.
- **Spiral bifilar approximation**: The implementation generates a single-pass inward spiral (one continuous polyline). A true bifilar spiral alternates supply/return pipes; this is approximated visually.
- **Leader routing**: Leaders are straight lines; orthogonal routing and collision avoidance are not implemented.
- **Large DXF files**: Very complex DXF files may be slow to render.
