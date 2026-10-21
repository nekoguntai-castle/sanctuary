import { expect, it, vi } from 'vitest';

import { mockPrismaClient } from '../../../../../mocks/prisma';
import {
  getTransactionFieldPatches,
  mockGetBlockTimestamp,
  mockGetNodeClient,
} from './confirmationsTestHarness';
import {
  buildTransaction,
  nodeDetails,
  serveNodeTransactions,
  walletOutput,
} from './confirmationsNodeFixtures';
import { populateMissingTransactionFields } from '../../../../../../src/services/bitcoin/sync/confirmations';

export function registerPopulateMissingTransactionFieldsNetworkHistoryContracts() {
  // This case previously mocked `network: ''` and asserted the node client was
  // built for 'mainnet', pinning the fail-open fallback that
  // `config/wallet-sync-lifecycle-contract.json` forbids
  // (`invalidPersistedNetworkPolicy: fail_closed_without_mainnet_fallback`). An
  // empty persisted network now throws — see the persisted-network-resolution
  // contracts. The blockTime-derivation branches this case exists to cover are
  // unchanged and are exercised here against a valid network.
  it('covers blockTime derivation branches when wallet has no addresses', async () => {
    const needsTimestamp = buildTransaction({
      inputs: [{ txid: '11'.repeat(32), vout: 0 }],
      outputs: [{ script: walletOutput(1).script, valueSats: BigInt(1_000) }],
    });
    const mockClient = {
      getAddressHistory: vi.fn(async () => [{ tx_hash: 'tx-no-height', height: 0 }]),
      // `{}` carries no bytes, so it is rejected and the row keeps no height.
      getTransaction: serveNodeTransactions([
        ['tx-no-height', {}],
        [needsTimestamp.getId(), nodeDetails(needsTimestamp)],
      ]),
    };

    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
    mockGetNodeClient.mockResolvedValue(mockClient);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        id: 't-no-height',
        txid: 'tx-no-height',
        type: 'received',
        amount: BigInt(1000),
        fee: null,
        blockHeight: null,
        blockTime: null,
        confirmations: 0,
        addressId: null,
        counterpartyAddress: null,
      },
      {
        id: 't-needs-timestamp',
        txid: needsTimestamp.getId(),
        type: 'received',
        amount: BigInt(1000),
        fee: null,
        blockHeight: 999,
        blockTime: null,
        confirmations: 1,
        addressId: null,
        counterpartyAddress: null,
      },
    ]);
    mockPrismaClient.address.findMany.mockResolvedValue([]);
    mockGetBlockTimestamp.mockResolvedValue(null);

    const signal = new AbortController().signal;
    const result = await populateMissingTransactionFields(
      'wallet-1',
      signal,
      undefined,
      undefined,
      false,
      Date.now() + 30_000,
    );

    expect(result).toEqual({ updated: 0, confirmationUpdates: [] });
    expect(mockGetNodeClient).toHaveBeenCalledWith(
      'mainnet',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mockGetBlockTimestamp).toHaveBeenCalledWith(
      999,
      'mainnet',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(getTransactionFieldPatches()).toEqual([]);
  });

  it('ignores non-positive heights from address history during block-height extraction', async () => {
    const mockClient = {
      getAddressHistory: vi.fn(async () => [{ tx_hash: 'tx-h0', height: 0 }]),
      getTransaction: vi.fn(async () => null),
    };

    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
    mockGetNodeClient.mockResolvedValue(mockClient);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        id: 't-h0',
        txid: 'tx-h0',
        type: 'received',
        amount: BigInt(1000),
        fee: null,
        blockHeight: null,
        blockTime: null,
        confirmations: 0,
        addressId: null,
        counterpartyAddress: null,
      },
    ]);
    mockPrismaClient.address.findMany.mockResolvedValue([
      { id: 'addr-1', address: 'wallet-addr' },
    ]);

    const result = await populateMissingTransactionFields('wallet-1');

    expect(result).toEqual({ updated: 0, confirmationUpdates: [] });
    expect(mockClient.getAddressHistory).toHaveBeenCalledWith('wallet-addr');
    expect(getTransactionFieldPatches()).toEqual([]);
  });
}
