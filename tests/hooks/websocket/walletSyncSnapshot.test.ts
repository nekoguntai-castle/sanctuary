import { describe, expect, it } from 'vitest';
import {
  applyAuthoritativeSyncSnapshot,
  mergeWalletHttpSyncState,
  mergeWalletListHttpSyncState,
  type SyncSnapshotEvent,
} from '../../../src/utils/walletSyncSnapshot';

const versionedWallet = {
  id: 'wallet-1',
  syncInProgress: false,
  lastSyncStatus: 'success',
  lastSyncError: null,
  lastSyncFailureClass: null,
  syncExecutionOwner: null,
  syncRetryCount: 0,
  syncNextRetryAt: null,
  syncStartedAt: null,
  syncStateVersion: 8,
};

describe('applyAuthoritativeSyncSnapshot', () => {
  it('applies a newer complete snapshot and clears nullable fields atomically', () => {
    const snapshot: SyncSnapshotEvent = {
      inProgress: false,
      status: 'complete',
      syncStatus: 'success',
      error: null,
      failureClass: null,
      executionOwner: null,
      retryCount: 0,
      nextRetryAt: null,
      startedAt: null,
      stateVersion: 9,
      lastSyncedAt: '2026-08-20T12:00:00.000Z',
    };

    expect(applyAuthoritativeSyncSnapshot({
      ...versionedWallet,
      syncInProgress: true,
      lastSyncStatus: 'retrying',
      lastSyncError: 'temporary failure',
      lastSyncFailureClass: 'electrum_unavailable',
      syncExecutionOwner: 'worker',
      syncRetryCount: 2,
      syncNextRetryAt: '2026-08-20T11:59:00.000Z',
      syncStartedAt: '2026-08-20T11:58:00.000Z',
    }, snapshot)).toEqual({
      ...versionedWallet,
      lastSyncedAt: '2026-08-20T12:00:00.000Z',
      syncStateVersion: 9,
    });
  });

  it.each([7, 8])('rejects stale or equal version %s', (stateVersion) => {
    const current = { ...versionedWallet };
    const result = applyAuthoritativeSyncSnapshot(current, {
      inProgress: true,
      status: 'retrying',
      error: 'late event',
      stateVersion,
    });

    expect(result).toBe(current);
  });

  it('preserves omitted fields for a legacy partial event', () => {
    const legacyWallet = {
      id: 'wallet-1',
      syncInProgress: false,
      lastSyncStatus: 'failed',
      lastSyncError: 'old failure',
    };

    expect(applyAuthoritativeSyncSnapshot(legacyWallet, {
      inProgress: true,
      status: 'retrying',
    })).toEqual({
      ...legacyWallet,
      syncInProgress: true,
      lastSyncStatus: 'retrying',
    });
  });

  it('preserves progress when a legacy status-only event omits it', () => {
    expect(applyAuthoritativeSyncSnapshot({
      id: 'wallet-1',
      syncInProgress: true,
    }, {
      status: 'success',
    })).toEqual({
      id: 'wallet-1',
      syncInProgress: true,
      lastSyncStatus: 'success',
    });
  });

  it('rejects a versionless legacy event after versioned state is cached', () => {
    const current = { ...versionedWallet };
    expect(applyAuthoritativeSyncSnapshot(current, {
      inProgress: true,
      status: 'retrying',
    })).toBe(current);
  });

  it.each([-1, 1.5, Number.NaN])('rejects invalid state version %s', (stateVersion) => {
    const current = { id: 'wallet-1' };
    expect(applyAuthoritativeSyncSnapshot(current, {
      inProgress: true,
      stateVersion,
    })).toBe(current);
  });

  it('accepts initial state version zero', () => {
    expect(applyAuthoritativeSyncSnapshot({ id: 'wallet-1' }, {
      inProgress: true,
      stateVersion: 0,
    })).toMatchObject({
      syncInProgress: true,
      syncStateVersion: 0,
    });
  });
});

describe('HTTP and WebSocket sync snapshot convergence', () => {
  it('preserves newer cached sync state while accepting fresh HTTP wallet fields', () => {
    const current = {
      ...versionedWallet,
      name: 'Before refetch',
      syncStateVersion: 9,
      lastSyncStatus: 'failed',
      lastSyncError: 'latest failure',
    };
    const incoming = {
      ...versionedWallet,
      name: 'Renamed on server',
      syncStateVersion: 8,
    };

    expect(mergeWalletHttpSyncState(current, incoming)).toMatchObject({
      name: 'Renamed on server',
      syncStateVersion: 9,
      lastSyncStatus: 'failed',
      lastSyncError: 'latest failure',
    });
  });

  it('merges wallet lists by identity and accepts equal or newer HTTP versions', () => {
    const current = [
      { ...versionedWallet, id: 'wallet-1', syncStateVersion: 9 },
      { ...versionedWallet, id: 'wallet-2', syncStateVersion: 4 },
    ];
    const incoming = [
      { ...versionedWallet, id: 'wallet-1', syncStateVersion: 8 },
      { ...versionedWallet, id: 'wallet-2', syncStateVersion: 5 },
      { ...versionedWallet, id: 'wallet-3', syncStateVersion: 1 },
    ];

    expect(mergeWalletListHttpSyncState(current, incoming).map(wallet => (
      [wallet.id, wallet.syncStateVersion]
    ))).toEqual([
      ['wallet-1', 9],
      ['wallet-2', 5],
      ['wallet-3', 1],
    ]);
  });
});
