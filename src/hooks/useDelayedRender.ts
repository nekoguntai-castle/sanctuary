import { useState, useEffect } from 'react';

/**
 * Hook to delay rendering of components to avoid layout-related warnings.
 *
 * This is particularly useful for chart components (like Recharts) that
 * throw dimension warnings when rendered before their container has
 * completed initial layout.
 *
 * @param delayMs - Milliseconds to wait before rendering (default: 100)
 * @param dependencies - Optional dependency array to reset the ready state
 * @returns boolean indicating if the component should render
 *
 * @example
 * ```tsx
 * const chartReady = useDelayedRender();
 *
 * return (
 *   <div>
 *     {chartReady && <ResponsiveContainer><AreaChart>...</AreaChart></ResponsiveContainer>}
 *   </div>
 * );
 * ```
 */
export function useDelayedRender(delayMs = 100, dependencies: unknown[] = []): boolean {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    setIsReady(false);
    const timer = setTimeout(() => setIsReady(true), delayMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delayMs, ...dependencies]);

  return isReady;
}
