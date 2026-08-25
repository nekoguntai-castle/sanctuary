import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  withWalletSyncMutationFence: vi.fn(),
  withWalletSyncMutationLock: vi.fn(),
}));

vi.mock('../../../../../src/repositories/syncIntentRepository', () => ({
  withWalletSyncMutationFence: hoisted.withWalletSyncMutationFence,
  withWalletSyncMutationLock: hoisted.withWalletSyncMutationLock,
}));

import { runWalletSyncMutation } from '../../../../../src/services/bitcoin/sync/mutationBoundary';

const fence = {
  walletId: 'wallet-fenced',
  generation: 7,
  leaseToken: '11111111-1111-4111-8111-111111111111',
} as const;

describe('wallet sync mutation boundary', () => {
  beforeEach(() => {
    hoisted.withWalletSyncMutationFence.mockReset();
    hoisted.withWalletSyncMutationLock.mockReset();
    hoisted.withWalletSyncMutationLock.mockImplementation(
      async (_walletId, assertAuthority, callback) => {
        assertAuthority();
        return callback({ wallet: {} });
      },
    );
  });

  it('passes the explicit fenced transaction client and flushes effects after commit', async () => {
    const order: string[] = [];
    const tx = { wallet: {} };
    hoisted.withWalletSyncMutationFence.mockImplementation(async (_fence, callback) => {
      const value = await callback(tx);
      order.push('commit');
      return value;
    });

    const result = await runWalletSyncMutation(
      { walletId: fence.walletId, mutationFence: fence },
      'address_usage',
      async (client, deferPostCommit) => {
        expect(client).toBe(tx);
        order.push('write');
        deferPostCommit(() => {
          order.push('effect');
        });
        return 'persisted';
      },
    );

    expect(result).toBe('persisted');
    expect(hoisted.withWalletSyncMutationFence).toHaveBeenCalledWith(
      fence,
      expect.any(Function),
    );
    expect(order).toEqual(['write', 'commit', 'effect']);
  });

  it('suppresses buffered notifications when the fenced mutation rolls back', async () => {
    const notification = vi.fn();
    const failure = new Error('database connection lost');
    hoisted.withWalletSyncMutationFence.mockImplementation(async (_fence, callback) => {
      await callback({ wallet: {} });
      throw failure;
    });

    await expect(runWalletSyncMutation(
      { walletId: fence.walletId, mutationFence: fence },
      'transaction_batch',
      async (_tx, deferPostCommit) => {
        deferPostCommit(notification);
      },
    )).rejects.toBe(failure);

    expect(notification).not.toHaveBeenCalled();
  });

  it('preserves compatibility behavior without granting reclaim authority', async () => {
    const effect = vi.fn();
    await runWalletSyncMutation(
      { walletId: 'legacy-wallet' },
      'utxo_insert',
      async (tx, deferPostCommit) => {
        expect(tx).toBeUndefined();
        deferPostCommit(effect);
      },
    );

    expect(hoisted.withWalletSyncMutationFence).not.toHaveBeenCalled();
    expect(hoisted.withWalletSyncMutationLock).not.toHaveBeenCalled();
    expect(effect).toHaveBeenCalledOnce();
  });

  it('rechecks cancellation inside the wallet row lock before writing', async () => {
    const cancelled = new Error('lease was lost');
    const assertAuthority = vi.fn(() => { throw cancelled; });
    const write = vi.fn();

    await expect(runWalletSyncMutation(
      { walletId: 'legacy-wallet' },
      'missing_field_chunk',
      write,
      assertAuthority,
      true,
    )).rejects.toBe(cancelled);

    expect(assertAuthority).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects a fence for another wallet before opening a transaction', async () => {
    await expect(runWalletSyncMutation(
      { walletId: 'wallet-target', mutationFence: fence },
      'utxo_insert',
      async () => undefined,
    )).rejects.toThrow('does not match the mutation target wallet');

    expect(hoisted.withWalletSyncMutationFence).not.toHaveBeenCalled();
  });
});
