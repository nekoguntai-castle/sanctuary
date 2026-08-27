import { describe, expect, it } from 'vitest';
import {
  classifyWalletSyncLifecycle,
  deriveWalletSyncControls,
  getNextWalletSyncBoundary,
  projectAcceptedWalletSyncIntent,
  summarizeWalletSyncFleet,
  type WalletSyncLifecycleState,
} from '../../src/utils/walletSyncLifecycle';
import type { WalletSyncSubject } from '../../src/utils/walletSyncPresentationTypes';

const NOW = Date.parse('2026-08-26T12:00:00.000Z');
const CLAIMED_AT = '2026-08-26T11:59:00.000Z';
const FUTURE_LEASE = '2026-08-26T12:01:00.000Z';

const pending = (overrides: Partial<WalletSyncSubject> = {}): WalletSyncSubject => ({
  requestedIncrementalSyncGeneration: 2,
  claimedIncrementalSyncGeneration: 1,
  processedIncrementalSyncGeneration: 1,
  ...overrides,
});

const running = (overrides: Partial<WalletSyncSubject> = {}): WalletSyncSubject => pending({
  syncInProgress: true,
  syncExecutionOwner: 'worker',
  claimedIncrementalSyncGeneration: 2,
  incrementalSyncClaimedAt: CLAIMED_AT,
  incrementalSyncLeaseExpiresAt: FUTURE_LEASE,
  ...overrides,
});

