import { describe, expect, it, vi } from 'vitest';
import { storeTransactionInputs } from '../../../../../src/services/bitcoin/transactions/storeTransactionIO';
import type { PrismaTxClient } from '../../../../../src/services/bitcoin/transactions/types';

describe('storeTransactionInputs', () => {
  it('scopes fallback UTXO lookup to the transaction wallet', async () => {
    const walletUtxo = {
      walletId: 'wallet-a',
      txid: 'shared-txid',
      vout: 0,
      address: 'wallet-a-address',
      amount: 50_000n,
    };
    const duplicateOutpoint = {
      ...walletUtxo,
      walletId: 'wallet-b',
      address: 'wallet-b-address',
      amount: 75_000n,
    };
    const findMany = vi.fn((query: { where: { walletId?: string } }) =>
      Promise.resolve(query.where.walletId ? [walletUtxo] : [walletUtxo, duplicateOutpoint])
    );
    const findAddresses = vi.fn().mockResolvedValue([
      {
        address: 'wallet-a-address',
        derivationPath: "m/84'/0'/0'/0/7",
      },
    ]);
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      uTXO: { findMany },
      address: { findMany: findAddresses },
      transactionInput: { createMany },
    } as unknown as PrismaTxClient;

    await storeTransactionInputs(tx, 'transaction-id', 'spending-txid', 'wallet-a', {
      utxos: [{ txid: 'shared-txid', vout: 0 }],
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        walletId: 'wallet-a',
        OR: [{ txid: 'shared-txid', vout: 0 }],
      },
    });
    expect(findAddresses).toHaveBeenCalledWith({
      where: {
        walletId: 'wallet-a',
        address: { in: ['wallet-a-address'] },
      },
      select: { address: true, derivationPath: true },
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        address: 'wallet-a-address',
        amount: 50_000n,
        derivationPath: "m/84'/0'/0'/0/7",
      })],
      skipDuplicates: true,
    });
  });
});
