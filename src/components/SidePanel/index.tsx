import { type ChangeEvent, useRef, useState } from 'react';
import DxfParser from 'dxf-parser';
import { fitDxfToViewport, parseDxfEntities } from '../../geometry/dxfHelpers';
import { useStore } from '../../state/store';
import Toolbar from '../Toolbar';
import ZoneCard from './ZoneCard';

const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif';

/** Compute the fit-to-viewport transform for an image. */
function fitImageToViewport(
  naturalWidth: number,
  naturalHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  padding = 40,
): { fitX: number; fitY: number; fitScale: number } {
  if (naturalWidth <= 0 || naturalHeight <= 0) return { fitX: 0, fitY: 0, fitScale: 1 };
  const scaleX = (viewportWidth - 2 * padding) / naturalWidth;
  const scaleY = (viewportHeight - 2 * padding) / naturalHeight;
  const fitScale = Math.min(scaleX, scaleY);
  const fitX = (viewportWidth - naturalWidth * fitScale) / 2;
  const fitY = (viewportHeight - naturalHeight * fitScale) / 2;
  return { fitX, fitY, fitScale };
}

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
    background,
    setBackground,
    setMaxCircuitLength,
    setDefaultSpacing,
    startCalibration,
    finishCalibration,
    cancelCalibration,
  } = useStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [calibrationDistance, setCalibrationDistance] = useState('1.0');
  const [importError, setImportError] = useState<string | null>(null);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportError(null);

    const isDxf = file.name.toLowerCase().endsWith('.dxf');

    if (isDxf) {
      // ---- DXF import ----
      const reader = new FileReader();
      reader.onload = (loadEvent) => {
        try {
          const content = loadEvent.target?.result as string;
          const parser = new DxfParser();
          const dxf = parser.parseSync(content);
          const entities = parseDxfEntities(dxf as { entities: unknown[] });
          if (entities.length === 0) {
            setImportError('DXF parsed but contains no supported entities (LINE, POLYLINE, CIRCLE, ARC). Try importing an image instead.');
            return;
          }
          const transform = fitDxfToViewport(
            entities,
            Math.max(window.innerWidth - 320, 320),
            window.innerHeight,
          );
          setBackground({ kind: 'dxf', entities, transform });
        } catch (error) {
          setImportError('Failed to parse DXF. Make sure it is a valid AutoCAD DXF file, or try importing an image.');
          console.error(error);
        }
      };
      reader.readAsText(file);
    } else {
      // ---- Raster image import ----
      const src = URL.createObjectURL(file);
      const img = new window.Image();
      img.onload = () => {
        const vw = Math.max(window.innerWidth - 320, 320);
        const vh = window.innerHeight;
        const { fitX, fitY, fitScale } = fitImageToViewport(img.naturalWidth, img.naturalHeight, vw, vh);
        setBackground({
          kind: 'image',
          src,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          fitX,
          fitY,
          fitScale,
        });
      };
      img.onerror = () => {
        URL.revokeObjectURL(src);
        setImportError('Failed to load image file.');
      };
      img.src = src;
    }

    event.target.value = '';
  };

  const totalGrand = zones.reduce(
    (sum, zone) => sum + zone.spiralLengthM + zone.leaderLengthM,
    0,
  );

  const bgStatus = background === null
    ? null
    : background.kind === 'dxf'
      ? `DXF loaded – ${background.entities.length} entities`
      : `Image loaded – ${background.naturalWidth}×${background.naturalHeight} px`;

  return (
    <div className="side-panel">
      <div className="panel-header">
        <h1>🌡️ UFH Designer</h1>
      </div>

      <section className="panel-section">
        <h2>📐 Floor Plan</h2>
        <input
          ref={fileInputRef}
          type="file"
          accept={`.dxf,${IMAGE_ACCEPT}`}
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
        <button className="btn" onClick={() => fileInputRef.current?.click()}>
          {background ? '🔄 Re-import DXF or Image' : '📁 Import DXF or Image'}
        </button>
        <p className="info" style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
          Accepts: DXF, PNG, JPG, WEBP, GIF
        </p>
        {importError && <p className="error">{importError}</p>}
        {bgStatus && <p className="info">{bgStatus}</p>}
        {background && (
          <button
            className="btn btn-secondary"
            style={{ marginTop: '4px' }}
            onClick={() => setBackground(null)}
          >
            🗑 Clear background
          </button>
        )}
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
        {toolMode === 'drawRect' && (
          <p className="info">Click first corner, then click opposite corner to create a rectangle zone.</p>
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
          <p className="info">No zones yet. Use "Draw Zone" or "Draw Rect" to create one.</p>
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
