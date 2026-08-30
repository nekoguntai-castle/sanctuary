import { describe, expect, it } from 'vitest';
import {
  getWalletSyncPresentation,
  isSyncGenerationPending,
} from '../../src/utils/walletSyncPresentation';

const NOW = Date.parse('2026-08-19T12:00:00.000Z');
const FRESH = new Date(NOW - 60_000).toISOString();
const ANCIENT = '2023-01-01T00:00:00.000Z';
const PENDING = {
  requestedIncrementalSyncGeneration: 2,
  claimedIncrementalSyncGeneration: 1,
  processedIncrementalSyncGeneration: 1,
};
const ACTIVE = {
  ...PENDING,
  syncInProgress: true,
  syncExecutionOwner: 'worker' as const,
  claimedIncrementalSyncGeneration: 2,
  incrementalSyncClaimedAt: '2026-08-19T11:59:00.000Z',
  incrementalSyncLeaseExpiresAt: '2026-08-19T12:01:00.000Z',
};

describe('getWalletSyncPresentation', () => {
  it('preserves legacy active status when lifecycle evidence is entirely absent', () => {
    expect(getWalletSyncPresentation({ syncInProgress: true }, null, NOW))
      .toMatchObject({ label: 'Syncing', spinning: true });
    expect(getWalletSyncPresentation({
      lastSyncStatus: 'resyncing',
      syncInProgress: false,
    }, null, NOW)).toMatchObject({ label: 'Resyncing', spinning: false });
    expect(getWalletSyncPresentation({
      lastSyncStatus: 'retrying',
    }, null, NOW)).toMatchObject({ label: 'Retrying', spinning: false });
  });

  it('requires both generations and a positive durable drift', () => {
    expect(isSyncGenerationPending(undefined, undefined)).toBe(false);
    expect(isSyncGenerationPending(1, undefined)).toBe(false);
    expect(isSyncGenerationPending(1, 1)).toBe(false);
    expect(isSyncGenerationPending(2, 1)).toBe(true);
  });
  it('describes a successful sync as healthy with no reason to explain', () => {
    const presentation = getWalletSyncPresentation(
      { lastSyncStatus: 'success', lastSyncedAt: FRESH },
      null,
      NOW,
    );

    expect(presentation.tone).toBe('success');
    expect(presentation.label).toBe('Synced');
    expect(presentation.reason).toBeNull();
    expect(presentation.description).toContain('Last synced');
    expect(presentation.spinning).toBe(false);
  });

  it('keeps a success without a timestamp healthy — no timestamp is not evidence of staleness', () => {
    const presentation = getWalletSyncPresentation(
      { lastSyncStatus: 'success', lastSyncedAt: null },
      null,
      NOW,
    );

    expect(presentation.tone).toBe('success');
    expect(presentation.description).toBe('Synced');
  });

  it('keeps an old settled success healthy under the activity-driven lifecycle', () => {
    const presentation = getWalletSyncPresentation(
      {
        lastSyncStatus: 'success',
        lastSyncedAt: ANCIENT,
        requestedIncrementalSyncGeneration: 1,
        claimedIncrementalSyncGeneration: 1,
        processedIncrementalSyncGeneration: 1,
        syncInProgress: false,
      },
      null,
      NOW,
    );

    expect(presentation.tone).toBe('success');
    expect(presentation.label).toBe('Synced');
    expect(presentation.reason).toBeNull();
    expect(presentation.description).toContain('Last synced');
  });

  it('treats an unparseable timestamp as stale rather than fresh', () => {
    const presentation = getWalletSyncPresentation(
      { lastSyncStatus: 'success', lastSyncedAt: 'not-a-date' },
      null,
      NOW,
    );

    expect(presentation.tone).toBe('stale');
  });

  it('surfaces lastSyncError as the reason for a failed sync', () => {
    const presentation = getWalletSyncPresentation(
      { lastSyncStatus: 'failed', lastSyncError: 'connect ECONNREFUSED 127.0.0.1:50002' },
      null,
      NOW,
    );

    expect(presentation.tone).toBe('failed');
    expect(presentation.label).toBe('Failed');
    expect(presentation.reason).toBe('connect ECONNREFUSED 127.0.0.1:50002');
    expect(presentation.description).toBe('connect ECONNREFUSED 127.0.0.1:50002');
  });

  it('falls back to a generic explanation when a failure carries no error text', () => {
    const presentation = getWalletSyncPresentation({ lastSyncStatus: 'failed' }, null, NOW);

    expect(presentation.reason).toBe('The last sync attempt failed.');
  });

  it('does not fabricate an attempt count when no live retry metadata exists', () => {
    const presentation = getWalletSyncPresentation(
      { ...PENDING, lastSyncStatus: 'retrying', lastSyncError: 'electrum timeout' },
      null,
      NOW,
    );

    expect(presentation.tone).toBe('retrying');
    expect(presentation.label).toBe('Retrying');
    expect(presentation.reason).toBe('electrum timeout');
  });

  it('names the attempt when live retry metadata is present', () => {
    const presentation = getWalletSyncPresentation(
      { ...PENDING, lastSyncStatus: 'retrying' },
      { retryCount: 2, maxRetries: 5, error: 'temporary error' },
      NOW,
    );

    expect(presentation.label).toBe('Retrying 2/5');
    expect(presentation.reason).toBe('temporary error');
    expect(presentation.spinning).toBe(false);
  });

  it('treats live retry metadata as retrying even when the persisted status disagrees', () => {
    const presentation = getWalletSyncPresentation(
      { ...PENDING, lastSyncStatus: null },
      { retryCount: 1, maxRetries: 3 },
      NOW,
    );

    expect(presentation.tone).toBe('retrying');
    expect(presentation.reason).toBe('The last sync attempt failed and is being retried.');
  });

  it('describes an in-flight full resync distinctly from an ordinary sync', () => {
    const presentation = getWalletSyncPresentation(
      {
        ...ACTIVE,
        lastSyncStatus: 'resyncing',
        requestedFullResyncGeneration: 2,
        preparedFullResyncGeneration: 1,
        processedFullResyncGeneration: 1,
      },
      null,
      NOW,
    );

    expect(presentation.tone).toBe('resyncing');
    expect(presentation.label).toBe('Resyncing');
    expect(presentation.spinning).toBe(true);
    expect(presentation.reason).toContain('being rebuilt');
  });

  it('flags a resync without active lease evidence as attention, never as "never synced"', () => {
    const presentation = getWalletSyncPresentation(
      {
        lastSyncStatus: 'resyncing',
        syncInProgress: false,
        syncStateVersion: 1,
        lastSyncedAt: null,
      },
      null,
      NOW,
    );

    expect(presentation.tone).toBe('failed');
    expect(presentation.label).toBe('Attention');
    expect(presentation.spinning).toBe(false);
    expect(presentation.reason).toContain('execution evidence');
  });

  it('explains attention caused specifically by an expired public lease', () => {
    const presentation = getWalletSyncPresentation({
      ...ACTIVE,
      incrementalSyncLeaseExpiresAt: '2026-08-19T12:00:00.000Z',
    }, null, NOW);

    expect(presentation.label).toBe('Attention');
    expect(presentation.description).toContain('lease evidence expired');
  });

  it('prefers a persisted resync error over the generic wording', () => {
    const presentation = getWalletSyncPresentation(
      { lastSyncStatus: 'resyncing', lastSyncError: 'Sync flag cleared by stale-wallet recovery' },
      null,
      NOW,
    );

    expect(presentation.reason).toBe('Sync flag cleared by stale-wallet recovery');
  });

  it('reports an active sync', () => {
    const presentation = getWalletSyncPresentation(ACTIVE, null, NOW);

    expect(presentation.tone).toBe('syncing');
    expect(presentation.label).toBe('Syncing');
    expect(presentation.reason).toBeNull();
    expect(presentation.description).toBe('Syncing in progress…');
  });

  it('keeps a durable persisted retry visible without implying active execution', () => {
    const presentation = getWalletSyncPresentation(
      { ...PENDING, lastSyncStatus: 'retrying', syncInProgress: false },
      null,
      NOW,
    );

    expect(presentation.tone).toBe('retrying');
    expect(presentation.label).toBe('Retrying');
    expect(presentation.spinning).toBe(false);
  });

  it('renders durable incremental and full-resync requests while no worker is active', () => {
    expect(getWalletSyncPresentation({
      requestedIncrementalSyncGeneration: 2,
      processedIncrementalSyncGeneration: 1,
    }, null, NOW)).toMatchObject({ label: 'Sync pending', spinning: false });
    expect(getWalletSyncPresentation({
      requestedIncrementalSyncGeneration: 2,
      processedIncrementalSyncGeneration: 1,
      requestedFullResyncGeneration: 4,
      processedFullResyncGeneration: 3,
    }, null, NOW)).toMatchObject({ label: 'Resync pending', spinning: false });
  });

  it('keeps durable retry status static while its intent remains pending', () => {
    expect(getWalletSyncPresentation({
      lastSyncStatus: 'retrying',
      syncInProgress: false,
      requestedIncrementalSyncGeneration: 2,
      processedIncrementalSyncGeneration: 1,
    }, null, NOW)).toMatchObject({
      label: 'Retrying',
      spinning: false,
    });
  });

  it('renders durable action-required state ahead of queued work', () => {
    expect(getWalletSyncPresentation({
      syncActionRequiredAt: '2026-08-20T12:00:00.000Z',
      lastSyncError: 'operator decision needed',
      requestedIncrementalSyncGeneration: 2,
      processedIncrementalSyncGeneration: 1,
    }, null, NOW)).toMatchObject({
      label: 'Action required',
      reason: 'operator decision needed',
      spinning: false,
    });
  });

  it('explains action-required state when no persisted error remains', () => {
    expect(getWalletSyncPresentation({
      syncActionRequiredAt: '2026-08-20T12:00:00.000Z',
    }, null, NOW).description).toContain('Automatic retries stopped');
  });

  it('keeps the legacy partial status mapped even though no writer produces it', () => {
    const presentation = getWalletSyncPresentation({ lastSyncStatus: 'partial' }, null, NOW);

    expect(presentation.tone).toBe('partial');
    expect(presentation.label).toBe('Partial');
    expect(presentation.reason).toBe('The last sync completed only part of the wallet.');
  });

  it('uses a persisted error for a partial sync when one exists', () => {
    const presentation = getWalletSyncPresentation(
      { lastSyncStatus: 'partial', lastSyncError: 'gap limit reached' },
      null,
      NOW,
    );

    expect(presentation.reason).toBe('gap limit reached');
  });

  it('gives an unrecognised status a defined tone instead of silently passing it through', () => {
    const presentation = getWalletSyncPresentation({ lastSyncStatus: 'quantum' }, null, NOW);

    expect(presentation.tone).toBe('unknown');
    expect(presentation.label).toBe('Unknown');
    expect(presentation.reason).toBe('Unrecognised sync status "quantum".');
  });

  it('prefers a persisted error for an unrecognised status', () => {
    const presentation = getWalletSyncPresentation(
      { lastSyncStatus: 'quantum', lastSyncError: 'node said no' },
      null,
      NOW,
    );

    expect(presentation.reason).toBe('node said no');
  });

  it('describes a wallet with cached data but no status as cached', () => {
    const presentation = getWalletSyncPresentation({ lastSyncedAt: FRESH }, null, NOW);

    expect(presentation.tone).toBe('cached');
    expect(presentation.label).toBe('Cached');
    expect(presentation.reason).toBeNull();
    expect(presentation.description).toContain('Cached from');
  });

  it('carries a persisted error onto a cached wallet', () => {
    const presentation = getWalletSyncPresentation(
      { lastSyncedAt: FRESH, lastSyncError: 'partial rebuild' },
      null,
      NOW,
    );

    expect(presentation.reason).toBe('partial rebuild');
  });

  it('describes a wallet that has never synced', () => {
    const presentation = getWalletSyncPresentation({}, null, NOW);

    expect(presentation.tone).toBe('never');
    expect(presentation.label).toBe('Not Synced');
    expect(presentation.description).toBe('Never synced');
    expect(presentation.reason).toBeNull();
  });

  it('carries a persisted error onto a never-synced wallet', () => {
    const presentation = getWalletSyncPresentation(
      { lastSyncError: 'no canonical policy' },
      null,
      NOW,
    );

    expect(presentation.reason).toBe('no canonical policy');
  });

  it('defaults the retry argument and the clock so callers may omit both', () => {
    const presentation = getWalletSyncPresentation({ lastSyncStatus: 'failed' });

    expect(presentation.tone).toBe('failed');
  });
});
