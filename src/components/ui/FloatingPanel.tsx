import { useCallback, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PanelBottomClose, X } from 'lucide-react';
import { useFloatingGeometry } from './useFloatingGeometry';
import { moveGeometry, resizeGeometry } from './floatingPanelGeometry';

interface FloatingPanelProps {
  /** Remembers this panel's box across the session, and keys its stacking. */
  storageId: string;
  /** Position in the stack; also the cascade step for a panel with no stored box. */
  index: number;
  title: string;
  /** Accessible name, where the visible title is abbreviated. */
  label: string;
  onDock: () => void;
  onClose: () => void;
  /**
   * Where the pointer is during a header drag, for a drop target to react to.
   * `null` once the gesture is over, so the target can drop its highlight.
   */
  onDragMove?: (point: { x: number; y: number } | null) => void;
  /** The header drag ended here. Returning true means a drop target took it. */
  onDragEnd?: (point: { x: number; y: number }) => boolean;
  children: ReactNode;
}

/** How far the arrow keys move a panel, for anyone not using a pointer. */
const KEYBOARD_STEP = 24;

/**
 * A panel that floats over the app, dragged by its header and resized from its
 * corner.
 *
 * Not `window.open`: a real window loses the app's styles and state, is at the
 * mercy of popup blockers, and — the point of the feature — cannot be dragged
 * back into the tab strip.
 *
 * Deliberately not modal. The whole reason to detach a transaction is to read
 * it *while* working the list behind it, so there is no backdrop, no focus trap
 * and no inert background.
 */
export function FloatingPanel({
  storageId,
  index,
  title,
  label,
  onDock,
  onClose,
  onDragMove,
  onDragEnd,
  children,
}: FloatingPanelProps) {
  const { geometry, update } = useFloatingGeometry(storageId, index);
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null);
  const lastPointRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const movedRef = useRef(false);

  const startGesture = useCallback((
    event: ReactPointerEvent<HTMLElement>,
    apply: (delta: { x: number; y: number }) => void,
    report?: {
      move: (point: { x: number; y: number }) => void;
      end: (point: { x: number; y: number }) => void;
    },
  ) => {
    // Only the primary button drags; a right-click on the header should be able
    // to reach a context menu.
    if (event.button !== 0) return;
    // The dock and close controls live inside the header and their pointerdown
    // bubbles to it. Without this guard, clicking one starts a drag that ends
    // wherever the click was — and over the strip that docked the panel instead
    // of closing it.
    if (event.target !== event.currentTarget
      && (event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    const target = event.currentTarget;
    // Optional throughout: pointer capture is an enhancement that keeps the
    // gesture alive when the pointer outruns the element, and not every
    // environment implements it. Losing it costs a smoother drag, not the drag.
    target.setPointerCapture?.(event.pointerId);
    dragOriginRef.current = { x: event.clientX, y: event.clientY };
    lastPointRef.current = { x: event.clientX, y: event.clientY };
    movedRef.current = false;

    const onMove = (moveEvent: PointerEvent) => {
      const origin = dragOriginRef.current;
      /* v8 ignore next -- capture guarantees an origin for every move we receive. */
      if (!origin) return;
      apply({ x: moveEvent.clientX - origin.x, y: moveEvent.clientY - origin.y });
      dragOriginRef.current = { x: moveEvent.clientX, y: moveEvent.clientY };
      lastPointRef.current = { x: moveEvent.clientX, y: moveEvent.clientY };
      movedRef.current = true;
      report?.move(lastPointRef.current);
    };
    const finish = () => {
      dragOriginRef.current = null;
      target.releasePointerCapture?.(event.pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onCancel);
    };
    // Only a completed gesture that actually moved is a drop. A cancelled one —
    // the pointer left the window, or the OS took over — must not dock the panel
    // somewhere the user never released it, and neither must a plain click on
    // the header, which is how a keyboard user focuses it: over the strip, that
    // click would otherwise dock the panel out from under them.
    const onUp = () => {
      if (movedRef.current) report?.end(lastPointRef.current);
      finish();
    };
    const onCancel = () => finish();

    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onCancel);
  }, []);

  const onHeaderPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    lastPointRef.current = { x: event.clientX, y: event.clientY };
    startGesture(
      event,
      (delta) => update((current, bounds) => moveGeometry(current, delta, bounds)),
      {
        move: (point) => onDragMove?.(point),
        end: (point) => {
          // A drop target that takes the panel replaces it — docking unmounts
          // this component — so nothing more is done with the gesture here.
          onDragEnd?.(point);
          onDragMove?.(null);
        },
      },
    );
  }, [onDragEnd, onDragMove, startGesture, update]);

  const onResizePointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    startGesture(event, (delta) => update((current, bounds) => resizeGeometry(current, delta, bounds)));
  }, [startGesture, update]);

  const onHeaderKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    const delta = KEYBOARD_DELTAS[event.key];
    if (!delta) return;
    event.preventDefault();
    update((current, bounds) => moveGeometry(current, delta, bounds));
  }, [update]);

  return createPortal(
    <section
      role="dialog"
      aria-label={label}
      data-testid="floating-panel"
      data-storage-id={storageId}
      className="fixed z-40 flex flex-col surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 shadow-2xl overflow-hidden"
      style={{
        left: geometry.x,
        top: geometry.y,
        width: geometry.width,
        height: geometry.height,
        // Stacking follows the raise order rather than the DOM order, so
        // clicking a panel's tab brings it to the front.
        zIndex: 40 + index,
      }}
    >
      <header
        data-testid="floating-panel-header"
        onPointerDown={onHeaderPointerDown}
        onKeyDown={onHeaderKeyDown}
        tabIndex={0}
        aria-label={`Move ${label}`}
        className="flex items-center justify-between gap-2 px-3 py-2 border-b border-sanctuary-200 dark:border-sanctuary-800 cursor-move touch-none select-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <span className="truncate text-sm font-medium text-sanctuary-900 dark:text-sanctuary-50">
          {title}
        </span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            aria-label={`Dock ${label}`}
            onClick={onDock}
            className="rounded p-1 text-sanctuary-500 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 hover:text-sanctuary-700 dark:hover:text-sanctuary-200 transition-colors focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <PanelBottomClose className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label={`Close ${label}`}
            onClick={onClose}
            className="rounded p-1 text-sanctuary-500 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 hover:text-sanctuary-700 dark:hover:text-sanctuary-200 transition-colors focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <X className="w-4 h-4" />
          </button>
        </span>
      </header>

      <div className="flex-1 overflow-y-auto">{children}</div>

      <button
        type="button"
        data-testid="floating-panel-resize"
        aria-label={`Resize ${label}`}
        onPointerDown={onResizePointerDown}
        className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize touch-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <span
          aria-hidden="true"
          className="block h-2 w-2 m-1 border-b-2 border-r-2 border-sanctuary-400 dark:border-sanctuary-600"
        />
      </button>
    </section>,
    document.body,
  );
}

const KEYBOARD_DELTAS: Record<string, { x: number; y: number } | undefined> = {
  ArrowLeft: { x: -KEYBOARD_STEP, y: 0 },
  ArrowRight: { x: KEYBOARD_STEP, y: 0 },
  ArrowUp: { x: 0, y: -KEYBOARD_STEP },
  ArrowDown: { x: 0, y: KEYBOARD_STEP },
};
