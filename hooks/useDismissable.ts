import { useEffect, type RefObject } from 'react';

/**
 * Close an open overlay when the user clicks outside of it (mousedown) or
 * presses Escape. Each effect early-returns while the overlay is closed so no
 * listeners are attached, and both listeners are removed on unmount.
 *
 * Lifted verbatim from the original ColumnConfigButton dismissal hook so that
 * multiple overlays (the column-config dropdown, the queued-summary tooltip,
 * the label selector, ...) share one tested implementation. The ref type is
 * widened from `HTMLDivElement` to `HTMLElement` so any trigger element can
 * consume it.
 */
export function useDismissable(
  isOpen: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [containerRef, isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);
}
