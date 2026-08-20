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
