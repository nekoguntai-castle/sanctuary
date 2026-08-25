import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const model = () => ({
    count: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
  });
  return {
    queryRaw: vi.fn(),
    transaction: vi.fn(),
    checkpoint: model(),
    reconciliation: model(),
    stagedHeader: model(),
    history: model(),
    confirmationRetry: model(),
  };
});

vi.mock('../../../src/models/prisma', () => {
  const client = {
    $queryRaw: mocks.queryRaw,
    $transaction: mocks.transaction,
    networkHeaderCheckpoint: mocks.checkpoint,
    networkHeaderReconciliation: mocks.reconciliation,
    networkHeaderReconciliationHeader: mocks.stagedHeader,
    networkHeaderHistory: mocks.history,
    networkHeaderConfirmationRetry: mocks.confirmationRetry,
  };
  return { default: client };
});

import {
  claimNetworkHeaderReconciliation,
  finalizeNetworkHeaderReconciliation,
  findDueNetworkHeaderReconciliations,
  findNetworkHeaderHistory,
  observeNetworkHeader,
  findNetworkHeaderConfirmationRetries,
  recordNetworkHeaderConfirmationPage,
  recordNetworkHeaderConfirmationRetryResult,
  recordNetworkHeaderCursor,
  recordNetworkHeaderReconciliationFailure,
  resetNetworkHeaderCursor,
} from '../../../src/repositories/networkHeaderReconciliationRepository';

const NOW = new Date('2026-08-24T10:00:00.000Z');
const FUTURE = new Date('2026-08-24T10:05:00.000Z');
const OBSERVED_AT = new Date('2026-08-24T09:59:00.000Z');
const GAP_STARTED_AT = new Date('2026-08-23T10:00:00.000Z');
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const GENESIS_HASH = '0'.repeat(64);
const HEADER = 'ab'.repeat(80);
const OWNER_A = 'owner-token-alpha';
const OWNER_B = 'owner-token-bravo';

const checkpointRow = (overrides: Record<string, unknown> = {}) => ({
  network: 'mainnet',
  lastProcessedHeight: 100,
  lastProcessedHash: HASH_A,
  observedAt: OBSERVED_AT,
  coverageGapStartedAt: null,
  ...overrides,
});

const stateRow = (overrides: Record<string, unknown> = {}) => ({
  network: 'mainnet',
  generation: 3,
  ownerToken: OWNER_A,
  mode: 'forward',
  targetHeight: 103,
  targetHash: HASH_C,
  targetHeaderHex: HEADER,
  targetObservedAt: OBSERVED_AT,
  anchorHeight: 100,
  anchorHash: HASH_A,
  cursorHeight: null,
  cursorHash: null,
  confirmationCursorWalletId: null,
  confirmationEnumerationComplete: false,
  pendingTargetHeight: null,
  pendingTargetHash: null,
  pendingTargetPreviousHash: null,
  pendingTargetHeaderHex: null,
  pendingTargetObservedAt: null,
  pendingTargetGenesisHash: null,
  gapStartedAt: GAP_STARTED_AT,
  lastAttemptAt: null,
  lastFailureClass: null,
  consecutiveFailureCount: 0,
  retryEligibleAt: NOW,
  createdAt: GAP_STARTED_AT,
  updatedAt: NOW,
  ...overrides,
});

const observation = (overrides: Record<string, unknown> = {}) => ({
  network: 'mainnet' as const,
  ownerToken: OWNER_A,
  height: 103,
  hash: HASH_C,
  previousHash: HASH_B,
  headerHex: HEADER,
  observedAt: OBSERVED_AT,
  genesisHash: GENESIS_HASH,
  ...overrides,
});

const header = (height: number, hash: string, previousHash: string) => ({
  height,
  hash,
  previousHash,
  observedAt: OBSERVED_AT,
});

const pendingTarget = {
  pendingTargetHeight: 104,
  pendingTargetHash: 'd'.repeat(64),
  pendingTargetPreviousHash: HASH_C,
  pendingTargetHeaderHex: HEADER,
  pendingTargetObservedAt: OBSERVED_AT,
  pendingTargetGenesisHash: GENESIS_HASH,
};

function queueRaw(...results: unknown[]): void {
  for (const result of results) mocks.queryRaw.mockResolvedValueOnce(result);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.stagedHeader.findMany.mockResolvedValue([]);
  mocks.confirmationRetry.count.mockResolvedValue(0);
  mocks.confirmationRetry.findMany.mockResolvedValue([]);
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
    $queryRaw: mocks.queryRaw,
    networkHeaderCheckpoint: mocks.checkpoint,
    networkHeaderReconciliation: mocks.reconciliation,
    networkHeaderReconciliationHeader: mocks.stagedHeader,
    networkHeaderHistory: mocks.history,
    networkHeaderConfirmationRetry: mocks.confirmationRetry,
  }));
});

