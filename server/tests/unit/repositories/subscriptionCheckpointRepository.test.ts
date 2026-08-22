import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkpointFindUnique: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock('../../../src/models/prisma', () => ({
  default: {
    addressSubscriptionCheckpoint: { findUnique: mocks.checkpointFindUnique },
    $queryRaw: mocks.queryRaw,
  },
}));

vi.mock('../../../src/generated/prisma/client', () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  },
}));

import {
  findPendingSubscriptionEnrollments,
  findSubscriptionCheckpoint,
} from '../../../src/repositories/subscriptionCheckpointRepository';

describe('subscriptionCheckpointRepository readers', () => {
  beforeEach(() => vi.clearAllMocks());

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

  it.each([0, -3, 2.5])('rejects invalid enrollment limit %s', async (limit) => {
    await expect(findPendingSubscriptionEnrollments({
      network: 'mainnet',
      limit,
    })).rejects.toThrow('positive integer');
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
});
