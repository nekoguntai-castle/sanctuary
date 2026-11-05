/**
 * Wallet Sync Availability
 *
 * Summarizes, for the UI, whether the fleet currently admits new wallet sync
 * work and roughly when a hold ends. The polled summary reads the activation
 * state the worker already publishes on its health endpoint (cached by the
 * worker health monitor) rather than evaluating the activation gate again: a
 * blocked gate read resets the stabilization proof, so polling it from every
 * open browser would extend the very hold it reports.
 */

import type { WalletSyncAvailability } from '@sanctuary/shared/types/api';
import {
  WALLET_SYNC_ACTIVATION_DRAIN_HORIZON_MS,
  WORKER_RESTART_MARKER_TTL_MS,
} from '../../constants/walletSyncActivation';
import { getWorkerHealthStatus, type WorkerHealthStatus } from '../workerHealth';
import type { WalletSyncActivationState } from './walletSyncActivationGate';

// After an unclean restart the marker lives out its TTL, and only then can a
// fresh drain horizon begin.
const RESTART_RECOVERY_HOLD_MS = WORKER_RESTART_MARKER_TTL_MS + WALLET_SYNC_ACTIVATION_DRAIN_HORIZON_MS;

const AVAILABLE: WalletSyncAvailability = { state: 'available' };
const GATED: WalletSyncAvailability = { state: 'paused', reason: 'gated', resumesAt: null };
const WORKER_UNAVAILABLE: WalletSyncAvailability = {
  state: 'paused', reason: 'worker_unavailable', resumesAt: null,
};

const ACTIVATION_STATUSES: ReadonlySet<string> = new Set<WalletSyncActivationState['status']>([
  'active', 'dormant', 'stabilizing', 'fleet_blocked', 'unavailable',
]);

function isoAfter(base: unknown, offsetMs: number): string | null {
  if (typeof base !== 'string') return null;
  const baseMs = Date.parse(base);
  return Number.isFinite(baseMs) ? new Date(baseMs + offsetMs).toISOString() : null;
}

/**
 * Map an activation verdict to the UI summary. `workerStartedAt` anchors the
 * restart estimate; it is an upper bound, since the worker records its start
 * time shortly after the first heartbeat writes the restart marker.
 */
export function describeActivation(
  activation: WalletSyncActivationState,
  workerStartedAt?: unknown,
): WalletSyncAvailability {
  switch (activation.status) {
    case 'active':
    case 'dormant':
      return AVAILABLE;
    case 'stabilizing':
      return {
        state: 'paused',
        reason: 'stabilizing',
        resumesAt: isoAfter(activation.candidateReadySince, WALLET_SYNC_ACTIVATION_DRAIN_HORIZON_MS),
      };
    case 'fleet_blocked':
      return activation.reason === 'restart_observed'
        ? {
          state: 'paused',
          reason: 'restart_recovery',
          resumesAt: isoAfter(workerStartedAt, RESTART_RECOVERY_HOLD_MS),
        }
        : GATED;
    case 'unavailable':
      return GATED;
  }
}

/** Summary for a sync request the gate just refused, using the gate's own verdict. */
export function describeRefusedWalletSync(activation: WalletSyncActivationState): WalletSyncAvailability {
  return describeActivation(activation, getWorkerHealthStatus().worker?.components?.startedAt);
}

/** Polled summary, derived from the worker's last published health. */
export function describeWalletSyncAvailability(
  health: WorkerHealthStatus = getWorkerHealthStatus(),
): WalletSyncAvailability {
  // No poll has completed yet; do not flash a pause during API startup.
  if (health.status === 'unknown') return AVAILABLE;

  const components = health.worker?.components;
  if (!components) return health.status === 'unreachable' ? WORKER_UNAVAILABLE : AVAILABLE;

  const activation = components.walletSyncActivation;
  // A worker that predates activation reporting cannot be held by the gate.
  if (!activation || typeof activation !== 'object') return AVAILABLE;
  const { status } = activation as { status?: unknown };
  if (typeof status !== 'string' || !ACTIVATION_STATUSES.has(status)) return GATED;
  return describeActivation(activation as WalletSyncActivationState, components.startedAt);
}
