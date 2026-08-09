/**
 * Observable, request-deduplicated AI capability status.
 */

import { useSyncExternalStore } from 'react';
import * as aiApi from '../api/ai';

interface AIStatusState {
  enabled: boolean;
  loading: boolean;
  available: boolean;
}

const RETRY_DELAY_MS = 1_000;
const LOADING_STATUS: AIStatusState = Object.freeze({
  enabled: false,
  loading: true,
  available: false,
});
const UNAVAILABLE_STATUS: AIStatusState = Object.freeze({
  enabled: false,
  loading: false,
  available: false,
});

type Listener = () => void;

let snapshot = LOADING_STATUS;
let generation = 0;
let activeGeneration: number | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let failedSnapshot = false;
const listeners = new Set<Listener>();

const publish = (nextSnapshot: AIStatusState): void => {
  snapshot = Object.freeze(nextSnapshot);
  listeners.forEach(listener => listener());
};

const clearRetry = (): void => {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
};

const toStatusSnapshot = (status: Awaited<ReturnType<typeof aiApi.getAIStatus>>): AIStatusState => ({
  enabled: status.enabled ?? Boolean(status.available),
  loading: false,
  available: Boolean(status.available) && Boolean(status.proxyAvailable),
});

const scheduleRetry = (): void => {
  if (listeners.size === 0) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void startStatusRequest(false);
  }, RETRY_DELAY_MS);
};

const startStatusRequest = async (retryOnFailure: boolean): Promise<void> => {
  const requestGeneration = generation;
  activeGeneration = requestGeneration;

  try {
    const status = await aiApi.getAIStatus();
    if (requestGeneration !== generation) return;
    activeGeneration = null;
    clearRetry();
    failedSnapshot = false;
    publish(toStatusSnapshot(status));
  } catch {
    if (requestGeneration !== generation) return;
    activeGeneration = null;
    failedSnapshot = true;
    publish(UNAVAILABLE_STATUS);
    if (retryOnFailure) scheduleRetry();
  }
};

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener);
  if ((snapshot.loading || failedSnapshot) && !retryTimer && activeGeneration !== generation) {
    void startStatusRequest(true);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) clearRetry();
  };
};

const getSnapshot = (): AIStatusState => snapshot;

export function useAIStatus(): AIStatusState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function invalidateAIStatusCache(): void {
  generation += 1;
  activeGeneration = null;
  failedSnapshot = false;
  clearRetry();
  publish(LOADING_STATUS);
  if (listeners.size > 0) void startStatusRequest(true);
}
