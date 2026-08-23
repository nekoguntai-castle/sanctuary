import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  IncrementalSyncIntentState,
  IncrementalSyncLifecycleState,
} from '../../../src/repositories/types';

const mocks = vi.hoisted(() => ({
  walletFindUnique: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
  txQueryRaw: vi.fn(),
}));

vi.mock('../../../src/models/prisma', () => ({
  default: {
    wallet: { findUnique: mocks.walletFindUnique },
    $queryRaw: mocks.queryRaw,
    $transaction: mocks.transaction,
  },
}));

vi.mock('../../../src/generated/prisma/client', () => ({
  Prisma: {
    empty: { strings: [''], values: [] },
    raw: (value: string) => value,
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  },
}));

import {
  claimIncrementalSync,
  completeIncrementalSync,
  findActionableIncrementalSyncIntents,
  findExpiredIncrementalSyncClaims,
  findIncrementalSyncIntent,
  releaseIncrementalSyncAsActionRequired,
  releaseIncrementalSyncForRetry,
  requestIncrementalSync,
  WalletSyncMutationFenceLostError,
  withWalletSyncMutationFence,
  withWalletSyncMutationTransaction,
} from '../../../src/repositories/syncIntentRepository';

const TOKEN_A = '10000000-0000-4000-8000-000000000001';
const TOKEN_B = '20000000-0000-4000-8000-000000000002';
const NOW = new Date('2026-08-22T07:00:00.000Z');
const LATER = new Date('2026-08-22T07:05:00.000Z');

function intentState(
  overrides: Partial<IncrementalSyncIntentState> = {},
): IncrementalSyncIntentState {
  return {
    id: 'wallet-1',
    requestedIncrementalSyncGeneration: 1,
    claimedIncrementalSyncGeneration: 0,
    processedIncrementalSyncGeneration: 0,
    incrementalSyncLeaseToken: null,
    incrementalSyncClaimedAt: null,
    incrementalSyncLeaseExpiresAt: null,
    syncRetryCount: 0,
    syncNextRetryAt: null,
    syncActionRequiredAt: null,
    requestedFullResyncGeneration: 0,
    preparedFullResyncGeneration: 0,
    processedFullResyncGeneration: 0,
    ...overrides,
  };
}

function lifecycleState(
  overrides: Partial<IncrementalSyncLifecycleState> = {},
): IncrementalSyncLifecycleState {
  return {
    ...intentState(),
    syncInProgress: true,
    lastSyncedAt: null,
    lastSyncedBlockHeight: null,
    lastSyncStatus: 'syncing',
    lastSyncError: null,
    lastSyncFailureClass: null,
    syncExecutionOwner: 'worker',
    syncStartedAt: NOW,
    syncStateVersion: 1,
    ...overrides,
  };
}

