import { useState } from 'react';
import { MoveHorizontal, MoveVertical, Pencil, Trash2, TriangleAlert, X } from 'lucide-react';
import { SpiralStartDirection, Zone, ZoneConnectionCorner } from '../../types';
import { useStore } from '../../state/store';
import EditableSelect from './EditableSelect';
import { mm2ToSquareMeters, mmToMeters } from '../../geometry/length';

interface Props {
  zone: Zone;
  isSelected: boolean;
  maxCircuitLengthM: number;
}

const SPACING_PRESETS = [100, 150, 200, 250];
const PADDING_PRESETS = [0, 50, 100, 150];
const CORNER_OPTIONS: Array<{ value: ZoneConnectionCorner; label: string }> = [
  { value: 'top-left', label: 'Top-left' },
  { value: 'top-right', label: 'Top-right' },
  { value: 'bottom-left', label: 'Bottom-left' },
  { value: 'bottom-right', label: 'Bottom-right' },
];
const START_DIRECTION_OPTIONS: Array<{
  value: SpiralStartDirection;
  label: string;
  Icon: typeof MoveHorizontal;
}> = [
  { value: 'horizontal', label: 'Horizontal', Icon: MoveHorizontal },
  { value: 'vertical', label: 'Vertical', Icon: MoveVertical },
];

export default function ZoneCard({ zone, isSelected, maxCircuitLengthM }: Props) {
  const {
    selectZone,
    deleteZone,
    removeZoneLeaderRoute,
    updateZoneSpacing,
    updateZonePadding,
    updateZoneConnectionCorner,
    updateZoneStartDirection,
    updateZoneName,
    setToolMode,
  } = useStore();
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(zone.name);

  // Lengths are stored in mm and quoted in metres, like every pipe schedule.
  const totalLength = mmToMeters(zone.spiralLengthMm + zone.leaderLengthMm);
  const isOverLimit = totalLength > maxCircuitLengthM;

  const commitName = () => {
    const nextName = nameValue.trim() || zone.name;
    updateZoneName(zone.id, nextName);
    setNameValue(nextName);
    setEditingName(false);
  };

  return (
    <div
      className={`zone-card ${isSelected ? 'selected' : ''}`}
      onClick={() => selectZone(zone.id)}
      style={{ borderLeftColor: zone.color }}
    >
      <div className="zone-card-header">
        {editingName ? (
          <input
            autoFocus
            value={nameValue}
            onChange={(event) => setNameValue(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commitName();
              }
            }}
            className="zone-name-input"
          />
        ) : (
          <span
            className="zone-name"
            onDoubleClick={() => {
              setEditingName(true);
              setNameValue(zone.name);
            }}
          >
            {zone.name}
          </span>
        )}
        <div className="zone-actions">
          {zone.leaderWaypoints !== null && (
            <button
              className="btn-icon btn-danger"
              title={`Remove leader route for ${zone.name}`}
              aria-label={`Remove leader route for ${zone.name}`}
              onClick={(event) => {
                event.stopPropagation();
                removeZoneLeaderRoute(zone.id);
              }}
            >
              <X />
            </button>
          )}
          <button
            className="btn-icon"
            title="Edit boundary"
            onClick={(event) => {
              event.stopPropagation();
              selectZone(zone.id);
              setToolMode('editBoundary');
            }}
          >
            <Pencil />
          </button>
          <button
            className="btn-icon btn-danger"
            title="Delete zone"
            onClick={(event) => {
              event.stopPropagation();
              deleteZone(zone.id);
            }}
          >
            <Trash2 />
          </button>
        </div>
      </div>

      <div className="zone-spacing">
        <label>Spacing:</label>
        <div className="spacing-presets">
          <EditableSelect
            value={zone.spacingMm}
            presets={SPACING_PRESETS}
            min={50}
            max={500}
            onChange={(value) => updateZoneSpacing(zone.id, value)}
          />
          <span>mm</span>
        </div>
      </div>

      <div className="zone-spacing">
        <label>Padding:</label>
        <div className="spacing-presets">
          <EditableSelect
            value={zone.paddingMm}
            presets={PADDING_PRESETS}
            min={0}
            max={1000}
            onChange={(value) => updateZonePadding(zone.id, value)}
          />
          <span>mm</span>
        </div>
      </div>

      <div className="zone-spacing">
        <label>Inlet/outlet:</label>
        <div className="spacing-presets">
          <select
            value={zone.connectionCorner}
            onChange={(event) =>
              updateZoneConnectionCorner(zone.id, event.target.value as ZoneConnectionCorner)
            }
            className="zone-select"
            onClick={(event) => event.stopPropagation()}
          >
            {CORNER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="zone-spacing">
        <label>Start:</label>
        <div className="spacing-presets">
          {START_DIRECTION_OPTIONS.map(({ Icon, ...option }) => (
            <button
              key={option.value}
              className={`btn-preset ${zone.startDirection === option.value ? 'active' : ''}`}
              title={`Spiral leaves the manifold running ${option.value}`}
              onClick={(event) => {
                event.stopPropagation();
                updateZoneStartDirection(zone.id, option.value);
              }}
            >
              <Icon />
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`zone-lengths ${isOverLimit ? 'over-limit' : ''}`}>
        <div className="length-row">
          <span>
            {mm2ToSquareMeters(zone.areaMm2).toFixed(2)} m² · spiral{' '}
            {mmToMeters(zone.spiralLengthMm).toFixed(1)}m · leader{' '}
            {mmToMeters(zone.leaderLengthMm).toFixed(1)}m
          </span>
        </div>
        <div className="length-row total">
          <span>Total:</span>
          <span>{totalLength.toFixed(1)} m</span>
        </div>
        {isOverLimit && <div className="warning"><TriangleAlert /> Exceeds {maxCircuitLengthM} m limit!</div>}
      </div>
    </div>
  );
}
