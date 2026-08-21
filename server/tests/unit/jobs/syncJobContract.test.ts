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
  SYNC_QUEUE_NAME,
  SYNC_WALLET_JOB_NAME,
  SYNC_WALLET_JOB_OPTIONS,
  UPDATE_ALL_CONFIRMATIONS_JOB_NAME,
  UPDATE_CONFIRMATIONS_JOB_NAME,
} from '../../../src/jobs/syncJobContract';

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

  it.each([
    null,
    {},
    { walletId: '' },
    { version: 2, walletId: 'wallet-1' },
    { walletId: 'wallet-1', priority: 'urgent' },
    { walletId: 'wallet-1', reason: 42 },
    { walletId: 'wallet-1', fullResync: true },
    { walletId: 'wallet-1', fullResync: false, fullResyncGeneration: 1 },
  ])('rejects an incompatible payload: %j', (payload) => {
    expect(isSyncWalletJobData(payload)).toBe(false);
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
    expect(isSyncWalletJobLockData({ version: 2, walletId: 'wallet-1' })).toBe(false);
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
