import React, { useId, useRef, useState } from 'react';
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

const PLACEMENT_CLASSES = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
} as const;

const ARROW_CLASSES = {
  top: 'tooltip-arrow tooltip-arrow-centered -bottom-1 border-b border-r',
  bottom: 'tooltip-arrow tooltip-arrow-centered -top-1 border-t border-l',
} as const;

/**
 * A tooltip whose content is reachable by keyboard and touch.
 *
 * The native `title=` it replaces sat on non-interactive `<span>`s: no tab
 * stop, no tap target, so on a phone or with a keyboard the failure reason was
 * simply unreadable. Here the trigger is a real `<button>` carrying
 * `aria-describedby`, opened by focus or tap and dismissed by Escape or an
 * outside click through the shared `useDismissable` hook.
 *
 * Presentation reuses the `.tooltip-popup` / `.tooltip-arrow` rules in
 * `src/index.html`, driven by the controlled `.tooltip-visible` class — the
 * stylesheet's `:hover` selectors alone cannot express focus or tap.
 */
export const Tooltip: React.FC<TooltipProps> = ({
  content,
  label,
  placement = 'top',
  className = '',
  children,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  /** Set by a pointer press so the focus it causes does not double-handle. */
  const pointerDriven = useRef(false);
  const popupId = useId();

  useDismissable(isOpen, rootRef, () => setIsOpen(false));

  if (!content) {
    return <>{children}</>;
  }

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
        className={`inline-flex items-center cursor-help rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${className}`}
      >
        {children}
      </button>
      <span
        id={popupId}
        role="tooltip"
        data-testid="tooltip-popup"
        className={`tooltip-popup whitespace-normal max-w-xs text-left ${PLACEMENT_CLASSES[placement]} ${
          isOpen ? 'tooltip-visible' : ''
        }`}
      >
        <span className={ARROW_CLASSES[placement]} />
        {content}
      </span>
    </span>
  );
};
