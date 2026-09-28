import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Zone } from '../../types';
import { useStore } from '../../state/store';
import SidePanel from './index';

const squareZone: Zone = {
    id: 'zone-area',
    name: 'Test zone',
    color: '#3498db',
    polygon: {
        points: [
            { x: 0, y: 0 },
            { x: 2000, y: 0 },
            { x: 2000, y: 2000 },
            { x: 0, y: 2000 },
        ],
    },
    spacingMm: 150,
    paddingMm: 100,
    connectionCorner: 'bottom-left',
    startDirection: 'vertical',
    spiral: null,
    spiralLengthMm: 0,
    leaderLengthMm: 0,
    areaMm2: 4_000_000,
    leaderWaypoints: null,
    manifoldPortOffsetMm: null,
};

describe('SidePanel calibration and zone totals', () => {
    beforeEach(() => {
        window.localStorage.clear();
        useStore.setState({
            background: {
                kind: 'image',
                src: 'data:image/png;base64,abc123',
                naturalWidth: 100,
                naturalHeight: 100,
                x: 0,
                y: 0,
                mmPerPixel: 10,
            },
            zones: [],
            selectedZoneId: null,
            toolMode: 'select',
            drawingPoints: [],
            drawRectStart: null,
            routing: null,
            calibration: { active: false, point1: null, point2: null },
        });
    });

    it('treats a calibration value of 1 as one metre', () => {
        render(<SidePanel />);

        fireEvent.click(screen.getByRole('button', { name: /calibrate scale/i }));
        act(() => {
            useStore.getState().addCalibrationPoint({ x: 0, y: 0 });
            useStore.getState().addCalibrationPoint({ x: 2000, y: 0 });
        });

        fireEvent.change(screen.getByLabelText(/real calibration distance/i), {
            target: { value: '1' },
        });
        fireEvent.click(screen.getByRole('button', { name: /apply/i }));

        expect(useStore.getState().background).toMatchObject({ mmPerPixel: 5 });
    });

    it('shows the combined floor area for polygon zones', () => {
        act(() => useStore.setState({ zones: [squareZone] }));
        render(<SidePanel />);

        fireEvent.click(screen.getByRole('button', { name: /zones/i }));

        expect(screen.getByText('Total area: 4.00 m²')).toBeTruthy();
    });
});