describe('classifyWalletSyncLifecycle', () => {
  it.each<[string, WalletSyncSubject, WalletSyncLifecycleState]>([
    ['action-required outranks a live lease', running({
      syncActionRequiredAt: '2026-08-26T11:58:00.000Z',
    }), 'action_required'],
    ['strict public lease is running', running(), 'running'],
    ['future retry with durable intent is retrying', pending({
      lastSyncStatus: 'retrying',
      syncNextRetryAt: '2026-08-26T12:02:00.000Z',
    }), 'retrying'],
    ['persisted retry status with durable intent is retrying', pending({
      lastSyncStatus: 'retrying',
    }), 'retrying'],
    ['coherent unclaimed intent is pending', pending(), 'pending'],
    ['expired lease is attention, not pending', running({
      incrementalSyncLeaseExpiresAt: '2026-08-26T12:00:00.000Z',
    }), 'attention'],
    ['settled wallet is settled', {
      requestedIncrementalSyncGeneration: 2,
      claimedIncrementalSyncGeneration: 2,
      processedIncrementalSyncGeneration: 2,
    }, 'settled'],
  ])('%s', (_name, subject, expected) => {
    expect(classifyWalletSyncLifecycle(subject, NOW).state).toBe(expected);
  });

  it.each([
    ['missing owner', running({ syncExecutionOwner: null })],
    ['non-worker owner', running({ syncExecutionOwner: 'inline' })],
    ['missing claimed-at', running({ incrementalSyncClaimedAt: null })],
    ['missing expiry', running({ incrementalSyncLeaseExpiresAt: null })],
    ['invalid claimed-at', running({ incrementalSyncClaimedAt: 'tomorrow' })],
    ['invalid expiry', running({ incrementalSyncLeaseExpiresAt: 'later' })],
    ['invalid calendar expiry', running({ incrementalSyncLeaseExpiresAt: '2026-02-30T12:00:00Z' })],
    ['reversed lease', running({ incrementalSyncLeaseExpiresAt: CLAIMED_AT })],
    ['claim not ahead', running({ claimedIncrementalSyncGeneration: 1 })],
    ['in-progress disagreement', pending({ syncInProgress: true })],
    ['generation inversion', pending({ claimedIncrementalSyncGeneration: 3 })],
    ['negative incremental request', pending({ requestedIncrementalSyncGeneration: -1 })],
    ['negative incremental processed', pending({ processedIncrementalSyncGeneration: -1 })],
    ['incremental processed ahead', pending({ processedIncrementalSyncGeneration: 3 })],
    ['negative full-resync request', {
      requestedFullResyncGeneration: -1, processedFullResyncGeneration: 0,
    }],
    ['negative full-resync processed', {
      requestedFullResyncGeneration: 1, processedFullResyncGeneration: -1,
    }],
    ['full-resync processed ahead', {
      requestedFullResyncGeneration: 1, processedFullResyncGeneration: 2,
    }],
    ['negative full-resync prepared', {
      requestedFullResyncGeneration: 2,
      preparedFullResyncGeneration: -1,
      processedFullResyncGeneration: 0,
    }],
    ['full-resync prepared behind processed', {
      requestedFullResyncGeneration: 3,
      preparedFullResyncGeneration: 1,
      processedFullResyncGeneration: 2,
    }],
    ['full-resync prepared ahead', {
      requestedFullResyncGeneration: 2,
      preparedFullResyncGeneration: 3,
      processedFullResyncGeneration: 1,
    }],
    ['partial generations', { requestedIncrementalSyncGeneration: 2 }],
    ['claim without incremental generations', { claimedIncrementalSyncGeneration: 1 }],
    ['full-resync request without processed generation', { requestedFullResyncGeneration: 1 }],
    ['prepared full resync without generations', { preparedFullResyncGeneration: 1 }],
    ['invalid retry timestamp', pending({
      lastSyncStatus: 'retrying', syncNextRetryAt: 'not-an-instant',
    })],
    ['invalid action timestamp', pending({ syncActionRequiredAt: 'not-an-instant' })],
    ['invalid started timestamp', pending({ syncStartedAt: 'not-an-instant' })],
    ['retry marker without intent', { lastSyncStatus: 'retrying' }],
  ] as const)('classifies %s as attention', (_name, subject) => {
    expect(classifyWalletSyncLifecycle(subject, NOW).state).toBe('attention');
  });

  it('uses strict expiry and injected time boundaries', () => {
    expect(classifyWalletSyncLifecycle(running(), NOW).state).toBe('running');
    expect(classifyWalletSyncLifecycle(running(), Date.parse(FUTURE_LEASE)).state)
      .toBe('attention');
  });

  it('classifies exactly one state for every precedence fixture', () => {
    const fixtures = [
      running({ syncActionRequiredAt: CLAIMED_AT }),
      running(),
      pending({ lastSyncStatus: 'retrying' }),
      pending(),
      running({ incrementalSyncLeaseExpiresAt: CLAIMED_AT }),
      {},
    ];
    const states = fixtures.map(subject => classifyWalletSyncLifecycle(subject, NOW).state);
    expect(states).toEqual([
      'action_required', 'running', 'retrying', 'pending', 'attention', 'settled',
    ]);
  });
});

describe('fleet summary and boundaries', () => {
  it('summarizes all wallets using disjoint categories', () => {
    const wallets = [running(), running(), ...Array.from({ length: 10 }, () => pending())];
    expect(summarizeWalletSyncFleet(wallets, NOW)).toEqual({
      total: 12,
      actionRequired: 0,
      syncing: 2,
      retrying: 0,
      pending: 10,
      attention: 0,
      settled: 0,
      text: '12 wallets · 2 syncing · 10 pending',
    });
  });

  it('includes only non-zero exceptional counts in summary text', () => {
    const summary = summarizeWalletSyncFleet([
      pending({ syncActionRequiredAt: CLAIMED_AT }),
      pending({ lastSyncStatus: 'retrying' }),
      running({ incrementalSyncLeaseExpiresAt: CLAIMED_AT }),
      {},
    ], NOW);
    expect(summary.text).toBe(
      '4 wallets · 1 retrying · 1 action required · 1 attention',
    );
  });

  it('selects the nearest future lease or retry boundary', () => {
    expect(getNextWalletSyncBoundary([
      running({ incrementalSyncLeaseExpiresAt: '2026-08-26T12:03:00.000Z' }),
      pending({ syncNextRetryAt: '2026-08-26T12:02:00.000Z' }),
      running({ incrementalSyncLeaseExpiresAt: '2026-08-26T11:59:00.000Z' }),
    ], NOW)).toBe(Date.parse('2026-08-26T12:02:00.000Z'));
  });
});

