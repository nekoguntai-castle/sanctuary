import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/generated/prisma/client', () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
  },
}));

import {
  acquireWalletSyncRetirementLock,
  WALLET_SYNC_RETIREMENT_LOCK_KEY,
} from '../../../src/repositories/walletSyncRetirementLock';

describe('walletSyncRetirementLock', () => {
  it('takes the advisory transaction lock older binaries share', async () => {
    const executeRaw = vi.fn();

    await acquireWalletSyncRetirementLock({ $executeRaw: executeRaw } as never);

    expect(executeRaw).toHaveBeenCalledOnce();
    expect(executeRaw.mock.calls[0][0].values).toEqual([WALLET_SYNC_RETIREMENT_LOCK_KEY]);
    expect(WALLET_SYNC_RETIREMENT_LOCK_KEY).toBe(
      'sanctuary:wallet-sync:scheduler-retirement:v1',
    );
  });
});