describe('observeNetworkHeader', () => {
  it('starts a genesis rebuild when the network has no proven checkpoint', async () => {
    queueRaw([{ now: NOW }], [], []);
    mocks.reconciliation.create.mockResolvedValue(stateRow({
      generation: 1,
      mode: 'genesis_rebuild',
      anchorHeight: 0,
      anchorHash: GENESIS_HASH,
      gapStartedAt: NOW,
    }));

    await expect(observeNetworkHeader(observation())).resolves.toMatchObject({
      generation: 1,
      mode: 'genesis_rebuild',
      anchorHeight: 0,
      anchorHash: GENESIS_HASH,
      gapStartedAt: NOW,
    });
    expect(mocks.checkpoint.update).not.toHaveBeenCalled();
    expect(mocks.reconciliation.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      generation: 1,
      mode: 'genesis_rebuild',
      retryEligibleAt: NOW,
    }) });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('retains the original checkpoint gap while opening forward reconciliation', async () => {
    queueRaw(
      [{ now: NOW }],
      [checkpointRow({ coverageGapStartedAt: GAP_STARTED_AT })],
      [],
    );
    mocks.checkpoint.update.mockResolvedValue(checkpointRow({ coverageGapStartedAt: GAP_STARTED_AT }));
    mocks.reconciliation.create.mockResolvedValue(stateRow());

    await observeNetworkHeader(observation());

    expect(mocks.checkpoint.update).toHaveBeenCalledWith({
      where: { network: 'mainnet' },
      data: { coverageGapStartedAt: GAP_STARTED_AT },
    });
    expect(mocks.reconciliation.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      mode: 'forward',
      anchorHeight: 100,
      anchorHash: HASH_A,
      gapStartedAt: GAP_STARTED_AT,
    }) });
  });

  it('resets incompatible target work and advances its generation', async () => {
    const current = stateRow({ targetHeight: 103, targetHash: HASH_C });
    const reset = stateRow({
      generation: 4,
      targetHeight: 99,
      targetHash: HASH_B,
      mode: 'ancestor_search',
      anchorHeight: 0,
      anchorHash: GENESIS_HASH,
    });
    queueRaw([{ now: NOW }], [checkpointRow()], [current]);
    mocks.reconciliation.update.mockResolvedValue(reset);

    await expect(observeNetworkHeader(observation({
      height: 99,
      hash: HASH_B,
      previousHash: HASH_A,
    }))).resolves.toMatchObject({ generation: 4, mode: 'ancestor_search' });

    expect(mocks.stagedHeader.deleteMany).toHaveBeenCalledWith({ where: { network: 'mainnet' } });
    expect(mocks.confirmationRetry.deleteMany).toHaveBeenCalledWith({
      where: { network: 'mainnet' },
    });
    expect(mocks.reconciliation.update).toHaveBeenCalledWith({
      where: { network: 'mainnet' },
      data: expect.objectContaining({
        generation: 4,
        mode: 'ancestor_search',
        cursorHeight: null,
        cursorHash: null,
      }),
    });
  });

  it('coalesces a compatible observation behind a proven target without disturbing confirmation progress', async () => {
    const current = stateRow({
      cursorHeight: 103,
      cursorHash: HASH_C,
      confirmationCursorWalletId: 'wallet-z',
    });
    queueRaw([{ now: NOW }], [checkpointRow()], [current]);
    mocks.reconciliation.update.mockResolvedValue(stateRow({
      generation: 4,
      cursorHeight: 103,
      cursorHash: HASH_C,
      confirmationCursorWalletId: 'wallet-z',
      pendingTargetHeight: 104,
      pendingTargetHash: 'd'.repeat(64),
      pendingTargetPreviousHash: HASH_C,
      pendingTargetHeaderHex: HEADER,
      pendingTargetObservedAt: OBSERVED_AT,
      pendingTargetGenesisHash: GENESIS_HASH,
    }));

    await observeNetworkHeader(observation({
      height: 104,
      hash: 'd'.repeat(64),
      previousHash: HASH_C,
    }));

    expect(mocks.stagedHeader.deleteMany).not.toHaveBeenCalled();
    expect(mocks.reconciliation.update).toHaveBeenCalledWith({
      where: { network: 'mainnet' },
      data: expect.objectContaining({
        generation: 4,
        pendingTargetHeight: 104,
        pendingTargetHash: 'd'.repeat(64),
        pendingTargetPreviousHash: HASH_C,
        pendingTargetHeaderHex: HEADER,
        pendingTargetObservedAt: OBSERVED_AT,
        pendingTargetGenesisHash: GENESIS_HASH,
      }),
    });
    const update = mocks.reconciliation.update.mock.calls[0][0].data;
    expect(update).not.toHaveProperty('targetHeight');
    expect(update).not.toHaveProperty('cursorHeight');
    expect(update).not.toHaveProperty('confirmationCursorWalletId');
  });

  it('fences an incompatible observation behind a frozen proven target', async () => {
    const current = stateRow({
      cursorHeight: 103,
      cursorHash: HASH_C,
      confirmationCursorWalletId: 'wallet-z',
    });
    queueRaw([{ now: NOW }], [checkpointRow()], [current]);
    mocks.reconciliation.update.mockResolvedValue(stateRow({
      generation: 4,
      cursorHeight: 103,
      cursorHash: HASH_C,
      confirmationCursorWalletId: 'wallet-z',
      pendingTargetHeight: 99,
      pendingTargetHash: HASH_B,
      pendingTargetPreviousHash: HASH_A,
      pendingTargetHeaderHex: HEADER,
      pendingTargetObservedAt: OBSERVED_AT,
      pendingTargetGenesisHash: GENESIS_HASH,
    }));

    await observeNetworkHeader(observation({
      height: 99,
      hash: HASH_B,
      previousHash: HASH_A,
    }));

    expect(mocks.stagedHeader.deleteMany).not.toHaveBeenCalled();
    expect(mocks.reconciliation.update).toHaveBeenCalledWith({
      where: { network: 'mainnet' },
      data: expect.objectContaining({
        generation: 4,
        pendingTargetHeight: 99,
        pendingTargetHash: HASH_B,
        pendingTargetPreviousHash: HASH_A,
        pendingTargetGenesisHash: GENESIS_HASH,
      }),
    });
    expect(mocks.reconciliation.update.mock.calls[0][0].data)
      .not.toHaveProperty('confirmationCursorWalletId');
  });

  it('fences a new frozen-target owner without accelerating persisted retry eligibility', async () => {
    const retryEligibleAt = new Date(NOW.getTime() + 60_000);
    const current = stateRow({
      cursorHeight: 103,
      cursorHash: HASH_C,
      confirmationCursorWalletId: 'wallet-z',
      retryEligibleAt,
    });
    queueRaw([{ now: NOW }], [checkpointRow()], [current]);
    mocks.reconciliation.update.mockResolvedValue(stateRow({
      generation: 4,
      ownerToken: OWNER_B,
      cursorHeight: 103,
      cursorHash: HASH_C,
      confirmationCursorWalletId: 'wallet-z',
      retryEligibleAt,
      ...pendingTarget,
    }));

    await observeNetworkHeader(observation({
      ownerToken: OWNER_B,
      height: 104,
      hash: pendingTarget.pendingTargetHash,
      previousHash: HASH_C,
    }));

    expect(mocks.reconciliation.update).toHaveBeenCalledWith({
      where: { network: 'mainnet' },
      data: expect.objectContaining({
        generation: 4,
        ownerToken: OWNER_B,
        retryEligibleAt,
        pendingTargetHeight: 104,
      }),
    });
  });

  it('updates a newer target without clearing or accelerating persisted backoff', async () => {
    const retryEligibleAt = new Date(NOW.getTime() + 60_000);
    const current = stateRow({
      targetHeight: 102,
      targetHash: HASH_B,
      lastFailureClass: 'endpoint_unavailable',
      consecutiveFailureCount: 3,
      retryEligibleAt,
    });
    queueRaw([{ now: NOW }], [checkpointRow()], [current]);
    mocks.reconciliation.update.mockResolvedValue(stateRow({
      generation: 4,
      retryEligibleAt,
    }));

    await observeNetworkHeader(observation());

    expect(mocks.reconciliation.update).toHaveBeenCalledWith({
      where: { network: 'mainnet' },
      data: expect.objectContaining({ retryEligibleAt }),
    });
    expect(mocks.reconciliation.update.mock.calls[0][0].data)
      .not.toHaveProperty('lastFailureClass');
    expect(mocks.reconciliation.update.mock.calls[0][0].data)
      .not.toHaveProperty('consecutiveFailureCount');
  });

  it('preserves the generation and confirmation cursor for an identical observation', async () => {
    const current = stateRow({ confirmationCursorWalletId: 'wallet-z' });
    queueRaw([{ now: NOW }], [checkpointRow()], [current]);
    mocks.reconciliation.update.mockResolvedValue(current);

    await observeNetworkHeader(observation());

    expect(mocks.reconciliation.update).toHaveBeenCalledWith({
      where: { network: 'mainnet' },
      data: expect.objectContaining({ generation: 3 }),
    });
    expect(mocks.reconciliation.update.mock.calls[0][0].data)
      .not.toHaveProperty('confirmationCursorWalletId');
  });

  it('keeps duplicate observations in forward mode at the proven checkpoint', async () => {
    queueRaw([{ now: NOW }], [checkpointRow()], []);
    mocks.reconciliation.create.mockResolvedValue(stateRow({ targetHeight: 100, targetHash: HASH_A }));

    await observeNetworkHeader(observation({
      height: 100,
      hash: HASH_A,
      previousHash: HASH_B,
    }));

    expect(mocks.reconciliation.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      mode: 'forward',
      anchorHeight: 100,
      anchorHash: HASH_A,
    }) });
  });

  it('changes a compatible target owner by advancing the generation without resetting proof', async () => {
    queueRaw([{ now: NOW }], [checkpointRow()], [stateRow({ targetHeight: 102, targetHash: HASH_B })]);
    mocks.reconciliation.update.mockResolvedValue(stateRow({ generation: 4, ownerToken: OWNER_B }));

    await observeNetworkHeader(observation({ ownerToken: OWNER_B }));

    expect(mocks.stagedHeader.deleteMany).not.toHaveBeenCalled();
    expect(mocks.reconciliation.update).toHaveBeenCalledWith({
      where: { network: 'mainnet' },
      data: expect.objectContaining({ generation: 4, ownerToken: OWNER_B }),
    });
  });

  it('resets same-height work when the observed target identity changes', async () => {
    queueRaw([{ now: NOW }], [checkpointRow()], [stateRow({ targetHeight: 103, targetHash: HASH_B })]);
    mocks.reconciliation.update.mockResolvedValue(stateRow({ generation: 4 }));

    await observeNetworkHeader(observation());

    expect(mocks.stagedHeader.deleteMany).toHaveBeenCalledWith({ where: { network: 'mainnet' } });
    expect(mocks.confirmationRetry.deleteMany).toHaveBeenCalledWith({
      where: { network: 'mainnet' },
    });
  });

  it.each([
    ['short owner token', { ownerToken: 'short' }, 'owner token'],
    ['negative height', { height: -1 }, 'valid block height'],
    ['uppercase hash', { hash: 'A'.repeat(64) }, 'lowercase block hash'],
    ['short wire header', { headerHex: 'ab' }, 'exactly 80 bytes'],
    ['invalid observation time', { observedAt: new Date(Number.NaN) }, 'time is invalid'],
  ])('rejects an observation with a %s before opening a transaction', async (_label, overrides, reason) => {
    await expect(observeNetworkHeader(observation(overrides))).rejects.toThrow(reason);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

describe('ownership, scan, and failure evidence', () => {
  it('changes owners by advancing the generation fence', async () => {
    queueRaw([stateRow()]);
    mocks.reconciliation.update.mockResolvedValue(stateRow({ generation: 4, ownerToken: OWNER_B }));

    await expect(claimNetworkHeaderReconciliation('mainnet', OWNER_B)).resolves.toMatchObject({
      generation: 4,
      ownerToken: OWNER_B,
    });
    expect(mocks.reconciliation.update).toHaveBeenCalledWith({
      where: { network: 'mainnet' },
      data: expect.objectContaining({ generation: 4, ownerToken: OWNER_B }),
    });
  });

  it.each([
    ['no work', []],
    ['already owned work', [stateRow()]],
  ])('returns %s without writing', async (_label, lockedRows) => {
    queueRaw(lockedRows);

    const result = await claimNetworkHeaderReconciliation('mainnet', OWNER_A);

    expect(result).toEqual(lockedRows[0] ?? null);
    expect(mocks.reconciliation.update).not.toHaveBeenCalled();
  });

  it('returns only database-clock-due work in deterministic order', async () => {
    queueRaw([{ now: NOW }]);
    mocks.reconciliation.findMany.mockResolvedValue([
      stateRow(),
      stateRow({ network: 'signet', ownerToken: OWNER_B }),
    ]);

    await expect(findDueNetworkHeaderReconciliations(2)).resolves.toHaveLength(2);
    expect(mocks.reconciliation.findMany).toHaveBeenCalledWith({
      where: { retryEligibleAt: { lte: NOW } },
      orderBy: [{ retryEligibleAt: 'asc' }, { network: 'asc' }],
      take: 2,
    });
  });

  it('records retry evidence only when the full owner fence still matches', async () => {
    queueRaw([stateRow()], [{ now: NOW }]);

    await expect(recordNetworkHeaderReconciliationFailure({
      network: 'mainnet',
      generation: 3,
      ownerToken: OWNER_A,
      failureClass: 'validation_failed',
      retryDelayMs: 5_000,
    })).resolves.toBe(true);
    expect(mocks.reconciliation.update).toHaveBeenCalledWith({
      where: { network: 'mainnet' },
      data: {
        lastAttemptAt: NOW,
        lastFailureClass: 'validation_failed',
        consecutiveFailureCount: 1,
        retryEligibleAt: new Date(NOW.getTime() + 5_000),
      },
    });
  });

  it('caps persisted exponential failure backoff at five minutes', async () => {
    queueRaw([stateRow({ consecutiveFailureCount: 6 })], [{ now: NOW }]);

    await expect(recordNetworkHeaderReconciliationFailure({
      network: 'mainnet',
      generation: 3,
      ownerToken: OWNER_A,
      failureClass: 'endpoint_unavailable',
      retryDelayMs: 5_000,
    })).resolves.toBe(true);

    expect(mocks.reconciliation.update).toHaveBeenCalledWith({
      where: { network: 'mainnet' },
      data: expect.objectContaining({
        consecutiveFailureCount: 7,
        retryEligibleAt: new Date(NOW.getTime() + 300_000),
      }),
    });
  });

  it('reports a lost failure-evidence fence without mutating another owner', async () => {
    queueRaw([stateRow({ ownerToken: OWNER_B })]);

    await expect(recordNetworkHeaderReconciliationFailure({
      network: 'mainnet',
      generation: 3,
      ownerToken: OWNER_A,
      failureClass: 'ownership_lost',
      retryDelayMs: 0,
    })).resolves.toBe(false);
    expect(mocks.reconciliation.update).not.toHaveBeenCalled();
  });

  it('rejects an unknown failure class before reading the database clock', async () => {
    await expect(recordNetworkHeaderReconciliationFailure({
      network: 'mainnet',
      generation: 3,
      ownerToken: OWNER_A,
      failureClass: 'mystery' as 'validation_failed',
      retryDelayMs: 0,
    })).rejects.toThrow('failure class is invalid');
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5, 3_600_001])('rejects invalid retry delay %s', async retryDelayMs => {
    await expect(recordNetworkHeaderReconciliationFailure({
      network: 'mainnet',
      generation: 3,
      ownerToken: OWNER_A,
      failureClass: 'validation_failed',
      retryDelayMs,
    })).rejects.toThrow('retry delay is invalid');
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it('rejects corrupt rows returned by a due scan instead of treating them as work', async () => {
    queueRaw([{ now: NOW }]);
    mocks.reconciliation.findMany.mockResolvedValue([stateRow({
      cursorHeight: 101,
      cursorHash: null,
    })]);

    await expect(findDueNetworkHeaderReconciliations()).rejects.toThrow('cursor identity is incomplete');
  });

  it.each([
    ['cursor beyond target', { cursorHeight: 104, cursorHash: HASH_B }],
    ['wrong identity at target', { cursorHeight: 103, cursorHash: HASH_B }],
  ])('rejects a reconciliation row with %s', async (_label, overrides) => {
    queueRaw([{ now: NOW }]);
    mocks.reconciliation.findMany.mockResolvedValue([stateRow(overrides)]);

    await expect(findDueNetworkHeaderReconciliations()).rejects.toThrow(
      'cursor is inconsistent with its target',
    );
  });

  it.each([
    ['generation', { generation: 0 }, 'generation is invalid'],
    ['mode', { mode: 'sideways' }, 'mode is invalid'],
    ['target header', { targetHeaderHex: 'ab' }, 'target is malformed'],
    ['target observation time', { targetObservedAt: new Date(Number.NaN) }, 'target observation time is invalid'],
    ['gap start time', { gapStartedAt: new Date(Number.NaN) }, 'gap start time is invalid'],
    ['retry time', { retryEligibleAt: new Date(Number.NaN) }, 'retry eligibility time is invalid'],
    ['attempt time', { lastAttemptAt: new Date(Number.NaN) }, 'attempt time is invalid'],
    ['failure class', { lastFailureClass: 'mystery' }, 'failure class is invalid'],
    ['failure count', { consecutiveFailureCount: 31 }, 'failure count is invalid'],
    ['confirmation cursor', { confirmationCursorWalletId: '' }, 'confirmation cursor is invalid'],
    ['confirmation phase', { confirmationEnumerationComplete: 'yes' }, 'confirmation phase is invalid'],
    ['incomplete pending target', { pendingTargetHeight: 104 }, 'pending target is incomplete'],
    ['malformed pending header', {
      ...pendingTarget,
      cursorHeight: 103,
      cursorHash: HASH_C,
      pendingTargetHeaderHex: 'ab',
    }, 'pending target is malformed'],
    ['invalid pending time', {
      ...pendingTarget,
      cursorHeight: 103,
      cursorHash: HASH_C,
      pendingTargetObservedAt: new Date(Number.NaN),
    }, 'pending target time is invalid'],
    ['pending target on unproven work', pendingTarget, 'pending target requires a proven active target'],
  ])('rejects corrupt persisted %s', async (_label, overrides, reason) => {
    queueRaw([{ now: NOW }]);
    mocks.reconciliation.findMany.mockResolvedValue([stateRow(overrides)]);

    await expect(findDueNetworkHeaderReconciliations()).rejects.toThrow(reason);
  });

  it('rejects an unavailable database clock rather than using process time', async () => {
    queueRaw([]);
    await expect(findDueNetworkHeaderReconciliations()).rejects.toThrow('database clock is unavailable');
  });

  it.each([0, 101, 1.5])('rejects invalid due-scan limit %s', async limit => {
    await expect(findDueNetworkHeaderReconciliations(limit)).rejects.toThrow('scan limit is invalid');
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
});

describe('cursor staging and reset', () => {
  it('stages a CAS-matched page, advances the cursor, and prunes the bounded tail', async () => {
    const current = stateRow({ cursorHeight: 100, cursorHash: HASH_A, targetHeight: 102 });
    const updated = stateRow({
      cursorHeight: 102,
      cursorHash: HASH_C,
      targetHeight: 102,
      lastAttemptAt: NOW,
    });
    queueRaw([current], [{ now: NOW }]);
    mocks.stagedHeader.findMany.mockResolvedValue([]);
    mocks.reconciliation.update.mockResolvedValue(updated);
    const headers = [header(101, HASH_B, HASH_A), header(102, HASH_C, HASH_B)];

    await expect(recordNetworkHeaderCursor({
      network: 'mainnet',
      generation: 3,
      ownerToken: OWNER_A,
      expectedCursor: { height: 100, hash: HASH_A },
      headers,
    })).resolves.toMatchObject({ cursorHeight: 102, cursorHash: HASH_C });

    expect(mocks.stagedHeader.createMany).toHaveBeenCalledWith({
      data: headers.map(item => ({ network: 'mainnet', ...item })),
      skipDuplicates: true,
    });
    expect(mocks.stagedHeader.deleteMany).toHaveBeenCalledWith({
      where: { network: 'mainnet', height: { lt: 0 } },
    });
  });

  it('accepts a null cursor only when the first record exactly revalidates the anchor', async () => {
    const current = stateRow({ targetHeight: 101, targetHash: HASH_B });
    const updated = stateRow({
      targetHeight: 101,
      targetHash: HASH_B,
      cursorHeight: 100,
      cursorHash: HASH_A,
    });
    queueRaw([current], [{ now: NOW }]);
    mocks.reconciliation.update.mockResolvedValue(updated);

    await expect(recordNetworkHeaderCursor({
      network: 'mainnet',
      generation: 3,
      ownerToken: OWNER_A,
      expectedCursor: null,
      headers: [header(100, HASH_A, GENESIS_HASH)],
    })).resolves.toMatchObject({ cursorHeight: 100, cursorHash: HASH_A });
  });

  it.each([
    ['malformed hash', [header(101, 'x'.repeat(64), HASH_A)], 'lowercase block hash'],
    ['invalid date', [{ ...header(101, HASH_B, HASH_A), observedAt: new Date(Number.NaN) }], 'time is invalid'],
    ['height gap', [header(101, HASH_B, HASH_A), header(103, HASH_C, HASH_B)], 'not a contiguous chain'],
    ['broken parent link', [header(101, HASH_B, HASH_A), header(102, HASH_C, HASH_A)], 'not a contiguous chain'],
    ['target overshoot', [header(101, HASH_B, HASH_A), header(102, HASH_C, HASH_B)], 'beyond its target'],
    ['wrong target hash', [header(101, HASH_B, HASH_A)], 'does not prove the target identity'],
  ])('rejects a page with %s before staging it', async (_label, headers, reason) => {
    queueRaw([stateRow({
      cursorHeight: 100,
      cursorHash: HASH_A,
      targetHeight: 101,
      targetHash: HASH_C,
    })]);

    await expect(recordNetworkHeaderCursor({
      network: 'mainnet',
      generation: 3,
      ownerToken: OWNER_A,
      expectedCursor: { height: 100, hash: HASH_A },
      headers,
    })).rejects.toThrow(reason);
    expect(mocks.stagedHeader.createMany).not.toHaveBeenCalled();
  });

  it('requires the first page to revalidate the persisted anchor identity', async () => {
    queueRaw([stateRow({ targetHeight: 101, targetHash: HASH_B })]);

    await expect(recordNetworkHeaderCursor({
      network: 'mainnet',
      generation: 3,
      ownerToken: OWNER_A,
      expectedCursor: null,
      headers: [header(100, HASH_B, HASH_A)],
    })).rejects.toThrow('does not revalidate the anchor');
  });

  it('requires a non-null page to extend the exact expected cursor link', async () => {
    queueRaw([stateRow({
      cursorHeight: 100,
      cursorHash: HASH_A,
      targetHeight: 101,
      targetHash: HASH_B,
    })]);

    await expect(recordNetworkHeaderCursor({
      network: 'mainnet',
      generation: 3,
      ownerToken: OWNER_A,
      expectedCursor: { height: 100, hash: HASH_A },
      headers: [header(101, HASH_B, HASH_C)],
    })).rejects.toThrow('does not extend the expected cursor');
  });

  it.each([
    ['empty', []],
    ['oversized', Array.from({ length: 2017 }, (_, index) => header(index, HASH_A, HASH_A))],
  ])('rejects an %s page before opening a transaction', async (_label, headers) => {
    await expect(recordNetworkHeaderCursor({
      network: 'mainnet',
      generation: 3,
      ownerToken: OWNER_A,
      expectedCursor: null,
      headers,
    })).rejects.toThrow('page size is invalid');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects a conflicting staged height instead of silently skipping it', async () => {
    queueRaw([stateRow({
      cursorHeight: 100,
      cursorHash: HASH_A,
      targetHeight: 101,
      targetHash: HASH_B,
    })]);
    mocks.stagedHeader.findMany.mockResolvedValue([
      { height: 101, hash: HASH_C, previousHash: HASH_A },
    ]);

    await expect(recordNetworkHeaderCursor({
      network: 'mainnet',
      generation: 3,
      ownerToken: OWNER_A,
      expectedCursor: { height: 100, hash: HASH_A },
      headers: [header(101, HASH_B, HASH_A)],
    })).rejects.toThrow('conflicts with existing proof');
    expect(mocks.stagedHeader.createMany).not.toHaveBeenCalled();
  });

  it('also rejects a staged height whose hash matches but parent identity conflicts', async () => {
    queueRaw([stateRow({
      cursorHeight: 100,
      cursorHash: HASH_A,
      targetHeight: 101,
      targetHash: HASH_B,
    })]);
    mocks.stagedHeader.findMany.mockResolvedValue([
      { height: 101, hash: HASH_B, previousHash: HASH_C },
    ]);

    await expect(recordNetworkHeaderCursor({
      network: 'mainnet',
      generation: 3,
      ownerToken: OWNER_A,
      expectedCursor: { height: 100, hash: HASH_A },
      headers: [header(101, HASH_B, HASH_A)],
    })).rejects.toThrow('conflicts with existing proof');
  });

  it('rejects a stale cursor without staging or advancing anything', async () => {
    queueRaw([stateRow({ cursorHeight: 101, cursorHash: HASH_B })]);

    await expect(recordNetworkHeaderCursor({
      network: 'mainnet',
      generation: 3,
      ownerToken: OWNER_A,
      expectedCursor: null,
      headers: [header(102, HASH_C, HASH_B)],
    })).rejects.toThrow('cursor changed');
    expect(mocks.stagedHeader.createMany).not.toHaveBeenCalled();
    expect(mocks.reconciliation.update).not.toHaveBeenCalled();
  });

  it('rejects a stale owner fence before accepting staged proof', async () => {
    queueRaw([stateRow({ generation: 4, ownerToken: OWNER_B })]);

    await expect(recordNetworkHeaderCursor({
      network: 'mainnet',
      generation: 3,
      ownerToken: OWNER_A,
      expectedCursor: null,
      headers: [header(101, HASH_B, HASH_A)],
    })).rejects.toThrow('ownership changed');
    expect(mocks.stagedHeader.createMany).not.toHaveBeenCalled();
  });

  it.each([0, 1.5, 2_147_483_648])('rejects invalid fence generation %s', async generation => {
    await expect(recordNetworkHeaderCursor({
      network: 'mainnet',
      generation,
      ownerToken: OWNER_A,
      expectedCursor: null,
      headers: [header(100, HASH_A, GENESIS_HASH)],
    })).rejects.toThrow('fence generation is invalid');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('resets to an ancestor under a new generation and discards staged work', async () => {
    queueRaw([stateRow()], [{ now: NOW }]);
    mocks.reconciliation.update.mockResolvedValue(stateRow({
      generation: 4,
      mode: 'ancestor_search',
      anchorHeight: 95,
      anchorHash: HASH_B,
    }));

    await expect(resetNetworkHeaderCursor({
      network: 'mainnet',
      generation: 3,
      ownerToken: OWNER_A,
      mode: 'ancestor_search',
      anchorHeight: 95,
      anchorHash: HASH_B,
    })).resolves.toMatchObject({ generation: 4, anchorHeight: 95 });
    expect(mocks.stagedHeader.deleteMany).toHaveBeenCalledWith({ where: { network: 'mainnet' } });
    expect(mocks.reconciliation.update).toHaveBeenCalledWith({
      where: { network: 'mainnet' },
      data: expect.objectContaining({ generation: 4, cursorHeight: null, cursorHash: null }),
    });
  });

  it('rejects an invalid reset mode before opening a transaction', async () => {
    await expect(resetNetworkHeaderCursor({
      network: 'mainnet',
      generation: 3,
      ownerToken: OWNER_A,
      mode: 'invalid' as 'forward',
      anchorHeight: 95,
      anchorHash: HASH_B,
    })).rejects.toThrow('reset mode is invalid');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects reset when advancing the generation would overflow the database column', async () => {
    queueRaw([stateRow({ generation: 2_147_483_647 })]);
    await expect(resetNetworkHeaderCursor({
      network: 'mainnet',
      generation: 2_147_483_647,
      ownerToken: OWNER_A,
      mode: 'forward',
      anchorHeight: 95,
      anchorHash: HASH_B,
    })).rejects.toThrow('generation exhausted');
  });
});

describe('confirmation cursor fencing', () => {
  it('atomically advances the database-order page cursor and persists failed wallets', async () => {
    queueRaw([stateRow({
      lastFailureClass: 'confirmation_failed',
      consecutiveFailureCount: 2,
      retryEligibleAt: FUTURE,
    })], [{ now: NOW }]);
    mocks.reconciliation.update.mockResolvedValue(stateRow({
      confirmationCursorWalletId: 'wallet-b',
    }));
    mocks.confirmationRetry.createMany.mockResolvedValue({ count: 1 });

    await expect(recordNetworkHeaderConfirmationPage({
      network: 'mainnet', generation: 3, ownerToken: OWNER_A,
      expectedCursor: null,
      cursor: 'wallet-b',
      enumerationComplete: false,
      attemptedWalletIds: ['wallet-a', 'wallet-b'],
      failedWalletIds: ['wallet-a'],
    })).resolves.toMatchObject({ confirmationCursorWalletId: 'wallet-b' });

    expect(mocks.confirmationRetry.createMany).toHaveBeenCalledWith({
      data: [{ network: 'mainnet', walletId: 'wallet-a' }],
      skipDuplicates: true,
    });
    expect(mocks.reconciliation.update).toHaveBeenCalledWith({
      where: { network: 'mainnet' },
      data: expect.objectContaining({
        confirmationCursorWalletId: 'wallet-b',
        confirmationEnumerationComplete: false,
        lastAttemptAt: NOW,
        lastFailureClass: null,
        consecutiveFailureCount: 0,
        retryEligibleAt: NOW,
      }),
    });
  });

  it('clears prior backoff after a failure-free confirmation page', async () => {
    queueRaw([stateRow({
      lastFailureClass: 'confirmation_failed',
      consecutiveFailureCount: 2,
      retryEligibleAt: FUTURE,
    })], [{ now: NOW }]);
    mocks.reconciliation.update.mockResolvedValue(stateRow({
      confirmationCursorWalletId: 'wallet-b',
    }));

    await recordNetworkHeaderConfirmationPage({
      network: 'mainnet', generation: 3, ownerToken: OWNER_A,
      expectedCursor: null,
      cursor: 'wallet-b',
      enumerationComplete: false,
      attemptedWalletIds: ['wallet-b'],
      failedWalletIds: [],
    });

    expect(mocks.reconciliation.update).toHaveBeenCalledWith({
      where: { network: 'mainnet' },
      data: expect.objectContaining({
        lastFailureClass: null,
        consecutiveFailureCount: 0,
        retryEligibleAt: NOW,
      }),
    });
  });

  it('preserves backoff when every wallet in an enumerated page fails', async () => {
    queueRaw([stateRow({
      lastFailureClass: 'confirmation_failed',
      consecutiveFailureCount: 2,
      retryEligibleAt: FUTURE,
    })], [{ now: NOW }]);
    mocks.reconciliation.update.mockResolvedValue(stateRow({
      confirmationCursorWalletId: 'wallet-b',
    }));

    await recordNetworkHeaderConfirmationPage({
      network: 'mainnet', generation: 3, ownerToken: OWNER_A,
      expectedCursor: null,
      cursor: 'wallet-b',
      enumerationComplete: false,
      attemptedWalletIds: ['wallet-a', 'wallet-b'],
      failedWalletIds: ['wallet-a', 'wallet-b'],
    });

    const pageUpdate = mocks.reconciliation.update.mock.calls[0][0].data;
    expect(pageUpdate).not.toHaveProperty('lastFailureClass');
    expect(pageUpdate).not.toHaveProperty('consecutiveFailureCount');
    expect(pageUpdate).not.toHaveProperty('retryEligibleAt');
  });

  it.each([
    ['failure outside attempted set', ['wallet-b'], ['wallet-a'], 'wallet-b', 'page result'],
    ['cursor outside attempted set', ['wallet-a'], [], 'wallet-b', 'page cursor'],
  ])('rejects an invalid %s', async (_label, attemptedWalletIds, failedWalletIds, cursor, reason) => {
    await expect(recordNetworkHeaderConfirmationPage({
      network: 'mainnet', generation: 3, ownerToken: OWNER_A,
      expectedCursor: null,
      cursor,
      enumerationComplete: false,
      attemptedWalletIds,
      failedWalletIds,
    })).rejects.toThrow(reason);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects a stale or non-advancing confirmation cursor', async () => {
    queueRaw([stateRow({ confirmationCursorWalletId: 'wallet-b' })]);
    await expect(recordNetworkHeaderConfirmationPage({
      network: 'mainnet', generation: 3, ownerToken: OWNER_A,
      expectedCursor: null,
      cursor: 'wallet-c',
      enumerationComplete: false,
      attemptedWalletIds: ['wallet-c'],
      failedWalletIds: [],
    })).rejects.toThrow('confirmation cursor changed');

    queueRaw(
      [stateRow({ confirmationCursorWalletId: 'wallet-b' })],
      [{ advances: false }],
    );
    await expect(recordNetworkHeaderConfirmationPage({
      network: 'mainnet', generation: 3, ownerToken: OWNER_A,
      expectedCursor: 'wallet-b',
      cursor: 'wallet-a',
      enumerationComplete: false,
      attemptedWalletIds: ['wallet-a'],
      failedWalletIds: [],
    })).rejects.toThrow('must advance');
  });

  it.each([
    ['empty expected cursor', { expectedCursor: '', cursor: 'wallet-b' }],
    ['oversized cursor', { expectedCursor: null, cursor: 'w'.repeat(201) }],
  ])('rejects an %s before opening a transaction', async (_label, cursorInput) => {
    await expect(recordNetworkHeaderConfirmationPage({
      network: 'mainnet', generation: 3, ownerToken: OWNER_A,
      ...cursorInput,
      enumerationComplete: false,
      attemptedWalletIds: [cursorInput.cursor],
      failedWalletIds: [],
    })).rejects.toThrow('confirmation cursor is invalid');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty wallet ID', ['']],
    ['duplicate wallet IDs', ['wallet-a', 'wallet-a']],
    ['more than one page of wallet IDs', Array.from({ length: 101 }, (_, index) => `wallet-${index}`)],
  ])('rejects %s before recording confirmation failures', async (_label, failedWalletIds) => {
    await expect(recordNetworkHeaderConfirmationPage({
      network: 'mainnet', generation: 3, ownerToken: OWNER_A,
      expectedCursor: null,
      cursor: 'wallet-z',
      enumerationComplete: false,
      attemptedWalletIds: ['wallet-z'],
      failedWalletIds,
    })).rejects.toThrow('failed wallet IDs is invalid');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects an invalid page-completion value before opening a transaction', async () => {
    await expect(recordNetworkHeaderConfirmationPage({
      network: 'mainnet', generation: 3, ownerToken: OWNER_A,
      expectedCursor: null,
      cursor: 'wallet-z',
      enumerationComplete: 'yes' as unknown as boolean,
      attemptedWalletIds: ['wallet-z'],
      failedWalletIds: [],
    })).rejects.toThrow('page completion is invalid');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects a null cursor that would move a persisted database cursor backwards', async () => {
    await expect(recordNetworkHeaderConfirmationPage({
      network: 'mainnet', generation: 3, ownerToken: OWNER_A,
      expectedCursor: 'wallet-b',
      cursor: null,
      enumerationComplete: true,
      attemptedWalletIds: [],
      failedWalletIds: [],
    })).rejects.toThrow('cannot move backwards');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects a non-advancing cursor when PostgreSQL returns no comparison row', async () => {
    queueRaw([stateRow({ confirmationCursorWalletId: 'wallet-b' })], []);
    await expect(recordNetworkHeaderConfirmationPage({
      network: 'mainnet', generation: 3, ownerToken: OWNER_A,
      expectedCursor: 'wallet-b',
      cursor: 'wallet-a',
      enumerationComplete: false,
      attemptedWalletIds: ['wallet-a'],
      failedWalletIds: [],
    })).rejects.toThrow('must advance');
  });

  it('rejects writes after confirmation enumeration is already complete', async () => {
    queueRaw([stateRow({ confirmationEnumerationComplete: true })]);
    await expect(recordNetworkHeaderConfirmationPage({
      network: 'mainnet', generation: 3, ownerToken: OWNER_A,
      expectedCursor: null,
      cursor: 'wallet-a',
      enumerationComplete: false,
      attemptedWalletIds: ['wallet-a'],
      failedWalletIds: [],
    })).rejects.toThrow('enumeration is already complete');
    expect(mocks.reconciliation.update).not.toHaveBeenCalled();
  });

  it('rejects an incomplete page that does not advance its database cursor', async () => {
    queueRaw([stateRow({ confirmationCursorWalletId: 'wallet-b' })]);
    await expect(recordNetworkHeaderConfirmationPage({
      network: 'mainnet', generation: 3, ownerToken: OWNER_A,
      expectedCursor: 'wallet-b',
      cursor: 'wallet-b',
      enumerationComplete: false,
      attemptedWalletIds: ['wallet-b'],
      failedWalletIds: [],
    })).rejects.toThrow('incomplete page did not advance');
  });

  it('marks database-order enumeration complete without inventing a cursor', async () => {
    queueRaw([stateRow()], [{ now: NOW }]);
    mocks.reconciliation.update.mockResolvedValue(stateRow({
      confirmationEnumerationComplete: true,
    }));

    await expect(recordNetworkHeaderConfirmationPage({
      network: 'mainnet', generation: 3, ownerToken: OWNER_A,
      expectedCursor: null,
      cursor: null,
      enumerationComplete: true,
      attemptedWalletIds: [],
      failedWalletIds: [],
    })).resolves.toMatchObject({ confirmationEnumerationComplete: true });
  });

  it('reads durable retries in database order and bounds each retry page', async () => {
    queueRaw([stateRow({ confirmationEnumerationComplete: true })]);
    mocks.confirmationRetry.findMany.mockResolvedValue([
      { walletId: 'wallet-A' },
      { walletId: 'wallet-z' },
    ]);

    await expect(findNetworkHeaderConfirmationRetries({
      network: 'mainnet',
      generation: 3,
      ownerToken: OWNER_A,
    }, 2)).resolves.toEqual(['wallet-A', 'wallet-z']);
    expect(mocks.confirmationRetry.findMany).toHaveBeenCalledWith({
      where: { network: 'mainnet' },
      orderBy: { walletId: 'asc' },
      take: 2,
      select: { walletId: true },
    });
  });

  it.each([0, 101, 1.5])('rejects invalid confirmation retry page limit %s', async limit => {
    await expect(findNetworkHeaderConfirmationRetries({
      network: 'mainnet', generation: 3, ownerToken: OWNER_A,
    }, limit)).rejects.toThrow('retry page limit is invalid');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects retry reads before confirmation enumeration completes', async () => {
    queueRaw([stateRow({ confirmationEnumerationComplete: false })]);
    await expect(findNetworkHeaderConfirmationRetries({
      network: 'mainnet', generation: 3, ownerToken: OWNER_A,
    })).rejects.toThrow('require completed enumeration');
    expect(mocks.confirmationRetry.findMany).not.toHaveBeenCalled();
  });

  it('removes successful retry wallets while retaining the failed subset', async () => {
    queueRaw([stateRow({
      confirmationEnumerationComplete: true,
      lastFailureClass: 'confirmation_failed',
      consecutiveFailureCount: 3,
      retryEligibleAt: FUTURE,
    })], [{ now: NOW }]);
    mocks.reconciliation.update.mockResolvedValue(stateRow({
      confirmationEnumerationComplete: true,
    }));

    await recordNetworkHeaderConfirmationRetryResult({
      network: 'mainnet', generation: 3, ownerToken: OWNER_A,
      attemptedWalletIds: ['wallet-a', 'wallet-b', 'wallet-c'],
      failedWalletIds: ['wallet-b'],
    });

    expect(mocks.confirmationRetry.deleteMany).toHaveBeenCalledWith({
      where: {
        network: 'mainnet',
        walletId: { in: ['wallet-a', 'wallet-c'] },
      },
    });
    expect(mocks.confirmationRetry.deleteMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ walletId: 'wallet-b' }) }),
    );
    expect(mocks.reconciliation.update).toHaveBeenCalledWith({
      where: { network: 'mainnet' },
      data: expect.objectContaining({
        lastFailureClass: null,
        consecutiveFailureCount: 0,
        retryEligibleAt: NOW,
      }),
    });
  });

  it('clears prior backoff after every durable retry succeeds', async () => {
    queueRaw([stateRow({
      confirmationEnumerationComplete: true,
      lastFailureClass: 'confirmation_failed',
      consecutiveFailureCount: 3,
      retryEligibleAt: FUTURE,
    })], [{ now: NOW }]);
    mocks.reconciliation.update.mockResolvedValue(stateRow({
      confirmationEnumerationComplete: true,
    }));

    await recordNetworkHeaderConfirmationRetryResult({
      network: 'mainnet', generation: 3, ownerToken: OWNER_A,
      attemptedWalletIds: ['wallet-a'],
      failedWalletIds: [],
    });

    expect(mocks.reconciliation.update).toHaveBeenCalledWith({
      where: { network: 'mainnet' },
      data: expect.objectContaining({
        lastFailureClass: null,
        consecutiveFailureCount: 0,
        retryEligibleAt: NOW,
      }),
    });
  });

  it.each([
    ['an empty attempted page', [], []],
    ['a failure outside the attempted page', ['wallet-a'], ['wallet-b']],
    ['duplicate attempted IDs', ['wallet-a', 'wallet-a'], []],
    ['an oversized attempted page', Array.from({ length: 101 }, (_, index) => `wallet-${index}`), []],
  ])('rejects retry result with %s', async (_label, attemptedWalletIds, failedWalletIds) => {
    await expect(recordNetworkHeaderConfirmationRetryResult({
      network: 'mainnet', generation: 3, ownerToken: OWNER_A,
      attemptedWalletIds,
      failedWalletIds,
    })).rejects.toThrow(/retry result is invalid|attempted retry wallet IDs is invalid/);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('retains every retry and preserves backoff when the entire attempted page still fails', async () => {
    queueRaw([stateRow({
      confirmationEnumerationComplete: true,
      lastFailureClass: 'confirmation_failed',
      consecutiveFailureCount: 3,
      retryEligibleAt: FUTURE,
    })], [{ now: NOW }]);
    mocks.reconciliation.update.mockResolvedValue(stateRow({ confirmationEnumerationComplete: true }));

    await recordNetworkHeaderConfirmationRetryResult({
      network: 'mainnet', generation: 3, ownerToken: OWNER_A,
      attemptedWalletIds: ['wallet-a', 'wallet-b'],
      failedWalletIds: ['wallet-a', 'wallet-b'],
    });

    expect(mocks.confirmationRetry.deleteMany).not.toHaveBeenCalled();
    expect(mocks.reconciliation.update).toHaveBeenCalled();
    const retryUpdate = mocks.reconciliation.update.mock.calls[0][0].data;
    expect(retryUpdate).not.toHaveProperty('lastFailureClass');
    expect(retryUpdate).not.toHaveProperty('consecutiveFailureCount');
    expect(retryUpdate).not.toHaveProperty('retryEligibleAt');
  });
});

describe('findNetworkHeaderHistory', () => {
  it('reads the bounded canonical tail newest-first with the default window', async () => {
    mocks.history.findMany.mockResolvedValue([header(100, HASH_A, HASH_B)]);

    await expect(findNetworkHeaderHistory('mainnet', 100)).resolves.toHaveLength(1);
    expect(mocks.history.findMany).toHaveBeenCalledWith({
      where: { network: 'mainnet', height: { lte: 100 } },
      orderBy: { height: 'desc' },
      take: 288,
      select: { height: true, hash: true, previousHash: true, observedAt: true },
    });
  });

  it.each([0, 289, 1.5])('rejects invalid history limit %s', async limit => {
    await expect(findNetworkHeaderHistory('mainnet', 100, limit)).rejects.toThrow(
      'history page limit is invalid',
    );
    expect(mocks.history.findMany).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5, 2_147_483_648])('rejects invalid history height %s', async maxHeight => {
    await expect(findNetworkHeaderHistory('mainnet', maxHeight)).rejects.toThrow(
      'valid block height',
    );
  });
});

describe('finalizeNetworkHeaderReconciliation', () => {
  it('atomically promotes staged history, clears the gap, and deletes active work', async () => {
    const complete = stateRow({
      cursorHeight: 103,
      cursorHash: HASH_C,
      confirmationEnumerationComplete: true,
    });
    const staged = [
      { network: 'mainnet', ...header(102, HASH_B, HASH_A) },
      { network: 'mainnet', ...header(103, HASH_C, HASH_B) },
    ];
    queueRaw([complete]);
    mocks.stagedHeader.findMany.mockResolvedValue(staged);
    mocks.history.deleteMany.mockResolvedValue({ count: 0 });
    mocks.history.createMany.mockResolvedValue({ count: 2 });
    mocks.checkpoint.upsert.mockResolvedValue(checkpointRow({
      lastProcessedHeight: 103,
      lastProcessedHash: HASH_C,
      coverageGapStartedAt: null,
    }));

    await expect(finalizeNetworkHeaderReconciliation({
      network: 'mainnet',
      generation: 3,
      ownerToken: OWNER_A,
    })).resolves.toMatchObject({
      checkpoint: {
        lastProcessedHeight: 103,
        lastProcessedHash: HASH_C,
        coverageGapStartedAt: null,
      },
      continuation: null,
    });

    expect(mocks.history.upsert).not.toHaveBeenCalled();
    expect(mocks.history.deleteMany).toHaveBeenNthCalledWith(1, {
      where: { network: 'mainnet', height: { in: [102, 103] } },
    });
    expect(mocks.history.createMany).toHaveBeenCalledWith({
      data: staged,
    });
    expect(mocks.history.deleteMany).toHaveBeenNthCalledWith(2, {
      where: {
        network: 'mainnet',
        OR: [
          { height: { lt: 0 } },
          { height: { gt: 103 } },
        ],
      },
    });
    expect(mocks.checkpoint.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ coverageGapStartedAt: null }),
    }));
    expect(mocks.reconciliation.delete).toHaveBeenCalledWith({ where: { network: 'mainnet' } });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('refuses to finalize before confirmation enumeration completes or while retries remain', async () => {
    queueRaw([stateRow({ cursorHeight: 103, cursorHash: HASH_C })]);
    await expect(finalizeNetworkHeaderReconciliation({
      network: 'mainnet',
      generation: 3,
      ownerToken: OWNER_A,
    })).rejects.toThrow('enumeration');
    expect(mocks.checkpoint.upsert).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      $queryRaw: mocks.queryRaw,
      networkHeaderCheckpoint: mocks.checkpoint,
      networkHeaderReconciliation: mocks.reconciliation,
      networkHeaderReconciliationHeader: mocks.stagedHeader,
      networkHeaderHistory: mocks.history,
      networkHeaderConfirmationRetry: mocks.confirmationRetry,
    }));
    queueRaw([stateRow({
      cursorHeight: 103,
      cursorHash: HASH_C,
      confirmationEnumerationComplete: true,
    })]);
    mocks.confirmationRetry.count.mockResolvedValue(1);
    await expect(finalizeNetworkHeaderReconciliation({
      network: 'mainnet',
      generation: 3,
      ownerToken: OWNER_A,
    })).rejects.toThrow('retries');
    expect(mocks.checkpoint.upsert).not.toHaveBeenCalled();
  });

  it('promotes the proven target and rolls the latest pending target into the same durable row', async () => {
    const pendingHash = 'd'.repeat(64);
    const complete = stateRow({
      cursorHeight: 103,
      cursorHash: HASH_C,
      confirmationEnumerationComplete: true,
      pendingTargetHeight: 104,
      pendingTargetHash: pendingHash,
      pendingTargetPreviousHash: HASH_C,
      pendingTargetHeaderHex: HEADER,
      pendingTargetObservedAt: NOW,
      pendingTargetGenesisHash: GENESIS_HASH,
    });
    queueRaw([complete], [{ now: NOW }]);
    mocks.stagedHeader.findMany.mockResolvedValue([
      { network: 'mainnet', ...header(103, HASH_C, HASH_B) },
    ]);
    mocks.history.deleteMany.mockResolvedValue({ count: 0 });
    mocks.history.createMany.mockResolvedValue({ count: 1 });
    mocks.checkpoint.upsert.mockResolvedValue(checkpointRow({
      lastProcessedHeight: 103,
      lastProcessedHash: HASH_C,
      coverageGapStartedAt: GAP_STARTED_AT,
    }));
    const continuation = stateRow({
      generation: 4,
      targetHeight: 104,
      targetHash: pendingHash,
      anchorHeight: 103,
      anchorHash: HASH_C,
    });
    mocks.reconciliation.update.mockResolvedValue(continuation);

    await expect(finalizeNetworkHeaderReconciliation({
      network: 'mainnet', generation: 3, ownerToken: OWNER_A,
    })).resolves.toMatchObject({
      checkpoint: { lastProcessedHeight: 103, coverageGapStartedAt: GAP_STARTED_AT },
      continuation: { generation: 4, targetHeight: 104, anchorHeight: 103 },
    });

    expect(mocks.reconciliation.delete).not.toHaveBeenCalled();
    expect(mocks.reconciliation.update).toHaveBeenCalledWith({
      where: { network: 'mainnet' },
      data: expect.objectContaining({
        generation: 4,
        targetHeight: 104,
        targetHash: pendingHash,
        anchorHeight: 103,
        anchorHash: HASH_C,
        cursorHeight: null,
        cursorHash: null,
        confirmationCursorWalletId: null,
        confirmationEnumerationComplete: false,
        pendingTargetHeight: null,
        pendingTargetHash: null,
        pendingTargetGenesisHash: null,
      }),
    });
  });

  it('refuses to finalize before the cursor proves the exact target identity', async () => {
    queueRaw([stateRow({ cursorHeight: 102, cursorHash: HASH_B })]);

    await expect(finalizeNetworkHeaderReconciliation({
      network: 'mainnet',
      generation: 3,
      ownerToken: OWNER_A,
    })).rejects.toThrow('target is not fully proven');
    expect(mocks.checkpoint.upsert).not.toHaveBeenCalled();
    expect(mocks.reconciliation.delete).not.toHaveBeenCalled();
  });

  it('refuses to finalize when staged proof omits the exact target identity', async () => {
    queueRaw([stateRow({
      cursorHeight: 103,
      cursorHash: HASH_C,
      confirmationEnumerationComplete: true,
    })]);
    mocks.stagedHeader.findMany.mockResolvedValue([
      { network: 'mainnet', ...header(102, HASH_B, HASH_A) },
    ]);

    await expect(finalizeNetworkHeaderReconciliation({
      network: 'mainnet',
      generation: 3,
      ownerToken: OWNER_A,
    })).rejects.toThrow('does not contain the exact target');
    expect(mocks.checkpoint.upsert).not.toHaveBeenCalled();
  });
});
