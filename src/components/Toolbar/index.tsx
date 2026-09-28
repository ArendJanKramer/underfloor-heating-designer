import {
    Link2,
    Maximize2,
    MousePointer2,
    RectangleHorizontal,
    RulerDimensionLine, Waypoints,
    Wrench,
} from 'lucide-react';
import { useStore } from '../../state/store';
import { ToolMode } from '../../types';

const TOOL_OPTIONS: Array<{ mode: ToolMode; label: string; Icon: typeof Wrench }> = [
  { mode: 'select', label: 'Select', Icon: MousePointer2 },
  { mode: 'placeManifold', label: 'Manifold', Icon: Wrench },
  { mode: 'drawZone', label: 'Polygon zone', Icon: Waypoints },
  { mode: 'drawRect', label: 'Rect zone', Icon: RectangleHorizontal },
  { mode: 'routeLeader', label: 'Route Leaders', Icon: Link2 },
  { mode: 'measure', label: 'Measure', Icon: RulerDimensionLine },
];

export default function Toolbar() {
  const toolMode = useStore((state) => state.toolMode);
  const manifold = useStore((state) => state.manifold);
  const setToolMode = useStore((state) => state.setToolMode);
  const fitViewToContent = useStore((state) => state.fitViewToContent);

  return (
    <div className="top-toolbar-tools">
      {TOOL_OPTIONS.map(({ mode, label, Icon }) => (
        <button
          key={mode}
          className={`btn tool-btn ${toolMode === mode ? 'active' : ''}`}
          onClick={() => setToolMode(mode)}
          disabled={mode === 'routeLeader' && !manifold}
          title={mode === 'routeLeader' && !manifold ? 'Place a manifold before routing leaders' : undefined}
        >
          <Icon />
          {label}
        </button>
      ))}
      <button
        className="btn tool-btn"
        onClick={() => fitViewToContent(window.innerWidth - 320, window.innerHeight - 44)}
        title="Zoom and pan to frame the whole drawing"
      >
        <Maximize2 />
        Fit View
      </button>
    </div>
  );
}
