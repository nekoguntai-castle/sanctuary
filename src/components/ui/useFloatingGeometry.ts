import { useCallback, useEffect, useRef, useState } from 'react';
import { createLogger } from '../../utils/logger';
import {
  clampGeometry,
  defaultGeometry,
  geometryStorageKey,
  parseGeometry,
  type PanelGeometry,
} from './floatingPanelGeometry';

const log = createLogger('FloatingPanel');

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

/**
 * A floating panel's box, remembered per transaction for the session.
 *
 * `sessionStorage`, not the URL: where someone dragged a panel is a property of
 * their window, not of what they would share. Not `localStorage` either — a
 * position chosen on a large monitor should not follow the user to a laptop
 * weeks later, and the clamp on load only guarantees reachability, not that the
 * placement still makes sense.
 */
export function useFloatingGeometry(storageId: string, index: number) {
  const [geometry, setGeometry] = useState<PanelGeometry>(() => {
    const stored = parseGeometry(readStorage(geometryStorageKey(storageId)));
    return stored ? clampGeometry(stored, viewport()) : defaultGeometry(index, viewport());
  });
  const geometryRef = useRef(geometry);

  const commit = useCallback((next: PanelGeometry) => {
    geometryRef.current = next;
    setGeometry(next);
    writeStorage(geometryStorageKey(storageId), JSON.stringify(next));
  }, [storageId]);

  /** Apply a transform to the current box — pointer moves arrive faster than renders. */
  const update = useCallback((
    transform: (current: PanelGeometry, bounds: { width: number; height: number }) => PanelGeometry,
  ) => {
    commit(transform(geometryRef.current, viewport()));
  }, [commit]);

  // A window that shrinks can strand a panel outside it, so the same clamp that
  // guards stored geometry runs again whenever the viewport changes.
  useEffect(() => {
    const onResize = () => {
      const clamped = clampGeometry(geometryRef.current, viewport());
      if (
        clamped.x === geometryRef.current.x
        && clamped.y === geometryRef.current.y
        && clamped.width === geometryRef.current.width
        && clamped.height === geometryRef.current.height
      ) return;
      commit(clamped);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [commit]);

  return { geometry, update };
}

function readStorage(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch (error) {
    // Storage can be unavailable outright (private modes, embedded webviews).
    // A panel that opens in the default place is a better answer than a crash.
    log.debug('Could not read stored panel geometry', { error });
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch (error) {
    // Quota or a disabled store: the panel still works, it just won't be where
    // it was left after a reload.
    log.debug('Could not store panel geometry', { error });
  }
}
