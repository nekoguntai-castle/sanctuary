import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/config', () => ({
  getConfig: () => ({ sync: { maxSyncDurationMs: 120_000 } }),
}));

import {
  CHECK_STALE_WALLETS_JOB_NAME,
  CONFIRMATIONS_QUEUE_NAME,
  FULL_RESYNC_LOCK_RETRY_DELAY_MS,
  getSyncJobBackoffDelayMs,
  getSyncLockKey,
  getSyncLockRetryDelayMs,
  getSyncLockRetryWindowMs,
  getSyncLockTtlMs,
  hasSupportedSyncJobContractVersion,
  isCheckStaleWalletsJobData,
  isSyncWalletJobData,
  isSyncWalletJobLockData,
  isUpdateConfirmationsJobData,
  ORDINARY_SYNC_LOCK_RETRY_DELAY_MS,
  ORDINARY_SYNC_LOCK_RETRY_WINDOW_MS,
  SYNC_JOB_CONTRACT_VERSION,
  SYNC_WALLET_MUTATION_FENCE_JOB_VERSION,
  SYNC_WALLET_JOB_READER_VERSION,
  SYNC_QUEUE_NAME,
  SYNC_WALLET_JOB_NAME,
  SYNC_WALLET_JOB_OPTIONS,
  UPDATE_ALL_CONFIRMATIONS_JOB_NAME,
  UPDATE_CONFIRMATIONS_JOB_NAME,
  readSyncWalletJobData,
  readSyncWalletLockContractState,
} from '../../../src/jobs/syncJobContract';
import { WALLET_SYNC_MUTATION_FENCE_FLOOR } from '../../../src/constants/walletSyncActivation';

