/**
 * Where a floating panel sits, and the rules that keep it reachable.
 *
 * Pure so the arithmetic can be tested without synthesising pointer gestures:
 * the component below is then only wiring.
 */
export interface PanelGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_PANEL_WIDTH = 320;
export const MIN_PANEL_HEIGHT = 240;
const DEFAULT_WIDTH = 460;
const DEFAULT_HEIGHT = 560;

/**
 * How much of the panel must stay on screen. Dragging a panel mostly off the
 * edge is a legitimate way to park it, but its header — which carries the
 * dock and close controls — has to remain grabbable, or the only way back is
 * clearing the URL.
 */
const MIN_VISIBLE_X = 120;
const HEADER_HEIGHT = 44;

export interface Viewport {
  width: number;
  height: number;
}

/**
 * A new panel's box: near the top-left of the content, stepped per already-open
 * panel so a second detach does not land exactly on the first.
 */
export function defaultGeometry(index: number, viewport: Viewport): PanelGeometry {
  const step = 28 * index;
  return clampGeometry(
    {
      x: 96 + step,
      y: 96 + step,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
    },
    viewport,
  );
}

export function clampGeometry(geometry: PanelGeometry, viewport: Viewport): PanelGeometry {
  const width = clamp(geometry.width, MIN_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, viewport.width));
  const height = clamp(
    geometry.height,
    MIN_PANEL_HEIGHT,
    Math.max(MIN_PANEL_HEIGHT, viewport.height),
  );
  return {
    width,
    height,
    x: clamp(geometry.x, MIN_VISIBLE_X - width, Math.max(0, viewport.width - MIN_VISIBLE_X)),
    // Never above the top: a panel whose header is off the top edge cannot be
    // dragged back at all. Below, the header is enough.
    y: clamp(geometry.y, 0, Math.max(0, viewport.height - HEADER_HEIGHT)),
  };
}

export function moveGeometry(
  geometry: PanelGeometry,
  delta: { x: number; y: number },
  viewport: Viewport,
): PanelGeometry {
  return clampGeometry({ ...geometry, x: geometry.x + delta.x, y: geometry.y + delta.y }, viewport);
}

export function resizeGeometry(
  geometry: PanelGeometry,
  delta: { x: number; y: number },
  viewport: Viewport,
): PanelGeometry {
  return clampGeometry(
    { ...geometry, width: geometry.width + delta.x, height: geometry.height + delta.y },
    viewport,
  );
}

/**
 * Stored geometry is user-writable (it is only sessionStorage), and a panel
 * positioned from a malformed record would be unreachable, so every field has
 * to be a real number before it is trusted.
 */
export function parseGeometry(raw: string | null): PanelGeometry | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as Record<string, unknown>;
    const values = ['x', 'y', 'width', 'height'].map((key) => candidate[key]);
    if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) return null;
    const [x, y, width, height] = values as number[];
    return { x, y, width, height };
  } catch {
    // Malformed storage is not worth a log line: the panel just opens where a
    // new one would.
    return null;
  }
}

export const geometryStorageKey = (txid: string): string => `sanctuary_tx_panel_${txid}`;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
