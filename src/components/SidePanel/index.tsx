import { type ChangeEvent, useRef, useState } from 'react';
import DxfParser from 'dxf-parser';
import { fitDxfToViewport, parseDxfEntities } from '../../geometry/dxfHelpers';
import { useStore } from '../../state/store';
import Toolbar from '../Toolbar';
import ZoneCard from './ZoneCard';

export default function SidePanel() {
  const {
    zones,
    selectedZoneId,
    manifold,
    toolMode,
    calibration,
    pixelsPerMeter,
    maxCircuitLengthM,
    defaultSpacingMm,
    dxfEntities,
    setDxfEntities,
    setMaxCircuitLength,
    setDefaultSpacing,
    startCalibration,
    finishCalibration,
    cancelCalibration,
  } = useStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [calibrationDistance, setCalibrationDistance] = useState('1.0');
  const [dxfError, setDxfError] = useState<string | null>(null);

  const handleDxfImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setDxfError(null);
    const reader = new FileReader();

    reader.onload = (loadEvent) => {
      try {
        const content = loadEvent.target?.result as string;
        const parser = new DxfParser();
        const dxf = parser.parseSync(content);
        const entities = parseDxfEntities(dxf as { entities: unknown[] });
        const transform = fitDxfToViewport(
          entities,
          Math.max(window.innerWidth - 320, 320),
          window.innerHeight,
        );
        setDxfEntities(entities, transform);
      } catch (error) {
        setDxfError('Failed to parse DXF file. Make sure it is a valid AutoCAD DXF.');
        console.error(error);
      }
    };

    reader.readAsText(file);
    event.target.value = '';
  };

  const totalGrand = zones.reduce(
    (sum, zone) => sum + zone.spiralLengthM + zone.leaderLengthM,
    0,
  );

  return (
    <div className="side-panel">
      <div className="panel-header">
        <h1>🌡️ UFH Designer</h1>
      </div>

      <section className="panel-section">
        <h2>📐 Floor Plan (DXF)</h2>
        <input
          ref={fileInputRef}
          type="file"
          accept=".dxf"
          onChange={handleDxfImport}
          style={{ display: 'none' }}
        />
        <button className="btn" onClick={() => fileInputRef.current?.click()}>
          {dxfEntities.length > 0 ? '🔄 Re-import DXF' : '📁 Import DXF'}
        </button>
        {dxfError && <p className="error">{dxfError}</p>}
        {dxfEntities.length > 0 && <p className="info">{dxfEntities.length} entities loaded</p>}
      </section>

      <section className="panel-section">
        <h2>📏 Scale Calibration</h2>
        <p className="info">
          1 px = {pixelsPerMeter > 0 ? (1000 / pixelsPerMeter).toFixed(1) : '?'} mm
        </p>
        {!calibration.active ? (
          <button className="btn" onClick={startCalibration}>
            📏 Calibrate Scale
          </button>
        ) : (
          <div>
            <p className="info">
              {!calibration.point1
                ? 'Click first point on canvas'
                : !calibration.point2
                  ? 'Click second point on canvas'
                  : 'Enter the real distance between the points'}
            </p>
            {calibration.point2 && (
              <div className="calibration-input">
                <input
                  type="number"
                  step="0.1"
                  min="0.01"
                  value={calibrationDistance}
                  onChange={(event) => setCalibrationDistance(event.target.value)}
                  placeholder="Real distance (m)"
                />
                <span>m</span>
                <button
                  className="btn btn-primary"
                  onClick={() => finishCalibration(Number(calibrationDistance))}
                >
                  ✓ Apply
                </button>
              </div>
            )}
            <button className="btn btn-secondary" onClick={cancelCalibration}>
              Cancel
            </button>
          </div>
        )}
      </section>

      <section className="panel-section">
        <h2>🛠️ Tools</h2>
        <Toolbar />
        {toolMode === 'drawZone' && (
          <p className="info">Click to add points. Double-click or Enter to close.</p>
        )}
        {toolMode === 'placeManifold' && (
          <p className="info">Click on canvas to place the manifold.</p>
        )}
        {manifold && <p className="info success">✓ Manifold placed</p>}
      </section>

      <section className="panel-section">
        <h2>⚙️ Settings</h2>
        <div className="setting-row">
          <label>Max circuit length:</label>
          <input
            type="number"
            min={10}
            max={500}
            value={maxCircuitLengthM}
            onChange={(event) => setMaxCircuitLength(Number(event.target.value))}
          />
          <span>m</span>
        </div>
        <div className="setting-row">
          <label>Default spacing:</label>
          <input
            type="number"
            min={50}
            max={500}
            value={defaultSpacingMm}
            onChange={(event) => setDefaultSpacing(Number(event.target.value))}
          />
          <span>mm</span>
        </div>
      </section>

      <section className="panel-section zones-section">
        <h2>
          🏠 Zones {zones.length > 0 && <span className="zone-count">{zones.length}</span>}
        </h2>
        {zones.length === 0 && (
          <p className="info">No zones yet. Use "Draw Zone" to create one.</p>
        )}
        <div className="zone-list">
          {zones.map((zone) => (
            <ZoneCard
              key={zone.id}
              zone={zone}
              isSelected={zone.id === selectedZoneId}
              maxCircuitLengthM={maxCircuitLengthM}
            />
          ))}
        </div>

        {zones.length > 0 && (
          <div className="grand-total">
            <strong>Grand Total: {totalGrand.toFixed(1)} m</strong>
          </div>
        )}
      </section>
    </div>
  );
}
