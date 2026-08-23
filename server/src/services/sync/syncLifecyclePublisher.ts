import type {
  SyncExecutionOwner,
  SyncLifecycleTransitionKind,
  WalletSyncFailureClass,
} from '@sanctuary/shared/constants/sync';
import { getDistributedEventBus } from '../../infrastructure';
import { getErrorMessage } from '../../utils/errors';
import { createLogger } from '../../utils/logger';
import { broadcastSyncStatus } from '../../websocket/notifications/broadcasts';
import type { PersistedSyncTransition } from './syncAttemptLifecycle';
import type { WalletSyncDurableState } from '../../repositories/types';

const log = createLogger('SYNC:LIFECYCLE_PUBLISHER');

export interface SyncLifecycleWebSocketSnapshot {
  inProgress: boolean;
  transition: SyncLifecycleTransitionKind;
  status: string;
  syncStatus: string | null;
  error: string | null;
  failureClass: WalletSyncFailureClass | null;
  lastSyncedAt: Date | null;
  executionOwner: SyncExecutionOwner | null;
  retryCount: number;
  nextRetryAt: Date | null;
  startedAt: Date | null;
  stateVersion: number;
  requestedIncrementalSyncGeneration: number;
  claimedIncrementalSyncGeneration: number;
  processedIncrementalSyncGeneration: number;
  incrementalSyncClaimedAt: Date | null;
  incrementalSyncLeaseExpiresAt: Date | null;
  syncActionRequiredAt: Date | null;
  requestedFullResyncGeneration: number;
  preparedFullResyncGeneration: number;
  processedFullResyncGeneration: number;
  maxRetries?: number;
  retriesExhausted: boolean;
}

function durableIntentSnapshot(state: WalletSyncDurableState): Pick<
SyncLifecycleWebSocketSnapshot,
| 'requestedIncrementalSyncGeneration'
| 'claimedIncrementalSyncGeneration'
| 'processedIncrementalSyncGeneration'
| 'incrementalSyncClaimedAt'
| 'incrementalSyncLeaseExpiresAt'
| 'syncActionRequiredAt'
| 'requestedFullResyncGeneration'
| 'preparedFullResyncGeneration'
| 'processedFullResyncGeneration'
> {
  const durable = state;
  return {
    requestedIncrementalSyncGeneration: durable.requestedIncrementalSyncGeneration,
    claimedIncrementalSyncGeneration: durable.claimedIncrementalSyncGeneration,
    processedIncrementalSyncGeneration: durable.processedIncrementalSyncGeneration,
    incrementalSyncClaimedAt: durable.incrementalSyncClaimedAt,
    incrementalSyncLeaseExpiresAt: durable.incrementalSyncLeaseExpiresAt,
    syncActionRequiredAt: durable.syncActionRequiredAt,
    requestedFullResyncGeneration: durable.requestedFullResyncGeneration,
    preparedFullResyncGeneration: durable.preparedFullResyncGeneration,
    processedFullResyncGeneration: durable.processedFullResyncGeneration,
  };
}

export interface SyncLifecyclePublicationContext {
  /** Adapter retry budget; policy metadata that is not part of persisted state. */
  maxRetries?: number;
}

export interface SyncLifecycleEvent {
  walletId: string;
  transition: SyncLifecycleTransitionKind;
  stateVersion: number;
}

export interface SyncLifecyclePublisher {
  publish(
    transition: PersistedSyncTransition,
    context?: SyncLifecyclePublicationContext,
  ): Promise<void>;
}

type PublicationResult = void | Promise<void>;

export interface SyncLifecyclePublisherDependencies {
  publishWebSocket(
    walletId: string,
    snapshot: SyncLifecycleWebSocketSnapshot,
  ): PublicationResult;
  publishEvent(event: SyncLifecycleEvent): PublicationResult;
  reportFailure?(
    channel: 'websocket' | 'event',
    error: unknown,
    transition: PersistedSyncTransition,
  ): void;
}

