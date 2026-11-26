/**
 * Ref-counted body scroll lock helper for modals and drawers.
 *
 * Prevents overlapping overlays from prematurely restoring `document.body.style.overflow`
 * when one closes while another is still open.
 */

let activeLocks = 0;
let previousOverflow = '';

export function lockBodyScroll(): () => void {
  if (activeLocks === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  activeLocks += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeLocks -= 1;
    if (activeLocks === 0) {
      document.body.style.overflow = previousOverflow;
    }
  };
}
