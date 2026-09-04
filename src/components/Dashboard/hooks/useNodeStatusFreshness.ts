import { useEffect, useRef, useState } from 'react';

/**
 * Two missed 60-second polling windows (`useBitcoinStatus`'s
 * `refetchInterval`). Plan B1: "Treat a response as last-known after two
 * missed 60-second polling windows even without an error."
 */
export const FRESHNESS_WINDOW_MS = 120_000;

export interface NodeStatusFreshnessInput {
  /** React Query `dataUpdatedAt` for the retained same-network data; 0 when none. */
  dataUpdatedAt: number;
  /** Latest refetch error, if any, while data is retained. */
  error: Error | null;
  /** Included so a network switch cancels/reschedules rather than reusing a stale timer. */
  network: string;
}

export interface NodeStatusFreshnessResult {
  /** True when retained data should be presented as "Last known" rather than current. */
  isLastKnown: boolean;
}

function computeIsLastKnown(dataUpdatedAt: number, hasError: boolean, now: number): boolean {
  if (dataUpdatedAt <= 0) {
    // Nothing retained to call "last known" — the presenter's initial/loading
    // path handles this case instead.
    return false;
  }
  if (hasError) {
    return true;
  }
  return now - dataUpdatedAt >= FRESHNESS_WINDOW_MS;
}

/**
 * Response-freshness controller for the node status card (plan B1).
 *
 * React Query's `refetchInterval` only fires while the query is actively
 * polling; a backgrounded/throttled tab can silently miss windows without
 * ever producing a query event. This hook closes that gap with its own
 * one-shot timer targeting `dataUpdatedAt + 120s`, re-evaluated immediately
 * on `focus`/`visibilitychange` so a foregrounded tab does not wait for the
 * next tick to notice it is stale. `network` and `dataUpdatedAt` are deps: a
 * network switch or a fresh response cancels the previous timer before
 * scheduling (or not scheduling) the next one, so a rapid switch between
 * networks cannot fire the prior network's timer, and unmount always clears
 * the pending timeout.
 *
 * The verdict is only committed to state when it actually changes: the
 * lazy initializer already computes the mount-time verdict, and every
 * re-evaluation (timer fire, focus, visibilitychange) uses a functional
 * `setState` update that bails out on an equal `isLastKnown` value, so an
 * unchanged verdict never triggers a re-render.
 */
export function useNodeStatusFreshness({
  dataUpdatedAt,
  error,
  network,
}: NodeStatusFreshnessInput): NodeStatusFreshnessResult {
  const hasError = error !== null;
  const [result, setResult] = useState<NodeStatusFreshnessResult>(() => ({
    isLastKnown: computeIsLastKnown(dataUpdatedAt, hasError, Date.now()),
  }));

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const evaluate = () => {
      const isLastKnown = computeIsLastKnown(dataUpdatedAt, hasError, Date.now());
      setResult((previous) => (previous.isLastKnown === isLastKnown ? previous : { isLastKnown }));
    };

    evaluate();

    if (dataUpdatedAt > 0 && !hasError) {
      const delay = Math.max(0, dataUpdatedAt + FRESHNESS_WINDOW_MS - Date.now());
      timeoutRef.current = setTimeout(evaluate, delay);
    }

    window.addEventListener('focus', evaluate);
    document.addEventListener('visibilitychange', evaluate);

    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      window.removeEventListener('focus', evaluate);
      document.removeEventListener('visibilitychange', evaluate);
    };
  }, [dataUpdatedAt, hasError, network]);

  return result;
}
