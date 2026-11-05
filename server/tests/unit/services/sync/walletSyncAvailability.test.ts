import { describe, expect, it, vi } from 'vitest';
import {
  WALLET_SYNC_ACTIVATION_DRAIN_HORIZON_MS,
  WORKER_RESTART_MARKER_TTL_MS,
} from '../../../../src/constants/walletSyncActivation';

const { mockGetWorkerHealthStatus } = vi.hoisted(() => ({
  mockGetWorkerHealthStatus: vi.fn(),
}));

vi.mock('../../../../src/services/workerHealth', () => ({
  getWorkerHealthStatus: mockGetWorkerHealthStatus,
}));

import {
  describeRefusedWalletSync,
  describeWalletSyncAvailability,
} from '../../../../src/services/sync/walletSyncAvailability';
import type { WorkerHealthStatus } from '../../../../src/services/workerHealth';

function health(
  status: WorkerHealthStatus['status'],
  components?: Record<string, unknown>,
): WorkerHealthStatus {
  return {
    healthy: status === 'healthy',
    running: true,
    status,
    failures: 0,
    lastCheckedAt: '2026-11-04T23:00:00.000Z',
    lastHealthyAt: null,
    responseTimeMs: 3,
    worker: components ? { status, components } : undefined,
  };
}

describe('describeWalletSyncAvailability', () => {
  it('reads the cached worker health by default', () => {
    mockGetWorkerHealthStatus.mockReturnValue(health('healthy', {
      walletSyncActivation: { status: 'active', requiredFloor: 1, activatedAt: '2026-08-26T22:25:47.035Z' },
    }));

    expect(describeWalletSyncAvailability()).toEqual({ state: 'available' });
  });

  it('reports available before the first worker poll completes', () => {
    expect(describeWalletSyncAvailability(health('unknown'))).toEqual({ state: 'available' });
  });

  it('reports the worker unavailable when its health endpoint cannot be read', () => {
    expect(describeWalletSyncAvailability(health('unreachable'))).toEqual({
      state: 'paused', reason: 'worker_unavailable', resumesAt: null,
    });
  });

  it('treats a healthy report without components as available', () => {
    expect(describeWalletSyncAvailability(health('healthy'))).toEqual({ state: 'available' });
  });

  it('treats a worker that does not report activation as available', () => {
    expect(describeWalletSyncAvailability(health('healthy', { redis: true }))).toEqual({ state: 'available' });
  });

  it.each(['active', 'dormant'])('reports %s activation as available', (status) => {
    expect(describeWalletSyncAvailability(health('healthy', {
      walletSyncActivation: { status, requiredFloor: 1 },
    }))).toEqual({ state: 'available' });
  });

  it('estimates the end of stabilization from the drain horizon', () => {
    expect(describeWalletSyncAvailability(health('healthy', {
      walletSyncActivation: {
        status: 'stabilizing', requiredFloor: 1, candidateReadySince: '2026-11-04T23:00:00.000Z',
      },
    }))).toEqual({
      state: 'paused',
      reason: 'stabilizing',
      resumesAt: new Date(Date.parse('2026-11-04T23:00:00.000Z') + WALLET_SYNC_ACTIVATION_DRAIN_HORIZON_MS).toISOString(),
    });
  });

  it('estimates the end of restart recovery from the worker start time', () => {
    expect(describeWalletSyncAvailability(health('degraded', {
      startedAt: '2026-11-04T23:00:00.000Z',
      walletSyncActivation: { status: 'fleet_blocked', requiredFloor: 1, reason: 'restart_observed' },
    }))).toEqual({
      state: 'paused',
      reason: 'restart_recovery',
      resumesAt: new Date(Date.parse('2026-11-04T23:00:00.000Z') + WORKER_RESTART_MARKER_TTL_MS + WALLET_SYNC_ACTIVATION_DRAIN_HORIZON_MS).toISOString(),
    });
  });

  it.each([
    ['a missing timestamp', undefined],
    ['an unparseable timestamp', 'not-a-date'],
  ])('reports restart recovery without an estimate given %s', (_label, startedAt) => {
    expect(describeWalletSyncAvailability(health('healthy', {
      startedAt,
      walletSyncActivation: { status: 'fleet_blocked', requiredFloor: 1, reason: 'restart_observed' },
    }))).toEqual({ state: 'paused', reason: 'restart_recovery', resumesAt: null });
  });

  it.each([
    [{ status: 'fleet_blocked', requiredFloor: 1, reason: 'worker_below_floor' }],
    [{ status: 'unavailable', requiredFloor: 1, reason: 'fleet_unavailable' }],
    [{ status: 'something_new' }],
  ])('reports other holds as gated without an estimate (%o)', (walletSyncActivation) => {
    expect(describeWalletSyncAvailability(health('healthy', { walletSyncActivation }))).toEqual({
      state: 'paused', reason: 'gated', resumesAt: null,
    });
  });

  it('ignores an activation report that is not an object', () => {
    expect(describeWalletSyncAvailability(health('healthy', { walletSyncActivation: 'active' }))).toEqual({
      state: 'available',
    });
  });

  it('describes a refused request from the gate verdict, anchored on the polled start time', () => {
    mockGetWorkerHealthStatus.mockReturnValue(health('healthy', {
      startedAt: '2026-11-04T23:00:00.000Z',
      walletSyncActivation: { status: 'active', requiredFloor: 1, activatedAt: '2026-08-26T22:25:47.035Z' },
    }));

    expect(describeRefusedWalletSync({ status: 'fleet_blocked', requiredFloor: 1, reason: 'restart_observed' })).toEqual({
      state: 'paused',
      reason: 'restart_recovery',
      resumesAt: new Date(Date.parse('2026-11-04T23:00:00.000Z') + WORKER_RESTART_MARKER_TTL_MS + WALLET_SYNC_ACTIVATION_DRAIN_HORIZON_MS).toISOString(),
    });
  });

  it('describes a refused request without an estimate when worker health is unknown', () => {
    mockGetWorkerHealthStatus.mockReturnValue(health('unknown'));

    expect(describeRefusedWalletSync({ status: 'unavailable', requiredFloor: 1, reason: 'policy_unavailable' })).toEqual({
      state: 'paused', reason: 'gated', resumesAt: null,
    });
  });
});