describe('deriveWalletSyncControls', () => {
  it.each([
    ['submitting', pending(), true, undefined, true, true],
    ['running', running(), false, undefined, true, true],
    ['incremental pending', pending(), false, undefined, true, false],
    ['full pending', {
      requestedFullResyncGeneration: 2,
      preparedFullResyncGeneration: 1,
      processedFullResyncGeneration: 1,
    }, false, undefined, true, true],
    ['action required', pending({ syncActionRequiredAt: CLAIMED_AT }), false, undefined, false, false],
    ['settled', {}, false, undefined, false, false],
  ] as const)(
    '%s derives independent button state',
    (_name, subject, requestSubmitting, acceptedIntent, syncDisabled, fullResyncDisabled) => {
      const classification = classifyWalletSyncLifecycle(subject, NOW);
      expect(deriveWalletSyncControls(subject, classification, {
        requestSubmitting,
        acceptedIntent,
      })).toMatchObject({ syncDisabled, fullResyncDisabled });
    },
  );

  it('treats accepted watermarks as pending without dynamic snapshot fields', () => {
    const classification = classifyWalletSyncLifecycle({}, NOW);
    expect(deriveWalletSyncControls({}, classification, {
      acceptedIntent: { kind: 'incremental', generation: 4 },
    })).toMatchObject({
      requestPending: true,
      incrementalPending: true,
      syncDisabled: true,
      fullResyncDisabled: false,
    });
    expect(deriveWalletSyncControls({}, classification, {
      acceptedIntent: { kind: 'full_resync', generation: 3 },
    })).toMatchObject({
      requestPending: true,
      fullResyncPending: true,
      syncDisabled: true,
      fullResyncDisabled: true,
    });
  });

  it('makes an accepted action-required reopen pending and disables duplicate submission', () => {
    const subject = pending({
      syncActionRequiredAt: CLAIMED_AT,
      lastSyncStatus: 'failed',
    });
    const intent = { kind: 'incremental', generation: 2 } as const;
    const authoritative = classifyWalletSyncLifecycle(subject, NOW);
    const projected = projectAcceptedWalletSyncIntent(subject, intent, false);

    expect(classifyWalletSyncLifecycle(projected, NOW).state).toBe('pending');
    expect(deriveWalletSyncControls(subject, authoritative, { acceptedIntent: intent }))
      .toMatchObject({
        actionRequired: false,
        requestPending: true,
        syncDisabled: true,
        fullResyncDisabled: false,
      });
    expect(classifyWalletSyncLifecycle(
      projectAcceptedWalletSyncIntent({}, intent, false),
      NOW,
    )).toMatchObject({ state: 'pending', incrementalPending: true });
  });

  it('projects full-resync intent but preserves authoritative running evidence', () => {
    const intent = { kind: 'full_resync', generation: 3 } as const;
    expect(classifyWalletSyncLifecycle(
      projectAcceptedWalletSyncIntent({}, intent, false),
      NOW,
    )).toMatchObject({ state: 'pending', fullResyncPending: true });
    const active = running();
    expect(projectAcceptedWalletSyncIntent(active, intent, true)).toBe(active);
    expect(projectAcceptedWalletSyncIntent({
      requestedFullResyncGeneration: 4,
      preparedFullResyncGeneration: 3,
      processedFullResyncGeneration: 3,
    }, intent, false)).toMatchObject({
      requestedFullResyncGeneration: 4,
      preparedFullResyncGeneration: 2,
      processedFullResyncGeneration: 2,
    });
  });
});
