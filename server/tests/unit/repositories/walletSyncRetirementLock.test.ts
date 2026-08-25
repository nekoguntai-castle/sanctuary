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
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    TransactionIsolationLevel: { ReadCommitted: 'ReadCommitted' },
  },
}));

import {
  WALLET_SYNC_RETIREMENT_LOCK_KEY,
  withWalletSyncRetirementLock,
} from '../../../src/repositories/walletSyncRetirementLock';

describe('walletSyncRetirementLock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.operation.mockResolvedValue('complete');
    mocks.transaction.mockImplementation(async (operation) => operation({
      $executeRaw: mocks.executeRaw,
    }));
  });

  it('holds the advisory transaction lock through the supplied operation', async () => {
    await expect(withWalletSyncRetirementLock(mocks.operation)).resolves.toBe('complete');

    const tx = expect.objectContaining({ $executeRaw: mocks.executeRaw });
    expect(mocks.executeRaw).toHaveBeenCalledOnce();
    expect(mocks.operation).toHaveBeenCalledWith(tx);
    expect(mocks.executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.operation.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'ReadCommitted',
      maxWait: 10_000,
      timeout: 60_000,
    });
    expect(WALLET_SYNC_RETIREMENT_LOCK_KEY).toBe(
      'sanctuary:wallet-sync:scheduler-retirement:v1',
    );
  });
});
