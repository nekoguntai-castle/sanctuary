/**
 * Regression coverage for audit 2026-05-12.
 *
 * Wallet-scoped policy usage windows must not store NULL userId values: a
 * normal PostgreSQL composite unique index treats NULL values as distinct.
 */
import { beforeEach, describe, expect, test, vi, type Mock } from 'vitest';

const auditMocks = vi.hoisted(() => ({
  prisma: {
    policyUsageWindow: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: auditMocks.prisma,
}));

import {
  findOrCreateUsageWindow,
  WALLET_SCOPED_USAGE_WINDOW_USER_ID,
} from '../../../src/repositories/policyRepository';

const { prisma } = auditMocks;

describe('policyRepository — audit 2026-05-12', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('stores wallet-scoped usage windows with a reserved non-null user id', async () => {
    const windowStart = new Date('2026-03-17T00:00:00Z');
    const windowEnd = new Date('2026-03-18T00:00:00Z');

    (prisma.policyUsageWindow.findFirst as Mock).mockResolvedValue(null);
    (prisma.policyUsageWindow.create as Mock).mockResolvedValue({
      id: 'window-1',
      totalSpent: 0n,
      txCount: 0,
    });

    await findOrCreateUsageWindow({
      policyId: 'policy-1',
      walletId: 'wallet-1',
      windowType: 'daily',
      windowStart,
      windowEnd,
    });

    expect(prisma.policyUsageWindow.findFirst).toHaveBeenCalledWith({
      where: {
        policyId: 'policy-1',
        walletId: 'wallet-1',
        userId: WALLET_SCOPED_USAGE_WINDOW_USER_ID,
        windowType: 'daily',
        windowStart,
      },
    });
    expect(prisma.policyUsageWindow.create).toHaveBeenCalledWith({
      data: {
        policyId: 'policy-1',
        walletId: 'wallet-1',
        userId: WALLET_SCOPED_USAGE_WINDOW_USER_ID,
        windowType: 'daily',
        windowStart,
        windowEnd,
        totalSpent: 0n,
        txCount: 0,
      },
    });
  });
});
