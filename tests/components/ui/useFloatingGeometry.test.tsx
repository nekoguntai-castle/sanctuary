import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFloatingGeometry } from '../../../src/components/ui/useFloatingGeometry';
import { geometryStorageKey } from '../../../src/components/ui/floatingPanelGeometry';

const STORAGE_ID = 'txid-1';

function Probe({ index = 0 }: { index?: number }) {
  const { geometry, update } = useFloatingGeometry(STORAGE_ID, index);
  return (
    <button
      data-testid="probe"
      data-geometry={JSON.stringify(geometry)}
      onClick={() =>
        update((current, bounds) => ({
          ...current,
          x: Math.min(current.x + 50, bounds.width),
        }))
      }
    />
  );
}

const geometry = () =>
  JSON.parse(screen.getByTestId('probe').getAttribute('data-geometry')!);

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

describe('useFloatingGeometry', () => {
  const originalWidth = window.innerWidth;
  const originalHeight = window.innerHeight;

  beforeEach(() => {
    window.sessionStorage.clear();
    setViewport(1280, 800);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setViewport(originalWidth, originalHeight);
  });

  it('opens where a new panel goes when nothing is stored', () => {
    render(<Probe index={1} />);

    expect(geometry()).toMatchObject({ x: 124, y: 124 });
  });

  it('reopens where the panel was left', () => {
    window.sessionStorage.setItem(
      geometryStorageKey(STORAGE_ID),
      JSON.stringify({ x: 300, y: 200, width: 500, height: 400 }),
    );

    render(<Probe />);

    expect(geometry()).toEqual({ x: 300, y: 200, width: 500, height: 400 });
  });

  it('pulls a stored box back into a window that has since shrunk', () => {
    window.sessionStorage.setItem(
      geometryStorageKey(STORAGE_ID),
      JSON.stringify({ x: 2400, y: 1800, width: 500, height: 400 }),
    );

    render(<Probe />);

    expect(geometry().x).toBeLessThanOrEqual(1280);
    expect(geometry().y).toBeLessThanOrEqual(800);
  });

  it('persists a move, so it survives a remount', () => {
    const { unmount } = render(<Probe />);
    act(() => screen.getByTestId('probe').click());
    const moved = geometry();
    unmount();

    render(<Probe />);

    expect(geometry()).toEqual(moved);
  });

  it('re-clamps when the window shrinks under a panel', () => {
    render(<Probe />);
    const before = geometry();

    setViewport(400, 300);
    act(() => window.dispatchEvent(new Event('resize')));

    expect(geometry()).not.toEqual(before);
    expect(geometry().width).toBeLessThanOrEqual(400);
  });

  it('leaves a panel alone when a resize does not strand it', () => {
    render(<Probe />);
    const before = geometry();

    setViewport(1600, 900);
    act(() => window.dispatchEvent(new Event('resize')));

    expect(geometry()).toEqual(before);
  });

  it('still opens where storage is unavailable', () => {
    // Private modes and embedded webviews can throw on any access at all; a
    // default position beats a crash.
    vi.spyOn(window.sessionStorage.__proto__, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(window.sessionStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });

    render(<Probe />);
    act(() => screen.getByTestId('probe').click());

    expect(geometry()).toMatchObject({ x: 146 });
  });
});
