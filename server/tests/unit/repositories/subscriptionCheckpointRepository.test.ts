import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkpointFindUnique: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
  walletUpdate: vi.fn(),
}));

vi.mock('../../../src/models/prisma', () => ({
  default: {
    addressSubscriptionCheckpoint: { findUnique: mocks.checkpointFindUnique },
    $queryRaw: mocks.queryRaw,
    $transaction: mocks.transaction,
  },
}));

vi.mock('../../../src/generated/prisma/client', () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    raw: (value: string) => value,
  },
}));

import {
  completeSubscriptionEnrollment,
  findPendingSubscriptionEnrollments,
  findSubscriptionCheckpoint,
  findSubscriptionCheckpointOwners,
  requestSubscriptionEnrollment,
} from '../../../src/repositories/subscriptionCheckpointRepository';
import type { SubscriptionCheckpointState } from '../../../src/repositories/types';

const NOW = new Date('2026-08-22T10:00:00.000Z');
const SCRIPT_HASH = 'a'.repeat(64);
const OBSERVED_STATUS = 'b'.repeat(64);

function completionRow(overrides: Record<string, unknown> = {}) {
  return {
    ...checkpointState({
      scriptHash: SCRIPT_HASH,
      statusKnown: true,
      observedStatus: OBSERVED_STATUS,
      lastObservedAt: NOW,
      processedEnrollmentGeneration: 1,
    }),
    walletId: 'wallet-1',
    id: 'wallet-1',
    intentRequired: true,
    requestedIncrementalSyncGeneration: 2,
    claimedIncrementalSyncGeneration: 1,
    processedIncrementalSyncGeneration: 1,
    incrementalSyncLeaseToken: null,
    incrementalSyncClaimedAt: null,
    incrementalSyncLeaseExpiresAt: null,
    syncRetryCount: 0,
    syncNextRetryAt: null,
    syncActionRequiredAt: null,
    requestedFullResyncGeneration: 0,
    preparedFullResyncGeneration: 0,
    processedFullResyncGeneration: 0,
    syncInProgress: false,
    lastSyncedAt: null,
    lastSyncedBlockHeight: null,
    lastSyncStatus: null,
    lastSyncError: null,
    lastSyncFailureClass: null,
    syncExecutionOwner: null,
    syncStartedAt: null,
    syncStateVersion: 4,
    ...overrides,
  };
}

function checkpointState(
  overrides: Partial<SubscriptionCheckpointState> = {},
): SubscriptionCheckpointState {
  return {
    addressId: 'address-1',
    network: 'signet',
    scriptHash: null,
    statusKnown: false,
    observedStatus: null,
    lastObservedAt: null,
    requestedEnrollmentGeneration: 1,
    processedEnrollmentGeneration: 0,
    ...overrides,
  };
}

