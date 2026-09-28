import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { useStore } from './state/store';

vi.mock('./components/Canvas', () => ({ default: () => null }));
vi.mock('./components/SidePanel', () => ({ default: () => null }));
vi.mock('./components/TopToolbar', () => ({ default: () => null }));

describe('Escape cancels the current canvas action', () => {
  beforeEach(() => {
    window.localStorage.clear();
    act(() => useStore.setState({
      toolMode: 'select',
      drawingPoints: [],
      drawRectStart: null,
      routing: null,
      calibration: { active: false, point1: null, point2: null },
      measurement: { start: null, end: null },
    }));
  });

  it('discards an unfinished polygon', () => {
    act(() => useStore.setState({
      toolMode: 'drawZone',
      drawingPoints: [{ x: 10, y: 20 }, { x: 30, y: 40 }],
    }));
    render(<App />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(useStore.getState()).toMatchObject({ toolMode: 'select', drawingPoints: [] });
  });

  it('discards the first rectangle corner', () => {
    act(() => useStore.setState({ toolMode: 'drawRect', drawRectStart: { x: 10, y: 20 } }));
    render(<App />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(useStore.getState()).toMatchObject({ toolMode: 'select', drawRectStart: null });
  });

  it('discards calibration points', () => {
    act(() => useStore.setState({
      calibration: { active: true, point1: { x: 10, y: 20 }, point2: null },
    }));
    render(<App />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(useStore.getState().calibration).toEqual({ active: false, point1: null, point2: null });
  });
});
