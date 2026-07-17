import { useCallback, useEffect } from 'react';
import Canvas from './components/Canvas';
import SidePanel from './components/SidePanel';
import { useStore } from './state/store';
import './App.css';

export default function App() {
  const toolMode = useStore((state) => state.toolMode);
  const closeZone = useStore((state) => state.closeZone);
  const cancelDrawing = useStore((state) => state.cancelDrawing);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Enter' && toolMode === 'drawZone') {
        closeZone();
      }

      if (event.key === 'Escape') {
        cancelDrawing();
      }
    },
    [cancelDrawing, closeZone, toolMode],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="app">
      <SidePanel />
      <main className="canvas-area">
        <Canvas />
      </main>
    </div>
  );
}