describe('subscriptionCheckpointRepository readers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback) => callback({
      $queryRaw: mocks.queryRaw,
      addressSubscriptionCheckpoint: { findUnique: mocks.checkpointFindUnique },
      wallet: { update: mocks.walletUpdate },
    }));
  });

  it('preserves statusKnown separately from a nullable observed status', async () => {
    mocks.checkpointFindUnique.mockResolvedValue({
      addressId: 'address-1',
      statusKnown: true,
      observedStatus: null,
    });
    await expect(findSubscriptionCheckpoint('address-1')).resolves.toMatchObject({
      statusKnown: true,
      observedStatus: null,
    });
    expect(mocks.checkpointFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { addressId: 'address-1' },
      select: expect.objectContaining({ statusKnown: true, observedStatus: true }),
    }));
  });

  it('finds every exact enrolled owner by validated network and script hash', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await expect(findSubscriptionCheckpointOwners('signet', SCRIPT_HASH))
      .resolves.toEqual([]);

    const query = mocks.queryRaw.mock.calls[0][0];
    expect(query.values).toEqual(['signet', 'signet', SCRIPT_HASH, '', 200]);
    expect(query.strings.join('')).toContain('"checkpoints"."statusKnown" = TRUE');
    expect(query.strings.join('')).toContain('ORDER BY "checkpoints"."addressId" ASC');
    expect(query.strings.join('')).toContain('LIMIT ');
  });

  it.each([
    ['testnet', SCRIPT_HASH, 'network'],
    ['signet', 'not-a-hash', 'script hash'],
  ])('rejects invalid checkpoint owner identity %#', async (network, scriptHash, message) => {
    await expect(findSubscriptionCheckpointOwners(network as 'signet', scriptHash))
      .rejects.toThrow(message);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it('includes checkpoint rows missing from mixed-version address writes', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await expect(findPendingSubscriptionEnrollments({
      network: 'signet',
      cursor: 'address-4',
      limit: 12,
    })).resolves.toEqual([]);

    const query = mocks.queryRaw.mock.calls[0][0];
    expect(query.values).toEqual(expect.arrayContaining(['address-4', 'signet', 12]));
    expect(query.strings.join('')).toContain('"checkpoints"."addressId" IS NULL');
    expect(query.strings.join('')).toContain(
      '"requestedEnrollmentGeneration" > "checkpoints"."processedEnrollmentGeneration"',
    );
  });

  it('uses bounded defaults for the first enrollment page', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    await findPendingSubscriptionEnrollments({ network: 'mainnet' });

    expect(mocks.queryRaw.mock.calls[0][0].values)
      .toEqual(expect.arrayContaining(['', 'mainnet', 200]));
  });

  it('scopes a pending enrollment page to the exact wallet', async () => {
    mocks.queryRaw.mockResolvedValue([]);

    await findPendingSubscriptionEnrollments({
      network: 'mainnet',
      walletId: 'wallet-1',
      cursor: 'address-4',
      limit: 12,
    });

    const query = mocks.queryRaw.mock.calls[0][0];
    expect(query.values).toEqual([
      'address-4',
      'mainnet',
      expect.objectContaining({ values: ['wallet-1'] }),
      12,
    ]);
    expect(query.values[2].strings.join('')).toContain('"addresses"."walletId" = ');
  });

  it('rejects an empty wallet enrollment scope before querying', async () => {
    await expect(findPendingSubscriptionEnrollments({
      network: 'mainnet',
      walletId: '',
    })).rejects.toThrow('wallet ID');
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it.each([0, -3, 2.5])('rejects invalid enrollment limit %s', async (limit) => {
    await expect(findPendingSubscriptionEnrollments({
      network: 'mainnet',
      limit,
    })).rejects.toThrow('positive integer');
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it('requests one pending generation and coalesces a repeated request', async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{
        ...checkpointState(),
        inserted: true,
        previousRequestedGeneration: null,
      }])
      .mockResolvedValueOnce([{
        ...checkpointState(),
        inserted: false,
        previousRequestedGeneration: 1,
      }]);

    await expect(requestSubscriptionEnrollment('address-1', 'signet')).resolves.toMatchObject({
      status: 'requested',
      state: { requestedEnrollmentGeneration: 1 },
    });
    await expect(requestSubscriptionEnrollment('address-1', 'signet')).resolves.toMatchObject({
      status: 'merged',
      state: { requestedEnrollmentGeneration: 1 },
    });

    const query = mocks.queryRaw.mock.calls[0][0];
    expect(query.strings.join('')).toContain('GREATEST');
    expect(query.strings.join('')).toContain('(xmax = 0)');
    expect(query.strings.join('')).toContain('"wallets"."network" = ');
    expect(query.values).toContain(2_147_483_647);
  });

  it('fails closed when the enrollment generation is exhausted', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    mocks.checkpointFindUnique.mockResolvedValue(checkpointState({
      requestedEnrollmentGeneration: 2_147_483_647,
      processedEnrollmentGeneration: 2_147_483_647,
    }));

    await expect(requestSubscriptionEnrollment('address-1', 'signet'))
      .resolves.toEqual({ status: 'generation_exhausted' });
  });

  it('does not apply a request when the address or owning network is unavailable', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    mocks.checkpointFindUnique.mockResolvedValue(null);

    await expect(requestSubscriptionEnrollment('address-1', 'signet'))
      .resolves.toEqual({ status: 'not_applied' });
  });

  it.each([
    ['', 'signet', 'address ID'],
    ['address-1', 'testnet', 'network'],
  ] as const)('rejects invalid request identity %#', async (addressId, network, message) => {
    await expect(requestSubscriptionEnrollment(addressId, network as 'signet'))
      .rejects.toThrow(message);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it('atomically completes the exact generation for the unchanged address', async () => {
    const completed = checkpointState({
      scriptHash: SCRIPT_HASH,
      statusKnown: true,
      observedStatus: OBSERVED_STATUS,
      lastObservedAt: NOW,
      processedEnrollmentGeneration: 1,
    });
    const target = completionRow({
      requestedIncrementalSyncGeneration: 0,
      claimedIncrementalSyncGeneration: 0,
      processedIncrementalSyncGeneration: 0,
      syncStateVersion: 0,
    });
    mocks.checkpointFindUnique.mockResolvedValue(null);
    mocks.queryRaw
      .mockResolvedValueOnce([target])
      .mockResolvedValueOnce([completed]);
    mocks.walletUpdate.mockResolvedValue(completionRow({
      requestedIncrementalSyncGeneration: 1,
      claimedIncrementalSyncGeneration: 0,
      processedIncrementalSyncGeneration: 0,
      syncStateVersion: 1,
    }));

    await expect(completeSubscriptionEnrollment({
      addressId: 'address-1',
      address: 'tb1qexample',
      network: 'signet',
      generation: 1,
      scriptHash: SCRIPT_HASH,
      observedStatus: OBSERVED_STATUS,
      observedAt: NOW,
    })).resolves.toMatchObject({
      status: 'applied',
      state: completed,
      syncIntent: {
        walletId: 'wallet-1',
        generation: 1,
        state: {
          id: 'wallet-1',
          requestedIncrementalSyncGeneration: 1,
          syncStateVersion: 1,
        },
      },
    });

    const query = mocks.queryRaw.mock.calls[1][0];
    const sql = query.strings.join('');
    expect(sql).toContain('INSERT INTO "address_subscription_checkpoints"');
    expect(sql).toContain('ON CONFLICT ("addressId") DO UPDATE');
    expect(sql).toContain('checkpoint."requestedEnrollmentGeneration" = ');
    expect(sql).toContain('checkpoint."processedEnrollmentGeneration" < ');
    expect(sql).toContain('"requestedEnrollmentGeneration" = ');
    expect(sql).toContain('"processedEnrollmentGeneration" < ');
    expect(query.values).toEqual(expect.arrayContaining([
      'address-1',
      'signet',
      1,
      SCRIPT_HASH,
      OBSERVED_STATUS,
      NOW,
    ]));
  });

  it('establishes an unknown null checkpoint without returning sync intent', async () => {
    mocks.checkpointFindUnique.mockResolvedValue(null);
    mocks.queryRaw
      .mockResolvedValueOnce([completionRow()])
      .mockResolvedValueOnce([checkpointState({
        scriptHash: SCRIPT_HASH,
        statusKnown: true,
        observedStatus: null,
        lastObservedAt: NOW,
        processedEnrollmentGeneration: 1,
      })]);

    await expect(completeSubscriptionEnrollment({
      addressId: 'address-1',
      address: 'tb1qexample',
      network: 'signet',
      generation: 1,
      scriptHash: SCRIPT_HASH,
      observedStatus: null,
      observedAt: NOW,
    })).resolves.toMatchObject({ status: 'applied', syncIntent: null });
  });

  it('reports stale or concurrent completion as not applied', async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);
    await expect(completeSubscriptionEnrollment({
      addressId: 'address-1',
      address: 'tb1qexample',
      network: 'signet',
      generation: 1,
      scriptHash: SCRIPT_HASH,
      observedStatus: null,
      observedAt: NOW,
    })).resolves.toEqual({ status: 'not_applied' });
  });

  it('rolls back and reports not applied when the checkpoint write loses its race', async () => {
    mocks.checkpointFindUnique.mockResolvedValue(null);
    mocks.queryRaw
      .mockResolvedValueOnce([completionRow()])
      .mockResolvedValueOnce([]);

    await expect(completeSubscriptionEnrollment({
      addressId: 'address-1',
      address: 'tb1qexample',
      network: 'signet',
      generation: 1,
      scriptHash: SCRIPT_HASH,
      observedStatus: null,
      observedAt: NOW,
    })).resolves.toEqual({ status: 'not_applied' });
  });

  it('rolls back when an existing checkpoint update loses its race', async () => {
    mocks.checkpointFindUnique.mockResolvedValue(checkpointState());
    mocks.queryRaw
      .mockResolvedValueOnce([completionRow()])
      .mockResolvedValueOnce([]);

    await expect(completeSubscriptionEnrollment({
      addressId: 'address-1',
      address: 'tb1qexample',
      network: 'signet',
      generation: 1,
      scriptHash: SCRIPT_HASH,
      observedStatus: null,
      observedAt: NOW,
    })).resolves.toEqual({ status: 'not_applied' });
  });

  it('does not apply after locking when the checkpoint generation became ineligible', async () => {
    mocks.queryRaw.mockResolvedValueOnce([completionRow()]);
    mocks.checkpointFindUnique.mockResolvedValue(checkpointState({
      requestedEnrollmentGeneration: 2,
    }));

    await expect(completeSubscriptionEnrollment({
      addressId: 'address-1',
      address: 'tb1qexample',
      network: 'signet',
      generation: 1,
      scriptHash: SCRIPT_HASH,
      observedStatus: null,
      observedAt: NOW,
    })).resolves.toEqual({ status: 'not_applied' });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it('coalesces changed status into an already-pending wallet generation', async () => {
    const current = checkpointState({
      statusKnown: true,
      observedStatus: null,
    });
    const target = completionRow({
      requestedIncrementalSyncGeneration: 5,
      claimedIncrementalSyncGeneration: 1,
    });
    const completed = checkpointState({
      statusKnown: true,
      observedStatus: OBSERVED_STATUS,
      scriptHash: SCRIPT_HASH,
      lastObservedAt: NOW,
      processedEnrollmentGeneration: 1,
    });
    mocks.checkpointFindUnique.mockResolvedValue(current);
    mocks.queryRaw
      .mockResolvedValueOnce([target])
      .mockResolvedValueOnce([completed]);

    await expect(completeSubscriptionEnrollment({
      addressId: 'address-1',
      address: 'tb1qexample',
      network: 'signet',
      generation: 1,
      scriptHash: SCRIPT_HASH,
      observedStatus: OBSERVED_STATUS,
      observedAt: NOW,
    })).resolves.toMatchObject({
      status: 'applied',
      syncIntent: { walletId: 'wallet-1', generation: 5, state: target },
    });
    expect(mocks.walletUpdate).not.toHaveBeenCalled();
  });

  it('propagates unexpected transaction failures', async () => {
    const failure = new Error('database unavailable');
    mocks.transaction.mockRejectedValueOnce(failure);

    await expect(completeSubscriptionEnrollment({
      addressId: 'address-1',
      address: 'tb1qexample',
      network: 'signet',
      generation: 1,
      scriptHash: SCRIPT_HASH,
      observedStatus: null,
      observedAt: NOW,
    })).rejects.toBe(failure);
  });

  it('reports generation exhaustion distinctly from a lost exact-generation race', async () => {
    const current = checkpointState({
      statusKnown: true,
      observedStatus: null,
      requestedEnrollmentGeneration: 2,
      processedEnrollmentGeneration: 1,
    });
    mocks.checkpointFindUnique.mockResolvedValue(current);
    mocks.queryRaw
      .mockResolvedValueOnce([completionRow({
        requestedIncrementalSyncGeneration: 2_147_483_647,
        claimedIncrementalSyncGeneration: 2_147_483_647,
      })])
      .mockResolvedValueOnce([{
        ...current,
        observedStatus: OBSERVED_STATUS,
        processedEnrollmentGeneration: 2,
      }]);

    await expect(completeSubscriptionEnrollment({
      addressId: 'address-1',
      address: 'tb1qexample',
      network: 'signet',
      generation: 2,
      scriptHash: SCRIPT_HASH,
      observedStatus: OBSERVED_STATUS,
      observedAt: NOW,
    })).resolves.toEqual({ status: 'generation_exhausted' });
  });

  it.each([
    [{ generation: 0 }, 'generation'],
    [{ scriptHash: 'A'.repeat(64) }, 'script hash'],
    [{ observedStatus: 'not-a-status' }, 'observed status'],
    [{ observedAt: new Date('invalid') }, 'valid date'],
    [{ address: ' ' }, 'address must be non-empty'],
  ])('rejects invalid completion evidence %#', async (override, message) => {
    await expect(completeSubscriptionEnrollment({
      addressId: 'address-1',
      address: 'tb1qexample',
      network: 'signet',
      generation: 1,
      scriptHash: SCRIPT_HASH,
      observedStatus: null,
      observedAt: NOW,
      ...override,
    })).rejects.toThrow(message as string);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
});
