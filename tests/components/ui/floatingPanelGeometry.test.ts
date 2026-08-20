import { describe, expect, it } from 'vitest';
import {
  MIN_PANEL_HEIGHT,
  MIN_PANEL_WIDTH,
  clampGeometry,
  defaultGeometry,
  geometryStorageKey,
  moveGeometry,
  parseGeometry,
  resizeGeometry,
} from '../../../src/components/ui/floatingPanelGeometry';

const VIEWPORT = { width: 1280, height: 800 };
const box = { x: 100, y: 100, width: 460, height: 560 };

describe('floating panel geometry', () => {
  describe('defaultGeometry', () => {
    it('steps each new panel off the last, so a second detach is visible', () => {
      const first = defaultGeometry(0, VIEWPORT);
      const second = defaultGeometry(1, VIEWPORT);

      expect(second.x).toBeGreaterThan(first.x);
      expect(second.y).toBeGreaterThan(first.y);
    });

    it('fits the panel to a small viewport rather than cascading off it', () => {
      const geometry = defaultGeometry(6, { width: 700, height: 500 });

      expect(geometry.width).toBeLessThanOrEqual(700);
      expect(geometry.height).toBeLessThanOrEqual(500);
      expect(geometry.x).toBeLessThanOrEqual(700);
    });
  });

  describe('clampGeometry', () => {
    it('keeps a strip of the panel on screen when dragged off the right', () => {
      // The header carries the dock and close controls; a panel entirely off
      // screen can only be recovered by editing the URL.
      const geometry = clampGeometry({ ...box, x: 5000 }, VIEWPORT);

      expect(geometry.x).toBe(VIEWPORT.width - 120);
    });

    it('keeps a strip on screen when dragged off the left', () => {
      const geometry = clampGeometry({ ...box, x: -5000 }, VIEWPORT);

      expect(geometry.x).toBe(120 - box.width);
    });

    it('never lets the header leave the top edge', () => {
      // Off the top there is nothing left to grab at all.
      expect(clampGeometry({ ...box, y: -400 }, VIEWPORT).y).toBe(0);
    });

    it('leaves the header reachable at the bottom edge', () => {
      expect(clampGeometry({ ...box, y: 5000 }, VIEWPORT).y).toBe(VIEWPORT.height - 44);
    });

    it('holds a minimum size, and never exceeds the viewport', () => {
      const tiny = clampGeometry({ ...box, width: 10, height: 10 }, VIEWPORT);
      expect(tiny.width).toBe(MIN_PANEL_WIDTH);
      expect(tiny.height).toBe(MIN_PANEL_HEIGHT);

      const huge = clampGeometry({ ...box, width: 9000, height: 9000 }, VIEWPORT);
      expect(huge.width).toBe(VIEWPORT.width);
      expect(huge.height).toBe(VIEWPORT.height);
    });

    it('keeps the minimum size even in a viewport smaller than it', () => {
      // A phone-sized window would otherwise clamp the panel to nothing.
      const geometry = clampGeometry(box, { width: 200, height: 150 });

      expect(geometry.width).toBe(MIN_PANEL_WIDTH);
      expect(geometry.height).toBe(MIN_PANEL_HEIGHT);
    });

    it('leaves a box that is already inside alone', () => {
      expect(clampGeometry(box, VIEWPORT)).toEqual(box);
    });
  });

  it('moves by a delta, still clamped', () => {
    expect(moveGeometry(box, { x: 40, y: -30 }, VIEWPORT)).toMatchObject({ x: 140, y: 70 });
    expect(moveGeometry(box, { x: 0, y: -500 }, VIEWPORT).y).toBe(0);
  });

  it('resizes by a delta, still clamped', () => {
    expect(resizeGeometry(box, { x: 60, y: 40 }, VIEWPORT)).toMatchObject({
      width: 520,
      height: 600,
    });
    expect(resizeGeometry(box, { x: -900, y: -900 }, VIEWPORT)).toMatchObject({
      width: MIN_PANEL_WIDTH,
      height: MIN_PANEL_HEIGHT,
    });
  });

  describe('parseGeometry', () => {
    it('reads a stored box', () => {
      expect(parseGeometry(JSON.stringify(box))).toEqual(box);
    });

    it('rejects anything that would position a panel out of reach', () => {
      // sessionStorage is user-writable, and a NaN left/top puts the panel
      // somewhere no pointer can follow.
      expect(parseGeometry(null)).toBeNull();
      expect(parseGeometry('')).toBeNull();
      expect(parseGeometry('not json')).toBeNull();
      expect(parseGeometry('null')).toBeNull();
      expect(parseGeometry('[1,2,3]')).toBeNull();
      expect(parseGeometry(JSON.stringify({ ...box, x: 'left' }))).toBeNull();
      expect(parseGeometry(JSON.stringify({ ...box, y: NaN }))).toBeNull();
      expect(parseGeometry(JSON.stringify({ x: 1, y: 2 }))).toBeNull();
    });
  });

  it('scopes storage per transaction', () => {
    expect(geometryStorageKey('abc')).not.toBe(geometryStorageKey('def'));
  });
});