function compatibleStatus(transition: PersistedSyncTransition): string {
  switch (transition.transition) {
    case 'requested':
      return transition.state.lastSyncStatus ?? 'pending';
    case 'started':
      return 'syncing';
    case 'succeeded':
      return 'success';
    case 'retrying':
      return 'retrying';
    case 'failed':
      return 'failed';
    case 'cleared':
      return transition.state.lastSyncStatus ?? 'idle';
  }
}

/** Project the exact committed row into the complete client sync snapshot. */
export function toSyncLifecycleWebSocketSnapshot(
  transition: PersistedSyncTransition,
  context: SyncLifecyclePublicationContext = {},
): SyncLifecycleWebSocketSnapshot {
  const { state } = transition;
  return {
    inProgress: state.syncInProgress,
    transition: transition.transition,
    status: compatibleStatus(transition),
    syncStatus: state.lastSyncStatus,
    error: state.lastSyncError,
    failureClass: state.lastSyncFailureClass,
    lastSyncedAt: state.lastSyncedAt,
    executionOwner: state.syncExecutionOwner,
    retryCount: state.syncRetryCount,
    nextRetryAt: state.syncNextRetryAt,
    startedAt: state.syncStartedAt,
    stateVersion: state.syncStateVersion,
    ...durableIntentSnapshot(state),
    ...(context.maxRetries !== undefined && { maxRetries: context.maxRetries }),
    retriesExhausted: transition.transition === 'failed',
  };
}

function lifecycleEvent(
  transition: PersistedSyncTransition,
): SyncLifecycleEvent {
  return {
    walletId: transition.walletId,
    transition: transition.transition,
    stateVersion: transition.state.syncStateVersion,
  };
}

function defaultFailureReporter(
  channel: 'websocket' | 'event',
  error: unknown,
  transition: PersistedSyncTransition,
): void {
  log.warn(`Could not publish sync lifecycle transition to ${channel}`, {
    walletId: transition.walletId,
    transition: transition.transition,
    stateVersion: transition.state.syncStateVersion,
    error: getErrorMessage(error),
  });
}

function reportPublicationFailure(
  channel: 'websocket' | 'event',
  error: unknown,
  transition: PersistedSyncTransition,
  reportFailure: NonNullable<SyncLifecyclePublisherDependencies['reportFailure']>,
): void {
  try {
    reportFailure(channel, error, transition);
  } catch (reportingError) {
    log.warn('Could not report sync lifecycle publication failure', {
      walletId: transition.walletId,
      channel,
      error: getErrorMessage(reportingError),
    });
  }
}

async function publishChannel(
  channel: 'websocket' | 'event',
  publish: () => PublicationResult,
  transition: PersistedSyncTransition,
  reportFailure: NonNullable<SyncLifecyclePublisherDependencies['reportFailure']>,
): Promise<void> {
  try {
    await Promise.resolve().then(publish);
  } catch (error) {
    reportPublicationFailure(channel, error, transition, reportFailure);
  }
}

/** Best-effort publisher: each channel is isolated and always attempted once. */
export function createSyncLifecyclePublisher(
  dependencies: SyncLifecyclePublisherDependencies,
): SyncLifecyclePublisher {
  const reportFailure = dependencies.reportFailure ?? defaultFailureReporter;
  return {
    async publish(transition, context): Promise<void> {
      const snapshot = toSyncLifecycleWebSocketSnapshot(transition, context);
      await Promise.all([
        publishChannel(
          'websocket',
          () => dependencies.publishWebSocket(transition.walletId, snapshot),
          transition,
          reportFailure,
        ),
        publishChannel(
          'event',
          () => dependencies.publishEvent(lifecycleEvent(transition)),
          transition,
          reportFailure,
        ),
      ]);
    },
  };
}

/** Process-wide publisher used by both sync scheduling adapters. */
export const syncLifecyclePublisher = createSyncLifecyclePublisher({
  publishWebSocket: broadcastSyncStatus,
  publishEvent: (event) => {
    getDistributedEventBus().emit('wallet:syncTransition', event);
  },
});
