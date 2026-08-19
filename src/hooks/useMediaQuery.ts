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
 * The width at which the transaction list can afford a side-by-side detail pane.
 *
 * Below this the pane leaves the table too narrow to scan: on the wallet route the
 * sidebar takes 256px from `lg` up and the content is padded 64px, so a 448px pane
 * leaves the table 496px at 1280px wide and only 368px at 1024px. At 1536px the table
 * clears 750px, which is where both halves are genuinely readable.
 */
export const SIDE_BY_SIDE_DETAIL_QUERY = '(min-width: 1536px)';
