import { useCallback, useEffect } from 'react';
import Canvas from './components/Canvas';
import SidePanel from './components/SidePanel';
import TopToolbar from './components/TopToolbar';
import { useStore } from './state/store';
import './App.css';

export default function App() {
  const toolMode = useStore((state) => state.toolMode);
  const calibrationActive = useStore((state) => state.calibration.active);
  const measurementActive = useStore((state) => state.measurement.start !== null);
  const closeZone = useStore((state) => state.closeZone);
  const cancelDrawing = useStore((state) => state.cancelDrawing);
  const cancelRouting = useStore((state) => state.cancelRouting);
  const cancelCalibration = useStore((state) => state.cancelCalibration);
  const clearMeasurement = useStore((state) => state.clearMeasurement);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Enter' && toolMode === 'drawZone') {
        closeZone();
      }

      if (event.key === 'Escape') {
        if (calibrationActive) {
          event.preventDefault();
          cancelCalibration();
        } else if (toolMode === 'routeLeader') {
          event.preventDefault();
          cancelRouting();
          cancelDrawing();
        } else if (toolMode === 'measure') {
          event.preventDefault();
          clearMeasurement();
          cancelDrawing();
        } else if (toolMode !== 'select') {
          event.preventDefault();
          cancelDrawing();
        } else if (measurementActive) {
          event.preventDefault();
          clearMeasurement();
        }
      }
    },
    [calibrationActive, cancelCalibration, cancelDrawing, cancelRouting, clearMeasurement, closeZone, measurementActive, toolMode],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="app">
      <SidePanel />
      <main className="canvas-area">
        <TopToolbar />
        <Canvas />
      </main>
    </div>
  );
}
