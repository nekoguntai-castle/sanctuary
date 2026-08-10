/**
 * Intelligence Status Hook
 *
 * Checks if Treasury Intelligence is available:
 * - Both aiAssistant and treasuryIntelligence feature flags enabled
 * - LLM egress proxy reachable
 * - External provider endpoint configured
 *
 * Returns { available: false } silently if any condition fails and publishes
 * one immutable status snapshot to every mounted consumer.
 */

import { useSyncExternalStore } from 'react';
import * as intelligenceApi from '../api/intelligence';

interface IntelligenceStatusResult {
  available: boolean;
  loading: boolean;
  endpointType?: 'host' | 'remote';
}

const LOADING_STATUS: IntelligenceStatusResult = Object.freeze({ available: false, loading: true });
const UNAVAILABLE_STATUS: IntelligenceStatusResult = Object.freeze({ available: false, loading: false });
const RETRY_DELAY_MS = 1_000;
type Listener = () => void;

let snapshot = LOADING_STATUS;
let generation = 0;
let activeGeneration: number | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let failedSnapshot = false;
const listeners = new Set<Listener>();

const publish = (next: IntelligenceStatusResult): void => {
  snapshot = Object.freeze(next);
  listeners.forEach(listener => listener());
};

const clearRetry = (): void => {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
};

const scheduleRetry = (): void => {
  if (listeners.size === 0) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void startStatusRequest();
  }, RETRY_DELAY_MS);
};

const startStatusRequest = async (): Promise<void> => {
  const requestGeneration = generation;
  activeGeneration = requestGeneration;
  try {
    const result = await intelligenceApi.getIntelligenceStatus();
    if (requestGeneration !== generation) return;
    activeGeneration = null;
    clearRetry();
    failedSnapshot = false;
    publish({ available: result.available, loading: false, endpointType: result.endpointType });
  } catch {
    if (requestGeneration !== generation) return;
    activeGeneration = null;
    failedSnapshot = true;
    publish(UNAVAILABLE_STATUS);
    scheduleRetry();
  }
};

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener);
  if ((snapshot.loading || failedSnapshot) && !retryTimer && activeGeneration !== generation) {
    void startStatusRequest();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) clearRetry();
  };
};

const getSnapshot = (): IntelligenceStatusResult => snapshot;

export function useIntelligenceStatus(): IntelligenceStatusResult {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Invalidate the cached status (call after changing settings)
 */
export function invalidateIntelligenceStatus(): void {
  generation += 1;
  activeGeneration = null;
  failedSnapshot = false;
  clearRetry();
  publish(LOADING_STATUS);
  if (listeners.size > 0) void startStatusRequest();
}
