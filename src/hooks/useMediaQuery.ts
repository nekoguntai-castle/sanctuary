import { useEffect, useState } from 'react';

/**
 * Subscribe to a CSS media query from JavaScript.
 *
 * Used where a breakpoint changes *what* is rendered rather than how it looks. Tailwind
 * variants cannot express that: switching between two DOM positions with CSS alone means
 * rendering the content twice and hiding one copy, which duplicates accessible content and
 * doubles any data fetch inside it.
 *
 * Returns `false` until the first effect runs, so server/initial render is the narrow
 * layout and widening is the enhancement.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia(query);
    setMatches(mediaQuery.matches);

    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    mediaQuery.addEventListener('change', onChange);
    return () => mediaQuery.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/**
 * The width at which a detached transaction panel can float somewhere useful.
 *
 * Matches the `tablet` breakpoint (900px). Narrower than that, a panel wide
 * enough to read covers the list it was detached to sit beside, which is the
 * whole point of detaching it.
 */
export const FLOATING_PANEL_QUERY = '(min-width: 900px)';