describe('syncIntentRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback) => callback({
      $queryRaw: mocks.txQueryRaw,
    }));
  });

  it('reads the complete intent and fencing snapshot', async () => {
    mocks.walletFindUnique.mockResolvedValue({ id: 'wallet-1' });
    await expect(findIncrementalSyncIntent('wallet-1')).resolves.toEqual({ id: 'wallet-1' });
    expect(mocks.walletFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'wallet-1' },
      select: expect.objectContaining({
        requestedIncrementalSyncGeneration: true,
        claimedIncrementalSyncGeneration: true,
        processedIncrementalSyncGeneration: true,
        incrementalSyncLeaseToken: true,
        incrementalSyncLeaseExpiresAt: true,
        syncActionRequiredAt: true,
        preparedFullResyncGeneration: true,
      }),
    }));
  });

  it('coalesces requests to max(requested, claimed + 1)', async () => {
    mocks.queryRaw.mockResolvedValue([{
      ...intentState({ requestedIncrementalSyncGeneration: 4 }),
      previousRequestedGeneration: 4,
    }]);

    await expect(requestIncrementalSync('wallet-1')).resolves.toMatchObject({
      status: 'merged',
      state: { requestedIncrementalSyncGeneration: 4 },
    });
    const query = mocks.queryRaw.mock.calls[0][0];
    expect(query.strings.join('')).toContain('GREATEST(');
    expect(query.strings.join('')).toContain('"claimedIncrementalSyncGeneration"::BIGINT + 1');
  });

  it('reports a newly advanced request and explicit reopen policy', async () => {
    mocks.queryRaw.mockResolvedValue([{
      ...intentState(),
      previousRequestedGeneration: 0,
    }]);
    await expect(requestIncrementalSync('wallet-1', 'explicit_reopen')).resolves
      .toMatchObject({ status: 'requested' });
    expect(mocks.queryRaw.mock.calls[0][0].values).toContain(true);
  });

  it('fails closed at generation exhaustion and distinguishes a missing wallet', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    mocks.walletFindUnique.mockResolvedValueOnce(intentState()).mockResolvedValueOnce(null);
    await expect(requestIncrementalSync('wallet-1')).resolves
      .toEqual({ status: 'generation_exhausted' });
    await expect(requestIncrementalSync('missing')).resolves
      .toEqual({ status: 'not_found' });
  });

  it('claims eligible work with a fresh UUID and blocks full-resync overlap in SQL', async () => {
    mocks.queryRaw.mockResolvedValue([lifecycleState({
      claimedIncrementalSyncGeneration: 1,
      incrementalSyncLeaseToken: TOKEN_A,
      incrementalSyncClaimedAt: NOW,
      incrementalSyncLeaseExpiresAt: LATER,
    })]);
    await expect(claimIncrementalSync('wallet-1', {
      leaseToken: TOKEN_A,
      claimedAt: NOW,
      leaseExpiresAt: LATER,
      expectedRequestedGeneration: 1,
    })).resolves.toMatchObject({
      status: 'claimed',
      claim: { walletId: 'wallet-1', generation: 1, leaseToken: TOKEN_A },
    });
    const sql = mocks.queryRaw.mock.calls[0][0].strings.join('');
    expect(sql).toContain('"requestedFullResyncGeneration" = "processedFullResyncGeneration"');
    expect(sql).toContain('"syncActionRequiredAt" IS NULL');
    expect(sql).toContain('"requestedIncrementalSyncGeneration" >= ');
    expect(sql).toContain('"lastSyncStatus" = \'syncing\'');
    expect(sql).toContain('"syncStateVersion" = "syncStateVersion" + 1');
  });

  it('does not let a stale generation wake-up claim newer pending work', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    mocks.walletFindUnique.mockResolvedValue(intentState({
      requestedIncrementalSyncGeneration: 2,
      claimedIncrementalSyncGeneration: 1,
      processedIncrementalSyncGeneration: 1,
    }));
    await expect(claimIncrementalSync('wallet-1', {
      leaseToken: TOKEN_A,
      claimedAt: NOW,
      leaseExpiresAt: LATER,
      expectedRequestedGeneration: 1,
    })).resolves.toEqual({ status: 'not_claimed' });
    expect(mocks.queryRaw.mock.calls[0][0].values).toEqual(
      expect.arrayContaining([1]),
    );
    const eligibility = mocks.queryRaw.mock.calls[0][0].values.find(
      (value: unknown) => typeof value === 'object' && value !== null && 'strings' in value,
    ) as { strings: string[] };
    expect(eligibility.strings.join('')).toContain('"requestedIncrementalSyncGeneration" = ');
  });

  it('distinguishes the exact generation that already has an active claim', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    mocks.walletFindUnique.mockResolvedValue(intentState({
      requestedIncrementalSyncGeneration: 1,
      claimedIncrementalSyncGeneration: 1,
      processedIncrementalSyncGeneration: 0,
      incrementalSyncLeaseToken: TOKEN_A,
      incrementalSyncClaimedAt: NOW,
      incrementalSyncLeaseExpiresAt: LATER,
    }));

    await expect(claimIncrementalSync('wallet-1', {
      leaseToken: TOKEN_B,
      claimedAt: NOW,
      leaseExpiresAt: LATER,
      expectedRequestedGeneration: 1,
    })).resolves.toEqual({ status: 'already_claimed' });
  });

  it('retains an active claim disposition after a trailing request advances', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    mocks.walletFindUnique.mockResolvedValue(intentState({
      requestedIncrementalSyncGeneration: 2,
      claimedIncrementalSyncGeneration: 1,
      processedIncrementalSyncGeneration: 0,
      incrementalSyncLeaseToken: TOKEN_A,
    }));

    await expect(claimIncrementalSync('wallet-1', {
      leaseToken: TOKEN_B,
      claimedAt: NOW,
      leaseExpiresAt: LATER,
      expectedRequestedGeneration: 1,
    })).resolves.toEqual({ status: 'already_claimed' });
  });

  it.each([
    ['missing wallet', null],
    ['different active generation', intentState({
      requestedIncrementalSyncGeneration: 2,
      claimedIncrementalSyncGeneration: 2,
      processedIncrementalSyncGeneration: 1,
    })],
  ] as const)('keeps %s outside the exact active-claim disposition', async (_case, current) => {
    mocks.queryRaw.mockResolvedValue([]);
    mocks.walletFindUnique.mockResolvedValue(current);

    await expect(claimIncrementalSync('wallet-1', {
      leaseToken: TOKEN_B,
      claimedAt: NOW,
      leaseExpiresAt: LATER,
      expectedRequestedGeneration: 1,
    })).resolves.toEqual({ status: 'not_claimed' });
  });

  it('reclaims only an exact expired fence by rotating its token on the same generation', async () => {
    mocks.queryRaw.mockResolvedValue([lifecycleState({
      claimedIncrementalSyncGeneration: 1,
      incrementalSyncLeaseToken: TOKEN_B,
      incrementalSyncClaimedAt: LATER,
      incrementalSyncLeaseExpiresAt: new Date('2026-08-22T07:10:00.000Z'),
    })]);
    await expect(claimIncrementalSync('wallet-1', {
      leaseToken: TOKEN_B,
      claimedAt: LATER,
      leaseExpiresAt: new Date('2026-08-22T07:10:00.000Z'),
      expectedRequestedGeneration: 1,
      expectedExpiredFence: { walletId: 'wallet-1', generation: 1, leaseToken: TOKEN_A },
    })).resolves.toMatchObject({
      status: 'claimed',
      claim: { walletId: 'wallet-1', generation: 1, leaseToken: TOKEN_B },
    });
    const eligibility = mocks.queryRaw.mock.calls[0][0].values.find(
      (value: unknown) => typeof value === 'object' && value !== null && 'strings' in value,
    ) as { strings: string[] };
    expect(eligibility.strings.join('')).toContain('"incrementalSyncLeaseExpiresAt" <=');
  });

  it('rejects malformed expired-fence reclaim boundaries before querying', async () => {
    const base = {
      leaseToken: TOKEN_B,
      claimedAt: LATER,
      leaseExpiresAt: new Date('2026-08-22T07:10:00.000Z'),
      expectedRequestedGeneration: 1,
    };
    await expect(claimIncrementalSync('wallet-1', {
      ...base,
      expectedExpiredFence: { walletId: 'wallet-2', generation: 1, leaseToken: TOKEN_A },
    })).rejects.toThrow('belongs to another wallet');
    await expect(claimIncrementalSync('wallet-1', {
      ...base,
      expectedExpiredFence: { walletId: 'wallet-1', generation: 2, leaseToken: TOKEN_A },
    })).rejects.toThrow('must match the requested generation');
    await expect(claimIncrementalSync('wallet-1', {
      ...base,
      leaseToken: TOKEN_A,
      expectedExpiredFence: { walletId: 'wallet-1', generation: 1, leaseToken: TOKEN_A },
    })).rejects.toThrow('must rotate the lease token');
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it('runs ordinary and fenced mutation callbacks through explicit short transactions', async () => {
    const ordinaryCallback = vi.fn().mockResolvedValue('ordinary');
    await expect(withWalletSyncMutationTransaction(ordinaryCallback)).resolves.toBe('ordinary');

    mocks.txQueryRaw.mockResolvedValue([{
      claimedIncrementalSyncGeneration: 1,
      incrementalSyncLeaseToken: TOKEN_A,
    }]);
    const fencedCallback = vi.fn().mockResolvedValue('fenced');
    await expect(withWalletSyncMutationFence({
      walletId: 'wallet-1', generation: 1, leaseToken: TOKEN_A.toUpperCase(),
    }, fencedCallback)).resolves.toBe('fenced');

    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(ordinaryCallback).toHaveBeenCalledWith(expect.objectContaining({
      $queryRaw: mocks.txQueryRaw,
    }));
    expect(fencedCallback).toHaveBeenCalledWith(expect.objectContaining({
      $queryRaw: mocks.txQueryRaw,
    }));
    expect(mocks.transaction).toHaveBeenNthCalledWith(
      2,
      expect.any(Function),
      { timeout: 60_000 },
    );
    expect(mocks.txQueryRaw.mock.calls[0][0].strings.join('')).toContain('FOR UPDATE');
  });

  it.each([
    ['missing wallet', []],
    ['stale generation', [{
      claimedIncrementalSyncGeneration: 2,
      incrementalSyncLeaseToken: TOKEN_A,
    }]],
    ['stale token', [{
      claimedIncrementalSyncGeneration: 1,
      incrementalSyncLeaseToken: TOKEN_B,
    }]],
  ])('throws a typed lost-fence failure for a %s before invoking the callback', async (
    _case,
    lockedRows,
  ) => {
    mocks.txQueryRaw.mockResolvedValue(lockedRows);
    const callback = vi.fn();
    const fence = { walletId: 'wallet-1', generation: 1, leaseToken: TOKEN_A };
    await expect(withWalletSyncMutationFence(fence, callback)).rejects.toMatchObject({
      name: 'WalletSyncMutationFenceLostError',
      code: 'wallet_sync_mutation_fence_lost',
      fence,
    });
    expect(callback).not.toHaveBeenCalled();
    expect(new WalletSyncMutationFenceLostError(fence)).toBeInstanceOf(Error);
  });

  it('rejects malformed mutation fences before opening a transaction', async () => {
    const callback = vi.fn();
    await expect(withWalletSyncMutationFence({
      walletId: ' ', generation: 1, leaseToken: TOKEN_A,
    }, callback)).rejects.toThrow('wallet ID must not be empty');
    await expect(withWalletSyncMutationFence({
      walletId: 'wallet-1', generation: 0, leaseToken: TOKEN_A,
    }, callback)).rejects.toThrow('outside the supported range');
    await expect(withWalletSyncMutationFence({
      walletId: 'wallet-1', generation: 1, leaseToken: 'bad-token',
    }, callback)).rejects.toThrow('must be a UUID');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects malformed claim and retry boundaries before querying', async () => {
    await expect(claimIncrementalSync('wallet-1', {
      leaseToken: 'not-a-uuid',
      claimedAt: NOW,
      leaseExpiresAt: LATER,
      expectedRequestedGeneration: 1,
    })).rejects.toThrow('must be a UUID');
    await expect(claimIncrementalSync('wallet-1', {
      leaseToken: TOKEN_A,
      claimedAt: LATER,
      leaseExpiresAt: NOW,
      expectedRequestedGeneration: 1,
    })).rejects.toThrow('expire after');
    await expect(claimIncrementalSync('wallet-1', {
      leaseToken: TOKEN_A,
      claimedAt: new Date(Number.NaN),
      leaseExpiresAt: LATER,
      expectedRequestedGeneration: 1,
    })).rejects.toThrow('valid date');
    await expect(releaseIncrementalSyncForRetry(
      'wallet-1',
      { generation: 1, leaseToken: TOKEN_A },
      {
        releasedAt: LATER,
        nextRetryAt: NOW,
        errorMessage: 'retry',
        failureClass: 'other',
      },
    )).rejects.toThrow('scheduled in the future');
    await expect(completeIncrementalSync(
      'wallet-1',
      { generation: 2_147_483_648, leaseToken: TOKEN_A },
      { syncedAt: NOW, lastSyncedBlockHeight: 1 },
    )).rejects.toThrow('outside the supported range');
    await expect(claimIncrementalSync('wallet-1', {
      leaseToken: TOKEN_A,
      claimedAt: NOW,
      leaseExpiresAt: LATER,
      expectedRequestedGeneration: 0,
    })).rejects.toThrow('outside the supported range');
    await expect(claimIncrementalSync('wallet-1', {
      leaseToken: TOKEN_A,
      claimedAt: NOW,
      leaseExpiresAt: LATER,
      expectedRequestedGeneration: undefined as never,
    })).rejects.toThrow('outside the supported range');
    await expect(completeIncrementalSync(
      'wallet-1',
      { generation: 1, leaseToken: TOKEN_A },
      undefined as never,
    )).rejects.toThrow('requires success metadata');
    await expect(completeIncrementalSync(
      'wallet-1',
      { generation: 1, leaseToken: TOKEN_A },
      { syncedAt: NOW, lastSyncedBlockHeight: -1 },
    )).rejects.toThrow('non-negative integer');
    await expect(releaseIncrementalSyncForRetry(
      'wallet-1',
      { generation: 1, leaseToken: TOKEN_A },
      {
        releasedAt: NOW,
        nextRetryAt: LATER,
        errorMessage: ' ',
        failureClass: 'other',
      },
    )).rejects.toThrow('failure metadata is invalid');
    await expect(releaseIncrementalSyncAsActionRequired(
      'wallet-1',
      { generation: 1, leaseToken: TOKEN_A },
      {
        actionRequiredAt: NOW,
        errorMessage: 'failed',
        failureClass: 'invalid' as never,
      },
    )).rejects.toThrow('failure metadata is invalid');
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it('applies completion and both release policies only through the exact fence', async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([lifecycleState({
        claimedIncrementalSyncGeneration: 1,
        processedIncrementalSyncGeneration: 1,
        syncInProgress: false,
        lastSyncedAt: NOW,
        lastSyncedBlockHeight: 100,
        lastSyncStatus: 'success',
        syncExecutionOwner: null,
        syncStartedAt: null,
      })])
      .mockResolvedValueOnce([lifecycleState({
        syncRetryCount: 2,
        syncInProgress: false,
        lastSyncStatus: 'retrying',
        lastSyncError: 'node unavailable',
        lastSyncFailureClass: 'node_rpc_unavailable',
        syncStartedAt: null,
      })])
      .mockResolvedValueOnce([lifecycleState({
        syncRetryCount: 3,
        syncActionRequiredAt: LATER,
        syncInProgress: false,
        lastSyncStatus: 'failed',
        lastSyncError: 'descriptor invalid',
        lastSyncFailureClass: 'descriptor_policy_missing',
        syncExecutionOwner: null,
        syncStartedAt: null,
      })])
      .mockResolvedValueOnce([]);
    const fence = { generation: 1, leaseToken: TOKEN_A };

    await expect(completeIncrementalSync('wallet-1', fence, {
      syncedAt: NOW,
      lastSyncedBlockHeight: 100,
    })).resolves.toMatchObject({
      status: 'applied',
      trailingGenerationPending: false,
      state: {
        syncInProgress: false,
        lastSyncStatus: 'success',
        lastSyncedAt: NOW,
        lastSyncedBlockHeight: 100,
      },
    });
    await expect(releaseIncrementalSyncForRetry('wallet-1', fence, {
      releasedAt: NOW,
      nextRetryAt: LATER,
      errorMessage: 'node unavailable',
      failureClass: 'node_rpc_unavailable',
    })).resolves.toMatchObject({
      status: 'applied',
      state: { lastSyncStatus: 'retrying', lastSyncError: 'node unavailable' },
    });
    await expect(releaseIncrementalSyncAsActionRequired('wallet-1', fence, {
      actionRequiredAt: LATER,
      errorMessage: 'descriptor invalid',
      failureClass: 'descriptor_policy_missing',
    })).resolves.toMatchObject({
      status: 'applied',
      state: { lastSyncStatus: 'failed', syncActionRequiredAt: LATER },
    });
    await expect(completeIncrementalSync('wallet-1', fence, {
      syncedAt: NOW,
      lastSyncedBlockHeight: 100,
    })).resolves
      .toEqual({ status: 'lost_fence' });

    const sql = mocks.queryRaw.mock.calls.map(call => call[0].strings.join(''));
    expect(sql[0]).toContain('"lastSyncedBlockHeight" = ');
    expect(sql[1]).toContain('"lastSyncStatus" = \'retrying\'');
    expect(sql[2]).toContain('"lastSyncStatus" = \'failed\'');
  });

  it('reports a trailing generation after fenced completion', async () => {
    mocks.queryRaw.mockResolvedValue([lifecycleState({
      requestedIncrementalSyncGeneration: 2,
      claimedIncrementalSyncGeneration: 1,
      processedIncrementalSyncGeneration: 1,
    })]);
    await expect(completeIncrementalSync(
      'wallet-1',
      { generation: 1, leaseToken: TOKEN_A },
      { syncedAt: NOW, lastSyncedBlockHeight: 101 },
    )).resolves.toMatchObject({ trailingGenerationPending: true });
  });

  it('bounds recovery pages and excludes full-resync-blocked work', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await findActionableIncrementalSyncIntents({ now: NOW, cursor: 'wallet-7', limit: 500 });
    const query = mocks.queryRaw.mock.calls[0][0];
    expect(query.values).toEqual(expect.arrayContaining(['wallet-7', NOW, 100]));
    expect(query.strings.join('')).toContain(
      '"requestedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"',
    );
    expect(query.strings.join('')).toContain(
      '"requestedFullResyncGeneration" = "processedFullResyncGeneration"',
    );
    expect(query.strings.join('')).toContain(
      '"claimedIncrementalSyncGeneration" = "processedIncrementalSyncGeneration"',
    );
    expect(query.strings.join('')).not.toContain(
      '"incrementalSyncLeaseExpiresAt" <=',
    );
  });

  it('reads expired claims with an exact composite keyset cursor and bounded page', async () => {
    const cursor = {
      leaseExpiresAt: new Date('2026-08-22T06:55:00.000Z'),
      walletId: 'wallet-7',
    };
    mocks.queryRaw.mockResolvedValue([{
      walletId: 'wallet-8',
      generation: 3,
      leaseToken: TOKEN_A,
      leaseExpiresAt: NOW,
    }]);

    await expect(findExpiredIncrementalSyncClaims({ now: NOW, cursor, limit: 500 }))
      .resolves.toEqual([{
        walletId: 'wallet-8',
        generation: 3,
        leaseToken: TOKEN_A,
        leaseExpiresAt: NOW,
      }]);

    const query = mocks.queryRaw.mock.calls[0][0];
    const sql = query.strings.join('');
    const cursorFragment = query.values.find(
      (value: unknown) => typeof value === 'object' && value !== null && 'strings' in value,
    ) as { strings: string[]; values: unknown[] };
    expect(query.values).toEqual(expect.arrayContaining([NOW, 100]));
    expect(sql).toContain('ORDER BY "incrementalSyncLeaseExpiresAt" ASC, "id" ASC');
    expect(sql).toContain('"incrementalSyncLeaseToken" IS NOT NULL');
    expect(sql).toContain(
      '"requestedFullResyncGeneration" = "processedFullResyncGeneration"',
    );
    expect(sql).toContain('"syncActionRequiredAt" IS NULL');
    expect(cursorFragment.strings.join('')).toContain(
      '"incrementalSyncLeaseExpiresAt" > ',
    );
    expect(cursorFragment.strings.join('')).toContain('AND "id" > ');
    expect(cursorFragment.values).toEqual([
      cursor.leaseExpiresAt,
      cursor.leaseExpiresAt,
      cursor.walletId,
    ]);
  });

  it('defaults and validates expired-claim recovery boundaries before querying', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await findExpiredIncrementalSyncClaims({ now: NOW });
    expect(mocks.queryRaw.mock.calls[0][0].values)
      .toEqual(expect.arrayContaining([NOW, 100]));

    vi.clearAllMocks();
    await expect(findExpiredIncrementalSyncClaims({ now: new Date('invalid') }))
      .rejects.toThrow('recovery time must be a valid date');
    await expect(findExpiredIncrementalSyncClaims({
      now: NOW,
      cursor: { leaseExpiresAt: new Date('invalid'), walletId: 'wallet-1' },
    })).rejects.toThrow('cursor time must be a valid date');
    await expect(findExpiredIncrementalSyncClaims({
      now: NOW,
      cursor: { leaseExpiresAt: NOW, walletId: ' ' },
    })).rejects.toThrow('wallet ID must not be empty');
    for (const limit of [0, -1, 1.5]) {
      await expect(findExpiredIncrementalSyncClaims({ now: NOW, limit }))
        .rejects.toThrow('positive integer');
    }
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it('uses bounded recovery defaults and rejects invalid limits', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await findActionableIncrementalSyncIntents({ now: NOW });
    expect(mocks.queryRaw.mock.calls[0][0].values)
      .toEqual(expect.arrayContaining(['', NOW, 100]));

    vi.clearAllMocks();
    for (const limit of [0, -1, 1.5]) {
      await expect(findActionableIncrementalSyncIntents({ now: NOW, limit }))
        .rejects.toThrow('positive integer');
    }
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
});
