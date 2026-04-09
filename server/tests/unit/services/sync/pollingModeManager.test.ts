import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const {
  mockGetConfig,
  mockGetWorkerHealthStatus,
  mockLogger,
  mockMetricsInc,
} = vi.hoisted(() => ({
  mockGetConfig: vi.fn<any>().mockReturnValue({
    sync: {
      intervalMs: 60_000,
      confirmationUpdateIntervalMs: 30_000,
    },
  }),
  mockGetWorkerHealthStatus: vi.fn<any>(),
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  mockMetricsInc: vi.fn(),
}));

vi.mock('../../../../src/config', () => ({
  getConfig: () => mockGetConfig(),
}));

vi.mock('../../../../src/services/workerHealth', () => ({
  getWorkerHealthStatus: () => mockGetWorkerHealthStatus(),
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

vi.mock('../../../../src/observability/metrics', () => ({
  syncPollingModeTransitions: { inc: (...args: unknown[]) => mockMetricsInc(...args) },
}));

import {
  startPollingIntervals,
  stopPollingIntervals,
  evaluatePollingMode,
} from '../../../../src/services/sync/pollingModeManager';
import type { PollingIntervalRefs } from '../../../../src/services/sync/pollingModeManager';
import type { SyncState } from '../../../../src/services/sync/types';

const makeRefs = (): PollingIntervalRefs => ({
  syncInterval: null,
  confirmationInterval: null,
});

const makeSyncState = (overrides: Partial<SyncState> = {}): SyncState => ({
  isRunning: true,
  syncQueue: [],
  activeSyncs: new Set(),
  activeLocks: new Map(),
  addressToWalletMap: new Map(),
  pendingRetries: new Map(),
  subscriptionLock: null,
  subscriptionLockRefresh: null,
  subscriptionsEnabled: false,
  subscriptionOwnership: 'disabled',
  subscribedToHeaders: false,
  pollingMode: 'worker-delegated',
  ...overrides,
});

describe('pollingModeManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('startPollingIntervals', () => {
    it('starts sync and confirmation intervals', () => {
      const refs = makeRefs();
      const state = makeSyncState({ pollingMode: 'worker-delegated' });
      const onCheckStale = vi.fn();
      const onUpdateConfirmations = vi.fn();

      startPollingIntervals(refs, state, onCheckStale, onUpdateConfirmations);

      expect(refs.syncInterval).not.toBeNull();
      expect(refs.confirmationInterval).not.toBeNull();
      expect(state.pollingMode).toBe('in-process');
    });

    it('does not start if already running', () => {
      const refs = makeRefs();
      refs.syncInterval = setInterval(() => {}, 1000);
      const state = makeSyncState({ pollingMode: 'in-process' });
      const onCheckStale = vi.fn();
      const onUpdateConfirmations = vi.fn();

      const originalInterval = refs.syncInterval;
      startPollingIntervals(refs, state, onCheckStale, onUpdateConfirmations);

      // Should be same interval, not replaced
      expect(refs.syncInterval).toBe(originalInterval);
      clearInterval(originalInterval);
    });

    it('records metric transition from worker-delegated to in-process', () => {
      const refs = makeRefs();
      const state = makeSyncState({ pollingMode: 'worker-delegated' });

      startPollingIntervals(refs, state, vi.fn(), vi.fn());

      expect(mockMetricsInc).toHaveBeenCalledWith({
        from: 'worker-delegated',
        to: 'in-process',
      });
    });

    it('does not record metric when already in-process', () => {
      const refs = makeRefs();
      const state = makeSyncState({ pollingMode: 'in-process' });

      startPollingIntervals(refs, state, vi.fn(), vi.fn());

      expect(mockMetricsInc).not.toHaveBeenCalled();
    });

    it('calls onCheckStale at configured interval', () => {
      const refs = makeRefs();
      const state = makeSyncState();
      const onCheckStale = vi.fn();

      startPollingIntervals(refs, state, onCheckStale, vi.fn());

      vi.advanceTimersByTime(60_000);
      expect(onCheckStale).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(60_000);
      expect(onCheckStale).toHaveBeenCalledTimes(2);
    });

    it('calls onUpdateConfirmations at configured interval', () => {
      const refs = makeRefs();
      const state = makeSyncState();
      const onUpdateConfirmations = vi.fn();

      startPollingIntervals(refs, state, vi.fn(), onUpdateConfirmations);

      vi.advanceTimersByTime(30_000);
      expect(onUpdateConfirmations).toHaveBeenCalledTimes(1);
    });
  });

  describe('stopPollingIntervals', () => {
    it('clears intervals and sets mode to worker-delegated', () => {
      const refs = makeRefs();
      refs.syncInterval = setInterval(() => {}, 1000);
      refs.confirmationInterval = setInterval(() => {}, 1000);
      const state = makeSyncState({ pollingMode: 'in-process' });

      stopPollingIntervals(refs, state);

      expect(refs.syncInterval).toBeNull();
      expect(refs.confirmationInterval).toBeNull();
      expect(state.pollingMode).toBe('worker-delegated');
    });

    it('records metric transition from in-process to worker-delegated', () => {
      const refs = makeRefs();
      refs.syncInterval = setInterval(() => {}, 1000);
      refs.confirmationInterval = setInterval(() => {}, 1000);
      const state = makeSyncState({ pollingMode: 'in-process' });

      stopPollingIntervals(refs, state);

      expect(mockMetricsInc).toHaveBeenCalledWith({
        from: 'in-process',
        to: 'worker-delegated',
      });
    });

    it('does not record metric when already worker-delegated', () => {
      const refs = makeRefs();
      const state = makeSyncState({ pollingMode: 'worker-delegated' });

      stopPollingIntervals(refs, state);

      expect(mockMetricsInc).not.toHaveBeenCalled();
    });

    it('handles null intervals gracefully', () => {
      const refs = makeRefs();
      const state = makeSyncState({ pollingMode: 'in-process' });

      expect(() => stopPollingIntervals(refs, state)).not.toThrow();
      expect(state.pollingMode).toBe('worker-delegated');
    });
  });

  describe('evaluatePollingMode', () => {
    it('returns early when isRunning is false', () => {
      const refs = makeRefs();
      const state = makeSyncState({ isRunning: false });

      evaluatePollingMode(refs, state, vi.fn(), vi.fn());

      expect(mockGetWorkerHealthStatus).not.toHaveBeenCalled();
    });

    it('stops polling when worker recovers and mode is in-process', () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });

      const refs = makeRefs();
      refs.syncInterval = setInterval(() => {}, 1000);
      refs.confirmationInterval = setInterval(() => {}, 1000);
      const state = makeSyncState({ pollingMode: 'in-process' });

      evaluatePollingMode(refs, state, vi.fn(), vi.fn());

      expect(refs.syncInterval).toBeNull();
      expect(state.pollingMode).toBe('worker-delegated');
    });

    it('starts polling when worker goes down and mode is worker-delegated', () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });

      const refs = makeRefs();
      const state = makeSyncState({ pollingMode: 'worker-delegated' });

      evaluatePollingMode(refs, state, vi.fn(), vi.fn());

      expect(refs.syncInterval).not.toBeNull();
      expect(state.pollingMode).toBe('in-process');
    });

    it('does nothing when worker is healthy and mode is already worker-delegated', () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });

      const refs = makeRefs();
      const state = makeSyncState({ pollingMode: 'worker-delegated' });

      evaluatePollingMode(refs, state, vi.fn(), vi.fn());

      expect(refs.syncInterval).toBeNull();
      expect(state.pollingMode).toBe('worker-delegated');
    });

    it('does nothing when worker is unhealthy and mode is already in-process', () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });

      const refs = makeRefs();
      refs.syncInterval = setInterval(() => {}, 1000);
      const state = makeSyncState({ pollingMode: 'in-process' });

      evaluatePollingMode(refs, state, vi.fn(), vi.fn());

      // Should still be in-process, interval unchanged
      expect(state.pollingMode).toBe('in-process');
    });
  });
});
