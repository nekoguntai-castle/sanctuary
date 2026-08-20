import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Track an element's own rendered width.
 *
 * Used where a layout decision depends on how much room the component actually
 * got rather than how wide the viewport is — a component that renders both full
 * width and inside a narrower column cannot tell those apart from a media
 * query, and `src/index.html` loads the Tailwind CDN build, whose JIT emits
 * `@container` and arbitrary utilities only after first paint.
 *
 * Returns `null` until the first measurement, so callers can keep their wider
 * layout rather than flashing a narrow one. The measurement runs in a layout
 * effect, so in practice `null` is never painted.
 */
export function useElementWidth(ref: RefObject<Element | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);

  const measure = useCallback(() => {
    const element = ref.current;
    /* v8 ignore next -- the observer below can fire after unmount. */
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
  }, [ref]);

  useLayoutEffect(() => {
    measure();

    // A window resize is not the only thing that changes an element's width:
    // a sibling collapsing, a sidebar opening or the element being revealed all
    // resize it without resizing the window. Both are wired, as elsewhere in
    // this codebase (NetworkTabs, TransactionList): the observer carries the
    // element-level changes, and the window listener still measures where no
    // ResizeObserver exists. A duplicate measurement is a no-op — the width is
    // unchanged, so React bails out of the re-render.
    const observer =
      typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    const element = ref.current;
    if (element) observer?.observe(element);
    window.addEventListener('resize', measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure, ref]);

  return width;
}
