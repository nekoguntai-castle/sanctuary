import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  walletFindUnique: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock('../../../src/models/prisma', () => ({
  default: {
    wallet: { findUnique: mocks.walletFindUnique },
    $queryRaw: mocks.queryRaw,
  },
}));

vi.mock('../../../src/generated/prisma/client', () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  },
}));

import {
  findActionableIncrementalSyncIntents,
  findIncrementalSyncIntent,
} from '../../../src/repositories/syncIntentRepository';

describe('syncIntentRepository readers', () => {
  beforeEach(() => vi.clearAllMocks());

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

  it('bounds recovery pages and passes parameterized values to the raw query', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    const now = new Date('2026-08-22T07:00:00.000Z');
    await expect(findActionableIncrementalSyncIntents({
      now,
      cursor: 'wallet-7',
      limit: 500,
    })).resolves.toEqual([]);

    const query = mocks.queryRaw.mock.calls[0][0];
    expect(query.values).toEqual(expect.arrayContaining(['wallet-7', now, 100]));
    expect(query.strings.join('')).toContain(
      '"requestedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"',
    );
    expect(query.strings.join('')).toContain('"syncActionRequiredAt" IS NULL');
  });

  it('uses bounded defaults for the first recovery page', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    const now = new Date('2026-08-22T07:00:00.000Z');
    await findActionableIncrementalSyncIntents({ now });

    expect(mocks.queryRaw.mock.calls[0][0].values)
      .toEqual(expect.arrayContaining(['', now, 100]));
  });

  it.each([0, -1, 1.5])('rejects invalid recovery limit %s', async (limit) => {
    await expect(findActionableIncrementalSyncIntents({
      now: new Date(),
      limit,
    })).rejects.toThrow('positive integer');
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
});
