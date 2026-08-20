import { describe, expect, it } from 'vitest';
import {
  getWalletSyncStatus,
  getWalletSyncTitle,
} from '../../../src/components/Layout/SidebarContent/sidebarItems';
import type { Wallet } from '../../../src/api/wallets';

const wallet = (overrides: Partial<Wallet>) =>
  ({ id: 'w1', name: 'Primary', type: 'single_sig', ...overrides }) as Wallet;

describe('sidebar wallet sync dot', () => {
  it('keeps the three states it always handled', () => {
    expect(getWalletSyncStatus(wallet({ syncInProgress: true }))).toBe('syncing');
    expect(
      getWalletSyncStatus(
        wallet({
          lastSyncStatus: 'success',
          lastSyncedAt: new Date(Date.now() - 60_000).toISOString(),
        })
      )
    ).toBe('synced');
    expect(getWalletSyncStatus(wallet({ lastSyncStatus: 'failed' }))).toBe('error');
  });

  it('no longer collapses failure-adjacent states into the neutral pending dot', () => {
    // A wallet in retry backoff and one whose resync was stranded used to draw
    // the same grey dot as a brand-new wallet.
    expect(getWalletSyncStatus(wallet({ lastSyncStatus: 'retrying' }))).toBe('retrying');
    expect(getWalletSyncStatus(wallet({ lastSyncStatus: 'resyncing' }))).toBe('resyncing');
    expect(getWalletSyncStatus(wallet({ lastSyncStatus: 'partial' }))).toBe('stale');
    expect(
      getWalletSyncStatus(
        wallet({ lastSyncStatus: 'success', lastSyncedAt: '2026-01-01T00:00:00.000Z' })
      )
    ).toBe('stale');
    expect(getWalletSyncStatus(wallet({ lastSyncStatus: 'quantum' }))).toBe('error');
  });

  it('still shows pending for a wallet that was simply never queued', () => {
    expect(getWalletSyncStatus(wallet({}))).toBe('pending');
    expect(
      getWalletSyncStatus(
        wallet({ lastSyncedAt: new Date(Date.now() - 60_000).toISOString() })
      )
    ).toBe('pending');
  });

  it('titles the dot with something a reader can act on, not the enum name', () => {
    expect(
      getWalletSyncTitle(
        wallet({ lastSyncStatus: 'failed', lastSyncError: 'connect ECONNREFUSED' })
      )
    ).toBe('connect ECONNREFUSED');
    expect(getWalletSyncTitle(wallet({}))).toBe('Never synced');
  });
});
