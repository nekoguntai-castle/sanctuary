import { useEffect, useRef, useState } from 'react';
import type { WalletSyncSubject } from '../utils/walletSyncPresentationTypes';
import { getNextWalletSyncBoundary } from '../utils/walletSyncLifecycle';

const DEFAULT_MAX_TICK_MS = 30_000;
const MAX_TICK_MS = 60_000;

export interface WalletSyncLifecycleClockOptions {
  maxTickMs?: number;
  now?: () => number;
}

function boundedTick(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_MAX_TICK_MS;
  }
  return Math.min(MAX_TICK_MS, Math.max(1, Math.trunc(value)));
}

const systemNow = (): number => Date.now();

/** One bounded timer for every lease/retry boundary in the supplied scope. */
export function useWalletSyncLifecycleClock(
  subjects: readonly WalletSyncSubject[],
  scopeKey: string,
  options: WalletSyncLifecycleClockOptions = {},
): number {
  const nowProvider = options.now ?? systemNow;
  const maxTickMs = boundedTick(options.maxTickMs);
  const [reading, setReading] = useState(() => ({ scopeKey, now: nowProvider() }));
  const scopeRef = useRef(scopeKey);
  const currentNow = scopeRef.current === scopeKey ? reading.now : nowProvider();
  scopeRef.current = scopeKey;

  useEffect(() => {
    const now = nowProvider();
    if (reading.scopeKey !== scopeKey) {
      setReading({ scopeKey, now });
    }
    const boundary = getNextWalletSyncBoundary(subjects, now);
    const boundaryDelay = boundary === null ? maxTickMs : Math.max(1, boundary - now);
    const timer = setTimeout(() => {
      setReading({ scopeKey, now: nowProvider() });
    }, Math.min(maxTickMs, boundaryDelay));
    return () => clearTimeout(timer);
  }, [maxTickMs, nowProvider, reading.now, reading.scopeKey, scopeKey, subjects]);

  return currentNow;
}
