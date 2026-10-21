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
 *
 * A client error (4xx other than 408/429, e.g. the feature-gate 403 when the
 * flags are off) is terminal: the hook stops polling until the status is
 * invalidated or a new session subscribes after every consumer unmounted.
 * Transient failures retry with exponential backoff capped at one minute.
 */

import { useSyncExternalStore } from 'react';
import * as intelligenceApi from '../api/intelligence';
import { ApiError } from '../api/client';
import { isRetryableStatus } from '../api/retryPolicy';

interface IntelligenceStatusResult {
  available: boolean;
  loading: boolean;
  endpointType?: 'host' | 'remote';
}

const LOADING_STATUS: IntelligenceStatusResult = Object.freeze({ available: false, loading: true });
const UNAVAILABLE_STATUS: IntelligenceStatusResult = Object.freeze({ available: false, loading: false });
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 60_000;
type Listener = () => void;
type StatusFailure = 'none' | 'transient' | 'terminal';

let snapshot = LOADING_STATUS;
let generation = 0;
let activeGeneration: number | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let failure: StatusFailure = 'none';
let retryAttempt = 0;
const listeners = new Set<Listener>();

const publish = (next: IntelligenceStatusResult): void => {
  snapshot = Object.freeze(next);
  listeners.forEach(listener => listener());
};

const isTerminalStatusError = (error: unknown): boolean =>
  error instanceof ApiError
  && error.status >= 400
  && error.status < 500
  && !isRetryableStatus(error.status);

const clearRetry = (): void => {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
};

const scheduleRetry = (): void => {
  if (listeners.size === 0) return;
  const delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** retryAttempt, RETRY_MAX_DELAY_MS);
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void startStatusRequest();
  }, delay);
};

const startStatusRequest = async (): Promise<void> => {
  const requestGeneration = generation;
  activeGeneration = requestGeneration;
  try {
    const result = await intelligenceApi.getIntelligenceStatus();
    if (requestGeneration !== generation) return;
    activeGeneration = null;
    clearRetry();
    failure = 'none';
    retryAttempt = 0;
    publish({ available: result.available, loading: false, endpointType: result.endpointType });
  } catch (error) {
    if (requestGeneration !== generation) return;
    activeGeneration = null;
    if (isTerminalStatusError(error)) {
      failure = 'terminal';
      publish(UNAVAILABLE_STATUS);
      return;
    }
    failure = 'transient';
    publish(UNAVAILABLE_STATUS);
    scheduleRetry();
  }
};

const subscribe = (listener: Listener): (() => void) => {
  const newSession = listeners.size === 0;
  listeners.add(listener);
  const needsCheck = snapshot.loading || failure === 'transient' || (failure === 'terminal' && newSession);
  if (needsCheck && !retryTimer && activeGeneration !== generation) {
    void startStatusRequest();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearRetry();
      retryAttempt = 0;
    }
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
  failure = 'none';
  retryAttempt = 0;
  clearRetry();
  publish(LOADING_STATUS);
  if (listeners.size > 0) void startStatusRequest();
}
