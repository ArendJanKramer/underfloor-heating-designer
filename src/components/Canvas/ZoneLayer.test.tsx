import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { Point, Zone } from '../../types';
import { useStore } from '../../state/store';
import ZoneLayer from './ZoneLayer';

const captured = vi.hoisted(() => ({ circles: [] as Array<Record<string, unknown>> }));

vi.mock('konva', () => ({
  default: { Animation: class { start() {} stop() {} } },
}));

vi.mock('react-konva', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    Circle: (props: Record<string, unknown>) => {
      captured.circles.push(props);
      return null;
    },
    Group: ({ children }: { children?: ReactNode }) => children,
    Layer: ({ children }: { children?: ReactNode }) => children,
    Line: React.forwardRef(() => null),
  };
});

const zone: Zone = {
  id: 'zone-1', name: 'Zone 1', color: '#3498db',
  polygon: { points: [
    { x: 0, y: 0 }, { x: 4000, y: 0 },
    { x: 4000, y: 2000 }, { x: 0, y: 2000 },
  ] },
  spacingMm: 150, paddingMm: 100,
  connectionCorner: 'bottom-left', startDirection: 'vertical',
  spiral: null, spiralLengthMm: 0, leaderLengthMm: 0, areaMm2: 8_000_000,
  leaderWaypoints: null, manifoldPortOffsetMm: null,
};

type FakeNode = {
  x: () => number;
  y: () => number;
  position: (point: Point) => void;
};
type DragEvent = { target: FakeNode; evt: { shiftKey: boolean }; cancelBubble?: boolean };
type CircleProps = {
  x: number;
  y: number;
  onDragStart: (event: DragEvent) => void;
  onDragMove: (event: DragEvent) => void;
  onDragEnd: (event: DragEvent) => void;
};

function cornerProps(count = 4): CircleProps {
  return captured.circles.slice(-count)[2] as unknown as CircleProps;
}

describe('rectangle corner drag', () => {
  it('applies and removes the aspect constraint when Shift changes without pointer movement', () => {
    captured.circles.length = 0;
    act(() => useStore.setState({ zones: [zone], manifold: null }));
    render(<ZoneLayer zones={[zone]} selectedZoneId={zone.id} toolMode="editBoundary" pxPerMm={0.1} onCursorChange={() => {}} />);

    let x = 4000;
    let y = 2000;
    const node: FakeNode = {
      x: () => x,
      y: () => y,
      position: (point) => { x = point.x; y = point.y; },
    };
    act(() => cornerProps().onDragStart({ target: node, evt: { shiftKey: false } }));
    node.position({ x: 5000, y: 2000 });
    act(() => cornerProps().onDragMove({ target: node, evt: { shiftKey: false } }));
    expect([cornerProps().x, cornerProps().y]).toEqual([5000, 2000]);

    act(() => fireEvent.keyDown(window, { key: 'Shift', shiftKey: true }));
    expect([cornerProps().x, cornerProps().y]).toEqual([4800, 2400]);

    node.position({ x: 5400, y: 2000 });
    act(() => cornerProps().onDragMove({ target: node, evt: { shiftKey: true } }));
    expect([cornerProps().x, cornerProps().y]).toEqual([5120, 2560]);

    act(() => fireEvent.keyUp(window, { key: 'Shift', shiftKey: false }));
    expect([cornerProps().x, cornerProps().y]).toEqual([5400, 2000]);

    act(() => fireEvent.keyDown(window, { key: 'Shift', shiftKey: true }));
    act(() => cornerProps().onDragEnd({ target: node, evt: { shiftKey: true } }));
    expect(useStore.getState().zones[0].polygon.points[2]).toEqual({ x: 5120, y: 2560 });
  });

  it('scales the whole polygon when Shift is pressed during a corner drag', () => {
    captured.circles.length = 0;
    const polygon: Zone = { ...zone, polygon: { points: [
      { x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 5000, y: 2000 },
      { x: 3000, y: 4000 }, { x: 0, y: 3000 },
    ] } };
    act(() => useStore.setState({ zones: [polygon], manifold: null }));
    render(<ZoneLayer zones={[polygon]} selectedZoneId={polygon.id} toolMode="editBoundary" pxPerMm={0.1} onCursorChange={() => {}} />);

    let x = 5000;
    let y = 2000;
    const node: FakeNode = {
      x: () => x,
      y: () => y,
      position: (point) => { x = point.x; y = point.y; },
    };
    act(() => cornerProps(5).onDragStart({ target: node, evt: { shiftKey: false } }));
    node.position({ x: 10000, y: 4000 });
    act(() => cornerProps(5).onDragMove({ target: node, evt: { shiftKey: false } }));
    expect(captured.circles.slice(-5)[1].x).toBe(4000);

    act(() => fireEvent.keyDown(window, { key: 'Shift', shiftKey: true }));
    expect(captured.circles.slice(-5)[1].x).toBe(8000);
    expect(captured.circles.slice(-5)[3].y).toBe(8000);

    act(() => fireEvent.keyUp(window, { key: 'Shift', shiftKey: false }));
    expect(captured.circles.slice(-5)[1].x).toBe(4000);
    expect(captured.circles.slice(-5)[3].y).toBe(4000);

    act(() => fireEvent.keyDown(window, { key: 'Shift', shiftKey: true }));
    act(() => cornerProps(5).onDragEnd({ target: node, evt: { shiftKey: true } }));
    expect(useStore.getState().zones[0].polygon.points).toEqual(
      polygon.polygon.points.map((point) => ({ x: point.x * 2, y: point.y * 2 })),
    );
    expect(useStore.getState().zones[0].areaMm2).toBeGreaterThan(polygon.areaMm2);
    expect(useStore.getState().zones[0].spiralLengthMm).toBeGreaterThan(0);
  });
});
