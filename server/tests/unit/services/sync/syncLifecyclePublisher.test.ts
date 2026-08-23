import { describe, expect, it, vi } from 'vitest';

const defaultChannels = vi.hoisted(() => ({
  broadcast: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('../../../../src/infrastructure', () => ({
  getDistributedEventBus: () => ({ emit: defaultChannels.emit }),
}));

vi.mock('../../../../src/websocket/notifications/broadcasts', () => ({
  broadcastSyncStatus: defaultChannels.broadcast,
}));

import type { IncrementalSyncLifecycleState } from '../../../../src/repositories/types';
import type { PersistedSyncTransition } from '../../../../src/services/sync/syncAttemptLifecycle';
import {
  createSyncLifecyclePublisher,
  syncLifecyclePublisher,
  toSyncLifecycleWebSocketSnapshot,
} from '../../../../src/services/sync/syncLifecyclePublisher';

const state: IncrementalSyncLifecycleState = {
  id: 'wallet-1',
  requestedIncrementalSyncGeneration: 5,
  claimedIncrementalSyncGeneration: 5,
  processedIncrementalSyncGeneration: 4,
  incrementalSyncLeaseToken: '10000000-0000-4000-8000-000000000001',
  incrementalSyncClaimedAt: new Date('2026-08-20T12:00:00.000Z'),
  incrementalSyncLeaseExpiresAt: new Date('2026-08-20T12:05:00.000Z'),
  syncActionRequiredAt: null,
  requestedFullResyncGeneration: 3,
  preparedFullResyncGeneration: 2,
  processedFullResyncGeneration: 1,
  syncInProgress: true,
  lastSyncedAt: new Date('2026-08-20T11:30:00.000Z'),
  lastSyncedBlockHeight: 839_999,
  lastSyncStatus: 'retrying',
  lastSyncError: 'Electrum connection refused',
  lastSyncFailureClass: 'electrum_unavailable',
  syncExecutionOwner: 'worker',
  syncRetryCount: 2,
  syncNextRetryAt: new Date('2026-08-20T12:02:00.000Z'),
  syncStartedAt: new Date('2026-08-20T12:00:00.000Z'),
  syncStateVersion: 19,
};

function transition(
  overrides: Partial<PersistedSyncTransition> = {},
): PersistedSyncTransition {
  return {
    walletId: 'wallet-1',
    transition: 'retrying',
    state,
    ...overrides,
  };
}

describe('sync lifecycle publisher', () => {
  it('derives a full authoritative WebSocket snapshot from persisted state', () => {
    expect(toSyncLifecycleWebSocketSnapshot(transition())).toEqual({
      inProgress: true,
      transition: 'retrying',
      status: 'retrying',
      syncStatus: 'retrying',
      error: 'Electrum connection refused',
      failureClass: 'electrum_unavailable',
      lastSyncedAt: state.lastSyncedAt,
      executionOwner: 'worker',
      retryCount: 2,
      nextRetryAt: state.syncNextRetryAt,
      startedAt: state.syncStartedAt,
      stateVersion: 19,
      requestedIncrementalSyncGeneration: 5,
      claimedIncrementalSyncGeneration: 5,
      processedIncrementalSyncGeneration: 4,
      incrementalSyncClaimedAt: state.incrementalSyncClaimedAt,
      incrementalSyncLeaseExpiresAt: state.incrementalSyncLeaseExpiresAt,
      syncActionRequiredAt: null,
      requestedFullResyncGeneration: 3,
      preparedFullResyncGeneration: 2,
      processedFullResyncGeneration: 1,
      retriesExhausted: false,
    });
    expect(toSyncLifecycleWebSocketSnapshot(transition()))
      .not.toHaveProperty('incrementalSyncLeaseToken');
  });

  it('projects token-free durable intent authority from every committed row', () => {
    const durableState: IncrementalSyncLifecycleState = {
      ...state,
      requestedIncrementalSyncGeneration: 5,
      claimedIncrementalSyncGeneration: 5,
      processedIncrementalSyncGeneration: 4,
      incrementalSyncClaimedAt: new Date('2026-08-20T12:00:00.000Z'),
      incrementalSyncLeaseExpiresAt: new Date('2026-08-20T12:05:00.000Z'),
      syncActionRequiredAt: null,
      requestedFullResyncGeneration: 3,
      preparedFullResyncGeneration: 2,
      processedFullResyncGeneration: 1,
    };

    expect(toSyncLifecycleWebSocketSnapshot(transition({ state: durableState }))).toMatchObject({
      requestedIncrementalSyncGeneration: 5,
      claimedIncrementalSyncGeneration: 5,
      processedIncrementalSyncGeneration: 4,
      incrementalSyncClaimedAt: durableState.incrementalSyncClaimedAt,
      incrementalSyncLeaseExpiresAt: durableState.incrementalSyncLeaseExpiresAt,
      syncActionRequiredAt: null,
      requestedFullResyncGeneration: 3,
      preparedFullResyncGeneration: 2,
      processedFullResyncGeneration: 1,
    });
  });

  it.each([
    ['requested', 'retrying', false],
    ['started', 'syncing', false],
    ['succeeded', 'success', false],
    ['retrying', 'retrying', false],
    ['failed', 'failed', true],
    ['cleared', 'retrying', false],
  ] as const)(
    'projects the %s transition to the compatible %s status',
    (kind, status, retriesExhausted) => {
      expect(toSyncLifecycleWebSocketSnapshot(
        transition({ transition: kind }),
      )).toMatchObject({ status, retriesExhausted });
    },
  );

  it('uses an idle compatibility status when a clear leaves no durable status', () => {
    expect(toSyncLifecycleWebSocketSnapshot(transition({
      transition: 'cleared',
      state: { ...state, lastSyncStatus: null },
    }))).toMatchObject({
      status: 'idle',
      syncStatus: null,
    });
  });

  it('uses pending compatibility status for a request without legacy status', () => {
    expect(toSyncLifecycleWebSocketSnapshot(transition({
      transition: 'requested',
      state: { ...state, lastSyncStatus: null },
    }))).toMatchObject({
      status: 'pending',
      syncStatus: null,
    });
  });

  it('publishes one WebSocket snapshot and one versioned internal event', async () => {
    const publishWebSocket = vi.fn();
    const publishEvent = vi.fn();
    const publisher = createSyncLifecyclePublisher({
      publishWebSocket,
      publishEvent,
    });

    await publisher.publish(transition());

    expect(publishWebSocket).toHaveBeenCalledOnce();
    expect(publishWebSocket).toHaveBeenCalledWith(
      'wallet-1',
      toSyncLifecycleWebSocketSnapshot(transition()),
    );
    expect(publishEvent).toHaveBeenCalledOnce();
    expect(publishEvent).toHaveBeenCalledWith({
      walletId: 'wallet-1',
      transition: 'retrying',
      stateVersion: 19,
    });
  });

  it('adds adapter retry policy without changing the persisted snapshot', async () => {
    const publishWebSocket = vi.fn();
    const publisher = createSyncLifecyclePublisher({
      publishWebSocket,
      publishEvent: vi.fn(),
    });

    await publisher.publish(transition(), { maxRetries: 2 });

    expect(publishWebSocket).toHaveBeenCalledWith(
      'wallet-1',
      expect.objectContaining({
        retryCount: 2,
        maxRetries: 2,
        stateVersion: 19,
      }),
    );
    expect(state).not.toHaveProperty('maxRetries');
  });

  it('wires the process publisher to WebSocket and the distributed event bus', async () => {
    await syncLifecyclePublisher.publish(transition());

    expect(defaultChannels.broadcast).toHaveBeenCalledWith(
      'wallet-1',
      toSyncLifecycleWebSocketSnapshot(transition()),
    );
    expect(defaultChannels.emit).toHaveBeenCalledWith(
      'wallet:syncTransition',
      {
        walletId: 'wallet-1',
        transition: 'retrying',
        stateVersion: 19,
      },
    );
  });

  it('contains synchronous and asynchronous channel failures independently', async () => {
    const channelFailure = new Error('WebSocket unavailable');
    const eventFailure = new Error('event subscriber failed');
    const publishWebSocket = vi.fn(() => {
      throw channelFailure;
    });
    const publishEvent = vi.fn().mockRejectedValue(eventFailure);
    const reportFailure = vi.fn();
    const publisher = createSyncLifecyclePublisher({
      publishWebSocket,
      publishEvent,
      reportFailure,
    });

    await expect(publisher.publish(transition())).resolves.toBeUndefined();

    expect(publishWebSocket).toHaveBeenCalledOnce();
    expect(publishEvent).toHaveBeenCalledOnce();
    expect(reportFailure).toHaveBeenCalledTimes(2);
    expect(reportFailure).toHaveBeenCalledWith(
      'websocket',
      channelFailure,
      transition(),
    );
    expect(reportFailure).toHaveBeenCalledWith(
      'event',
      eventFailure,
      transition(),
    );
  });

  it('contains a channel failure with the default reporter', async () => {
    const publisher = createSyncLifecyclePublisher({
      publishWebSocket: () => {
        throw new Error('WebSocket unavailable');
      },
      publishEvent: vi.fn(),
    });

    await expect(publisher.publish(transition())).resolves.toBeUndefined();
  });

  it('does not let a failing diagnostic reporter escape publication', async () => {
    const publishEvent = vi.fn();
    const publisher = createSyncLifecyclePublisher({
      publishWebSocket: () => {
        throw new Error('WebSocket unavailable');
      },
      publishEvent,
      reportFailure: () => {
        throw new Error('logger unavailable');
      },
    });

    await expect(publisher.publish(transition())).resolves.toBeUndefined();
    expect(publishEvent).toHaveBeenCalledOnce();
  });
});
