import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDismissable } from '../../hooks/useDismissable';

interface TooltipProps {
  /** The explanation. Nothing is rendered around the children when it is empty. */
  content: string | null | undefined;
  /** Accessible name for the trigger, e.g. "Sync failure detail". */
  label: string;
  /** Where the popup sits relative to the trigger. */
  placement?: 'top' | 'bottom';
  /** Extra classes for the trigger element. */
  className?: string;
  children: React.ReactNode;
}

/** Gap between the trigger and the popup, matching the old `mb-2`/`mt-2`. */
const OFFSET_PX = 8;

/** Keeps the popup off the viewport edge when a trigger sits near one. */
const VIEWPORT_MARGIN_PX = 8;

const ARROW_CLASSES = {
  top: 'tooltip-arrow tooltip-arrow-centered -bottom-1 border-b border-r',
  bottom: 'tooltip-arrow tooltip-arrow-centered -top-1 border-t border-l',
} as const;

interface Position {
  left: number;
  top: number;
}

/**
 * A tooltip whose content is reachable by keyboard and touch, and which is not
 * clipped by whatever card it happens to sit in.
 *
 * The native `title=` it replaces sat on non-interactive `<span>`s: no tab
 * stop, no tap target, so on a phone or with a keyboard the failure reason was
 * simply unreadable. Here the trigger is a real `<button>` carrying
 * `aria-describedby`, opened by hover, focus or tap and dismissed by Escape or
 * an outside click through the shared `useDismissable` hook.
 *
 * The popup is PORTALLED to `document.body` and positioned `fixed` from the
 * trigger's rect. As an absolutely-positioned sibling it was clipped at every
 * consumer: `WalletGridCard` and the wallet-detail `Card` are both
 * `overflow-hidden`, and `TableShell` is `overflow-hidden` plus
 * `overflow-x-auto` — and `overflow-x: auto` forces the used value of
 * `overflow-y` to `auto`, so it clips vertically whether or not the table
 * actually overflows. `card-interactive:hover` additionally applies a
 * `transform`, which creates a stacking context that traps `z-index: 50` inside
 * the card. Removing `overflow-hidden` from the cards would not have fixed the
 * table, whose horizontal scrolling is load-bearing.
 *
 * Because the popup no longer descends from the trigger, the stylesheet's
 * `.tooltip-trigger:hover .tooltip-popup` rule cannot reach it — hover is
 * handled here instead. Presentation still reuses `.tooltip-popup` /
 * `.tooltip-arrow` from `src/index.html`; `dark` lives on
 * `document.documentElement`, so `html.dark .tooltip-popup` still matches from
 * inside the portal.
 */
export const Tooltip: React.FC<TooltipProps> = ({
  content,
  label,
  placement = 'top',
  className = '',
  children,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  // Not gated behind visibility: the stylesheet keeps the popup at opacity 0
  // with pointer-events none until `.tooltip-visible`, and hiding it with
  // `visibility` would also drop it out of the accessibility tree, breaking the
  // `aria-describedby` the trigger always advertises.
  const [position, setPosition] = useState<Position | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const popupRef = useRef<HTMLSpanElement>(null);
  /** Set by a pointer press so the focus it causes does not double-handle. */
  const pointerDriven = useRef(false);
  const popupId = useId();

  useDismissable(isOpen, rootRef, () => setIsOpen(false));

  const reposition = useCallback(() => {
    const trigger = rootRef.current;
    const popupElement = popupRef.current;
    /* v8 ignore next -- reposition only runs while open, and both the layout
       effect and the scroll/resize listeners are torn down before either ref
       clears; the popup is rendered in the same commit as the trigger */
    if (!trigger || !popupElement) return;
    const rect = trigger.getBoundingClientRect();
    const popupWidth = popupElement.offsetWidth;
    const half = popupWidth / 2;

    // Clamp so a trigger near the viewport edge does not push the popup off it.
    // Only meaningful once the popup has been measured; before that the
    // unclamped centre is correct.
    let left = rect.left + rect.width / 2;
    if (popupWidth > 0) {
      const min = VIEWPORT_MARGIN_PX + half;
      const max = window.innerWidth - VIEWPORT_MARGIN_PX - half;
      if (max > min) left = Math.min(Math.max(left, min), max);
    }

    setPosition({
      left,
      top: placement === 'top' ? rect.top - OFFSET_PX : rect.bottom + OFFSET_PX,
    });
  }, [placement]);

  // Measure before paint so the popup never appears at a stale position.
  useLayoutEffect(() => {
    if (!isOpen) return;
    reposition();
  }, [isOpen, reposition]);

  useEffect(() => {
    if (!isOpen) return;
    // `capture` so a scroll inside any ancestor - the table's own
    // `overflow-x-auto` container included - is seen, not just window scroll.
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [isOpen, reposition]);

  if (!content) {
    return <>{children}</>;
  }

  const popup = (
    <span
      ref={popupRef}
      id={popupId}
      role="tooltip"
      data-testid="tooltip-popup"
      data-placement={placement}
      className={`tooltip-popup tooltip-portal max-w-xs text-left ${isOpen ? 'tooltip-visible' : ''}`}
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        // Composes with the stylesheet's animated `translate` property rather
        // than overwriting it - writing `transform` from both places is how the
        // popup once landed half its own width to the right of its trigger.
        transform: placement === 'top' ? 'translate(-50%, -100%)' : 'translateX(-50%)',
      }}
    >
      <span className={ARROW_CLASSES[placement]} />
      {content}
    </span>
  );

  return (
    <span ref={rootRef} className="relative inline-flex tooltip-trigger">
      <button
        type="button"
        aria-label={label}
        aria-describedby={popupId}
        aria-expanded={isOpen}
        // A tap toggles; keyboard focus reveals. The browser fires focus BEFORE
        // click, so letting both run would open on focus and immediately close
        // on click — the first tap would show nothing at all. The pointer flag
        // lets the focus handler stand down for pointer-driven focus only.
        onPointerDown={() => {
          pointerDriven.current = true;
          setIsOpen((open) => !open);
        }}
        onFocus={() => {
          if (pointerDriven.current) {
            pointerDriven.current = false;
            return;
          }
          setIsOpen(true);
        }}
        onBlur={() => {
          pointerDriven.current = false;
          setIsOpen(false);
        }}
        // Hover is no longer expressible in CSS: the portalled popup is not a
        // descendant of `.tooltip-trigger`.
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
        className={`inline-flex items-center cursor-help rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${className}`}
      >
        {children}
      </button>
      {createPortal(popup, document.body)}
    </span>
  );
};
