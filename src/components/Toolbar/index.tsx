import { useStore } from '../../state/store';
import { ToolMode } from '../../types';

const TOOL_OPTIONS: Array<{ mode: ToolMode; label: string }> = [
  { mode: 'select', label: '↖ Select' },
  { mode: 'placeManifold', label: '🔧 Manifold' },
  { mode: 'drawZone', label: '✏️ Draw Zone' },
  { mode: 'drawRect', label: '▭ Draw Rect' },
];

export default function Toolbar() {
  const toolMode = useStore((state) => state.toolMode);
  const setToolMode = useStore((state) => state.setToolMode);

  return (
    <div className="tool-grid">
      {TOOL_OPTIONS.map(({ mode, label }) => (
        <button
          key={mode}
          className={`btn tool-btn ${toolMode === mode ? 'active' : ''}`}
          onClick={() => setToolMode(mode)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
