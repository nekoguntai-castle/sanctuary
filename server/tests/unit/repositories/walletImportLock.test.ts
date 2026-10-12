import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeRaw: vi.fn(),
  operation: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../../../src/models/prisma', () => ({
  default: { $transaction: mocks.transaction },
}));

vi.mock('../../../src/generated/prisma/client', () => ({
  Prisma: {
    TransactionIsolationLevel: { ReadCommitted: 'ReadCommitted' },
  },
}));

import {
  lockWalletImportForUser,
  withWalletImportTransaction,
} from '../../../src/repositories/walletImportLock';

describe('walletImportLock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.operation.mockResolvedValue('complete');
    mocks.transaction.mockImplementation(async (operation, options) => operation({
      $executeRaw: mocks.executeRaw,
      options,
    }));
  });

  it('uses a parameterized per-user lock in an explicit ReadCommitted transaction', async () => {
    const userId = 'user-lock-test';
    const tx = expect.objectContaining({ $executeRaw: mocks.executeRaw });

    await expect(withWalletImportTransaction(userId, mocks.operation)).resolves.toBe('complete');

    expect(mocks.executeRaw).toHaveBeenCalledOnce();
    const [query, boundKey] = mocks.executeRaw.mock.calls[0] as [TemplateStringsArray, string];
    expect(Array.from(query).join('?')).toContain(
      'pg_advisory_xact_lock(hashtextextended(?, 0))',
    );
    expect(boundKey).toBe(`sanctuary:wallet-import:v1:${userId}`);
    expect(mocks.operation).toHaveBeenCalledWith(tx);
    expect(mocks.executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.operation.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'ReadCommitted',
    });
  });

  it('exposes the lock helper for a caller-owned transaction', async () => {
    const tx = { $executeRaw: mocks.executeRaw };
    await lockWalletImportForUser(tx as never, 'caller-owned-user');

    expect(mocks.executeRaw).toHaveBeenCalledOnce();
    expect(mocks.executeRaw.mock.calls[0]?.[1]).toBe(
      'sanctuary:wallet-import:v1:caller-owned-user',
    );
  });
});