describe('sync job contract', () => {
  it('freezes the v1 wire identity and worker retry defaults', () => {
    expect(SYNC_JOB_CONTRACT_VERSION).toBe(1);
    expect(SYNC_QUEUE_NAME).toBe('sync');
    expect(SYNC_WALLET_JOB_NAME).toBe('sync-wallet');
    expect(CHECK_STALE_WALLETS_JOB_NAME).toBe('check-stale-wallets');
    expect(CONFIRMATIONS_QUEUE_NAME).toBe('confirmations');
    expect(UPDATE_CONFIRMATIONS_JOB_NAME).toBe('update-confirmations');
    expect(UPDATE_ALL_CONFIRMATIONS_JOB_NAME).toBe('update-all-confirmations');
    expect(SYNC_WALLET_JOB_OPTIONS).toEqual({
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  });

  it('accepts retained unversioned jobs and explicit v1 jobs', () => {
    expect(isSyncWalletJobData({ walletId: 'legacy-wallet' })).toBe(true);
    expect(isSyncWalletJobData({
      version: SYNC_JOB_CONTRACT_VERSION,
      walletId: 'current-wallet',
      priority: 'high',
      reason: 'manual',
    })).toBe(true);
  });

  it('reads unversioned and explicit v1 jobs into the canonical v1 shape', () => {
    expect(readSyncWalletJobData({ walletId: 'legacy-wallet' })).toEqual({
      version: 1,
      walletId: 'legacy-wallet',
    });
    expect(readSyncWalletJobData({
      version: 1,
      walletId: 'current-wallet',
      priority: 'high',
      reason: 'manual',
    })).toEqual({
      version: 1,
      walletId: 'current-wallet',
      priority: 'high',
      reason: 'manual',
    });
  });

  it('reads the additive v2 wallet shape without changing the producer version', () => {
    expect(SYNC_JOB_CONTRACT_VERSION).toBe(1);
    expect(SYNC_WALLET_JOB_READER_VERSION).toBe(2);
    const payload = {
      version: 2,
      walletId: 'wallet-v2',
      priority: 'normal',
      lockContention: {
        firstLockContentionAt: 1_786_000_000_000,
        attemptEpoch: 2,
      },
    } as const;

    expect(isSyncWalletJobData(payload)).toBe(true);
    expect(isSyncWalletJobLockData(payload)).toBe(true);
    expect(readSyncWalletJobData(payload)).toEqual(payload);
    expect(readSyncWalletJobData({ version: 2, walletId: 'marker-free-v2' })).toEqual({
      version: 2,
      walletId: 'marker-free-v2',
    });
    expect(readSyncWalletJobData({
      version: 2,
      walletId: 'canonical-v2',
      incrementalSyncGeneration: 2_147_483_647,
    })).toEqual({
      version: 2,
      walletId: 'canonical-v2',
      incrementalSyncGeneration: 2_147_483_647,
    });
    expect(readSyncWalletJobData({
      version: 2,
      walletId: 'canonical-v2-minimum',
      incrementalSyncGeneration: 1,
    })).toEqual({
      version: 2,
      walletId: 'canonical-v2-minimum',
      incrementalSyncGeneration: 1,
    });
  });

  it('reads fenced canonical v3 jobs while preserving retained v2 compatibility', () => {
    const payload = {
      version: SYNC_WALLET_MUTATION_FENCE_JOB_VERSION,
      walletId: 'wallet-v3',
      incrementalSyncGeneration: 7,
      requiredMutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      priority: 'high',
      reason: 'manual',
      lockContention: {
        firstLockContentionAt: 1_786_000_000_000,
        attemptEpoch: 1,
      },
    } as const;

    expect(readSyncWalletJobData(payload)).toEqual(payload);
    expect(isSyncWalletJobData(payload)).toBe(true);
    expect(isSyncWalletJobLockData(payload)).toBe(true);
    expect(readSyncWalletLockContractState(payload)).toEqual({
      version: 3,
      lockContention: payload.lockContention,
    });
    expect(readSyncWalletJobData({
      version: 2,
      walletId: 'retained-v2',
      incrementalSyncGeneration: 7,
    })).not.toBeNull();
    expect(readSyncWalletJobData({
      version: 3,
      walletId: 'minimal-v3',
      incrementalSyncGeneration: 1,
      requiredMutationFenceFloor: 1,
    })).toEqual({
      version: 3,
      walletId: 'minimal-v3',
      incrementalSyncGeneration: 1,
      requiredMutationFenceFloor: 1,
    });
    const fullResync = {
      version: 3,
      walletId: 'full-resync-v3',
      incrementalSyncGeneration: 1,
      requiredMutationFenceFloor: 1,
      fullResync: true,
      fullResyncGeneration: 1,
    } as const;
    expect(readSyncWalletJobData(fullResync)).toEqual(fullResync);
    expect(isSyncWalletJobLockData(fullResync)).toBe(true);
  });

  it.each([
    {
      version: 3,
      walletId: 'missing-floor',
      incrementalSyncGeneration: 1,
    },
    {
      version: 3,
      walletId: 'wrong-floor',
      incrementalSyncGeneration: 1,
      requiredMutationFenceFloor: 2,
    },
    {
      version: 3,
      walletId: 'missing-generation',
      requiredMutationFenceFloor: 1,
    },
    {
      version: 3,
      walletId: 'full-resync-v3-missing-full-generation',
      incrementalSyncGeneration: 1,
      requiredMutationFenceFloor: 1,
      fullResync: true,
    },
    {
      version: 3,
      walletId: 'explicit-false-v3',
      incrementalSyncGeneration: 1,
      requiredMutationFenceFloor: 1,
      fullResync: false,
    },
    {
      version: 2,
      walletId: 'floor-on-v2',
      incrementalSyncGeneration: 1,
      requiredMutationFenceFloor: 1,
    },
  ])('rejects malformed or downgraded fenced canonical payload before lock effects: %j', (payload) => {
    expect(readSyncWalletJobData(payload)).toBeNull();
    expect(isSyncWalletJobData(payload)).toBe(false);
    expect(isSyncWalletJobLockData(payload)).toBe(false);
  });

  it.each([
    0,
    -1,
    1.5,
    2_147_483_648,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '1',
  ])('rejects malformed incremental generation before lock effects: %j', (generation) => {
    const payload = {
      version: 2,
      walletId: 'wallet-1',
      incrementalSyncGeneration: generation,
    };
    expect(readSyncWalletJobData(payload)).toBeNull();
    expect(isSyncWalletJobData(payload)).toBe(false);
    expect(isSyncWalletJobLockData(payload)).toBe(false);
  });

  it('keeps canonical incremental generations exclusive from legacy and full-resync shapes', () => {
    const legacyGeneration = {
      version: 1,
      walletId: 'wallet-1',
      incrementalSyncGeneration: 1,
    };
    const mixedFullResync = {
      version: 2,
      walletId: 'wallet-1',
      incrementalSyncGeneration: 1,
      fullResync: true,
      fullResyncGeneration: 1,
    };
    const explicitIncremental = {
      version: 2,
      walletId: 'wallet-1',
      incrementalSyncGeneration: 1,
      fullResync: false,
    };
    const generationWithoutFullResync = {
      version: 2,
      walletId: 'wallet-1',
      incrementalSyncGeneration: 1,
      fullResyncGeneration: 1,
    };
    expect(readSyncWalletJobData(legacyGeneration)).toBeNull();
    expect(isSyncWalletJobLockData(legacyGeneration)).toBe(false);
    expect(readSyncWalletJobData(mixedFullResync)).toBeNull();
    expect(isSyncWalletJobLockData(mixedFullResync)).toBe(false);
    expect(readSyncWalletJobData(explicitIncremental)).toBeNull();
    expect(isSyncWalletJobLockData(explicitIncremental)).toBe(false);
    expect(readSyncWalletJobData(generationWithoutFullResync)).toBeNull();
    expect(isSyncWalletJobLockData(generationWithoutFullResync)).toBe(false);
  });

  it.each([
    null,
    {},
    { walletId: '' },
    { version: 4, walletId: 'wallet-1' },
    { walletId: 'wallet-1', priority: 'urgent' },
    { walletId: 'wallet-1', reason: 42 },
    { walletId: 'wallet-1', fullResync: 'yes' },
    { walletId: 'wallet-1', fullResync: true },
    { walletId: 'wallet-1', fullResync: false, fullResyncGeneration: 1 },
  ])('rejects an incompatible payload: %j', (payload) => {
    expect(isSyncWalletJobData(payload)).toBe(false);
  });

  it('rejects an unknown wallet wire version before lock effects', () => {
    expect(isSyncWalletJobLockData({ version: 4, walletId: 'wallet-1' })).toBe(false);
  });

  it.each([
    { firstLockContentionAt: 0, attemptEpoch: 0 },
    { firstLockContentionAt: -1, attemptEpoch: 0 },
    { firstLockContentionAt: 1.5, attemptEpoch: 0 },
    { firstLockContentionAt: Number.MAX_SAFE_INTEGER + 1, attemptEpoch: 0 },
    { firstLockContentionAt: 1_786_000_000_000, attemptEpoch: -1 },
    { firstLockContentionAt: 1_786_000_000_000, attemptEpoch: 0.5 },
    { firstLockContentionAt: 1_786_000_000_000 },
    { attemptEpoch: 0 },
    { firstLockContentionAt: 1_786_000_000_000, attemptEpoch: 0, extra: true },
  ])('rejects malformed v2 lock contention before lock effects: %j', (lockContention) => {
    const payload = { version: 2, walletId: 'wallet-1', lockContention };
    expect(readSyncWalletJobData(payload)).toBeNull();
    expect(isSyncWalletJobData(payload)).toBe(false);
    expect(isSyncWalletJobLockData(payload)).toBe(false);
  });

  it('normalizes lock-only state for unversioned and marker-free v2 jobs', () => {
    expect(readSyncWalletLockContractState(null)).toBeNull();
    expect(readSyncWalletLockContractState({ walletId: 'legacy' })).toEqual({
      version: 1,
    });
    expect(readSyncWalletLockContractState({ version: 2, walletId: 'v2' })).toEqual({
      version: 2,
    });
    expect(readSyncWalletLockContractState({
      version: 2,
      walletId: 'invalid',
      lockContention: 'not-an-object',
    })).toBeNull();
  });

  it('rejects v2-only contention metadata on retained v1 jobs', () => {
    const payload = {
      version: 1,
      walletId: 'wallet-1',
      lockContention: { firstLockContentionAt: 1_786_000_000_000, attemptEpoch: 0 },
    };
    expect(readSyncWalletJobData(payload)).toBeNull();
    expect(isSyncWalletJobLockData(payload)).toBe(false);
  });

  it('requires a valid generation for a full resync', () => {
    expect(isSyncWalletJobData({
      walletId: 'wallet-1',
      fullResync: true,
      fullResyncGeneration: 1,
    })).toBe(true);
  });

  it('requires a supported version and nonblank wallet id before lock effects', () => {
    expect(isSyncWalletJobLockData(null)).toBe(false);
    expect(isSyncWalletJobLockData('wallet-1')).toBe(false);
    expect(isSyncWalletJobLockData([])).toBe(false);
    expect(isSyncWalletJobLockData({ walletId: 'wallet-1' })).toBe(true);
    expect(isSyncWalletJobLockData({ version: 1, walletId: 'wallet-1' })).toBe(true);
    expect(isSyncWalletJobLockData({ version: 2, walletId: 'wallet-1' })).toBe(true);
    expect(isSyncWalletJobLockData({ version: 3, walletId: 'wallet-1' })).toBe(false);
    expect(isSyncWalletJobLockData({})).toBe(false);
    expect(isSyncWalletJobLockData({ walletId: '   ' })).toBe(false);
    expect(isSyncWalletJobLockData({
      walletId: 'wallet-1',
      fullResync: true,
    })).toBe(true);
  });

  it('validates live stale and confirmation commands across the v1 boundary', () => {
    expect(isCheckStaleWalletsJobData({ reason: 'legacy' })).toBe(true);
    expect(isCheckStaleWalletsJobData({ version: 1, maxWallets: 10 })).toBe(true);
    expect(isCheckStaleWalletsJobData({ staggerDelayMs: 250 })).toBe(true);
    expect(isCheckStaleWalletsJobData({ version: 2 })).toBe(false);
    expect(isCheckStaleWalletsJobData({ staleThresholdMs: 'soon' })).toBe(false);
    expect(isCheckStaleWalletsJobData({ priority: 'urgent' })).toBe(false);
    expect(isUpdateConfirmationsJobData({ height: 100 })).toBe(true);
    expect(isUpdateConfirmationsJobData({ version: 1, hash: 'abc' })).toBe(true);
    expect(isUpdateConfirmationsJobData({ version: 2 })).toBe(false);
    expect(isUpdateConfirmationsJobData({ height: '100' })).toBe(false);
  });

  it('accepts legacy and current results while rejecting unknown versions', () => {
    expect(hasSupportedSyncJobContractVersion({ staleWalletIds: [] })).toBe(true);
    expect(hasSupportedSyncJobContractVersion({ version: 1, staleWalletIds: [] })).toBe(true);
    expect(hasSupportedSyncJobContractVersion({ version: 2, staleWalletIds: [] })).toBe(false);
    expect(hasSupportedSyncJobContractVersion(null)).toBe(false);
  });

  it('owns lock key, delay, window, and config-derived TTL policy', () => {
    const ordinary = { walletId: 'wallet-1' };
    const full = { walletId: 'wallet-1', fullResync: true };

    expect(getSyncLockKey(ordinary)).toBe('sync:wallet:wallet-1');
    expect(getSyncLockTtlMs()).toBe(180_000);
    expect(getSyncLockRetryDelayMs(ordinary)).toBe(ORDINARY_SYNC_LOCK_RETRY_DELAY_MS);
    expect(getSyncLockRetryDelayMs(full)).toBe(FULL_RESYNC_LOCK_RETRY_DELAY_MS);
    expect(getSyncLockRetryWindowMs(ordinary)).toBe(ORDINARY_SYNC_LOCK_RETRY_WINDOW_MS);
    expect(getSyncLockRetryWindowMs(full)).toBe(180_000);
  });

  it('calculates canonical and override backoff delays', () => {
    expect(getSyncJobBackoffDelayMs(0)).toBe(5000);
    expect(getSyncJobBackoffDelayMs(1)).toBe(10_000);
    expect(getSyncJobBackoffDelayMs(2, 250)).toBe(250);
    expect(getSyncJobBackoffDelayMs(3, { type: 'fixed', delay: 700 })).toBe(700);
    expect(getSyncJobBackoffDelayMs(1, { type: 'fixed' } as never)).toBe(0);
    expect(getSyncJobBackoffDelayMs(1, undefined)).toBe(10_000);
  });
});
