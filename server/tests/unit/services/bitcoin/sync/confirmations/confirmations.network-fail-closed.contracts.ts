import { expect, it, vi } from 'vitest';

import { mockPrismaClient } from '../../../../../mocks/prisma';
import { mockGetBlockHeight, mockGetNodeClient } from './confirmationsTestHarness';
import {
  populateMissingTransactionFields,
  updateTransactionConfirmations,
} from '../../../../../../src/services/bitcoin/sync/confirmations';

// Non-regression contracts for the fail-closed persisted-network policy.
//
// `config/wallet-sync-lifecycle-contract.json` freezes
// `invalidPersistedNetworkPolicy: "fail_closed_without_mainnet_fallback"`, and
// `resolvePersistedBitcoinNetwork` documents that "Invalid database values must
// stop startup consumers rather than silently routing wallet work to mainnet".
//
// The confirmation path used to resolve the persisted value with an explicit
// `'mainnet'` fallback, so a corrupt or unrecognised `wallets.network` selected
// the mainnet Electrum client and the mainnet chain tip. Mainnet is the
// funds-bearing network and its tip is far above any test network's, so a
// testnet transaction would have been credited with a wildly inflated
// confirmation count — and deep-confirmation thresholds are what gate treating
// funds as settled.
//
// `testnet` remains the one legacy storage alias and must still resolve, to
// `testnet3`, so these contracts pin both directions: reject the unknown,
// accept the alias.
export function registerConfirmationsNetworkFailClosedContracts() {
  it('rejects an unrecognised persisted network instead of falling back to mainnet', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'bogus-network' });

    await expect(updateTransactionConfirmations('wallet-1')).rejects.toThrow(
      'Invalid persisted Bitcoin network',
    );

    // The mainnet tip must never have been consulted for this wallet.
    expect(mockGetBlockHeight).not.toHaveBeenCalled();
  });

  it('rejects an unrecognised persisted network when populating transaction fields', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'bogus-network' });

    await expect(populateMissingTransactionFields('wallet-1')).rejects.toThrow(
      'Invalid persisted Bitcoin network',
    );

    expect(mockGetNodeClient).not.toHaveBeenCalled();
  });

  it('still resolves the legacy testnet alias to testnet3', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'testnet' });
    mockPrismaClient.systemSetting.findUnique.mockResolvedValue({ value: '100' });
    mockPrismaClient.transaction.findMany.mockResolvedValue([]);

    const result = await updateTransactionConfirmations('wallet-1');

    expect(result).toEqual([]);
    // No transactions are eligible, so the tip is never fetched; the point of
    // this case is that resolution did not throw for the supported alias.
    expect(mockGetBlockHeight).not.toHaveBeenCalled();
  });

  it('uses the wallet network, not mainnet, when reading the chain tip', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'testnet' });
    mockPrismaClient.systemSetting.findUnique.mockResolvedValue({ value: '100' });
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      { id: 't1', txid: 'tx-1', blockHeight: 10, confirmations: 0 },
    ]);
    mockGetBlockHeight.mockResolvedValue(12);
    mockPrismaClient.transaction.update.mockResolvedValue({});
    mockPrismaClient.$transaction.mockImplementation(async (ops: unknown) =>
      Array.isArray(ops) ? [] : (ops as (tx: unknown) => Promise<unknown>)(mockPrismaClient));

    await updateTransactionConfirmations('wallet-1');

    expect(mockGetBlockHeight).toHaveBeenCalledWith('testnet3');
    expect(mockGetBlockHeight).not.toHaveBeenCalledWith('mainnet');
  });

  it('does not consult any chain source once resolution has failed', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: '' });

    await expect(updateTransactionConfirmations('wallet-1')).rejects.toThrow(
      'Invalid persisted Bitcoin network',
    );

    expect(mockGetBlockHeight).not.toHaveBeenCalled();
    expect(mockGetNodeClient).not.toHaveBeenCalled();
    expect(vi.mocked(mockPrismaClient.transaction.update)).not.toHaveBeenCalled();
  });
}
