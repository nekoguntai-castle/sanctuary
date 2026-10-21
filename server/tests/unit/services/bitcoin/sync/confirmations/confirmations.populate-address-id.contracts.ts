import { expect, it, vi } from 'vitest';

import { mockPrismaClient } from '../../../../../mocks/prisma';
import { getTransactionFieldPatch, getTransactionFieldPatches, mockGetNodeClient } from './confirmationsTestHarness';
import {
  nodeDetails,
  payingTransaction,
  serveNodeTransactions,
  walletOutput,
} from './confirmationsNodeFixtures';
import { populateMissingTransactionFields } from '../../../../../../src/services/bitcoin/sync/confirmations';

const WALLET = walletOutput(1);
const EXTERNAL = walletOutput(3);

export function registerPopulateMissingTransactionFieldsAddressIdContracts() {
  it('does not populate sent addressId from server-supplied prevout fields', async () => {
    const sent = payingTransaction(EXTERNAL.script, 50_000, '11');
    const details = nodeDetails(sent);
    const vin = [{ ...details.vin[0], prevout: { scriptPubKey: { address: WALLET.address, addresses: [WALLET.address] } } }];
    const mockClient = {
      getAddressHistory: vi.fn(async () => []),
      getTransaction: serveNodeTransactions([[sent.getId(), { ...details, vin }]]),
    };

    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
    mockGetNodeClient.mockResolvedValue(mockClient);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        id: 't-sent-addressid',
        txid: sent.getId(),
        type: 'sent',
        amount: BigInt(-50000),
        fee: BigInt(1000),
        blockHeight: 999,
        blockTime: new Date('2024-01-01T00:00:00.000Z'),
        confirmations: 1,
        addressId: null,
        counterpartyAddress: 'already-set',
      },
    ]);
    mockPrismaClient.address.findMany.mockResolvedValue([
      { id: 'addr-1', address: WALLET.address },
    ]);

    const result = await populateMissingTransactionFields('wallet-1');

    expect(result.updated).toBe(0);
    expect(getTransactionFieldPatch('t-sent-addressid')).toBeUndefined();
  });

  it('leaves received transaction addressId unset when no output matches wallet addresses', async () => {
    const received = payingTransaction(EXTERNAL.script, 20_000, '11');
    const mockClient = {
      getAddressHistory: vi.fn(async () => []),
      getTransaction: serveNodeTransactions([[received.getId(), nodeDetails(received)]]),
    };

    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
    mockGetNodeClient.mockResolvedValue(mockClient);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        id: 't-recv-no-match',
        txid: received.getId(),
        type: 'received',
        amount: BigInt(20000),
        fee: null,
        blockHeight: 999,
        blockTime: new Date('2024-01-01T00:00:00.000Z'),
        confirmations: 1,
        addressId: null,
        counterpartyAddress: 'already-set',
      },
    ]);
    mockPrismaClient.address.findMany.mockResolvedValue([
      { id: 'addr-1', address: WALLET.address },
    ]);

    const result = await populateMissingTransactionFields('wallet-1');

    expect(result.updated).toBe(0);
    expect(getTransactionFieldPatches()).toEqual([]);
  });

  it('does not set received addressId when wallet lookup returns no id', async () => {
    const received = payingTransaction(WALLET.script, 20_000, '11');
    const mockClient = {
      getAddressHistory: vi.fn(async () => []),
      getTransaction: serveNodeTransactions([[received.getId(), nodeDetails(received)]]),
    };

    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
    mockGetNodeClient.mockResolvedValue(mockClient);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        id: 't-recv-missing-id',
        txid: received.getId(),
        type: 'received',
        amount: BigInt(20000),
        fee: null,
        blockHeight: 999,
        blockTime: new Date('2024-01-01T00:00:00.000Z'),
        confirmations: 1,
        addressId: null,
        counterpartyAddress: 'already-set',
      },
    ]);
    // Intentionally missing id to exercise the falsy-id branch.
    mockPrismaClient.address.findMany.mockResolvedValue([
      { id: undefined, address: WALLET.address } as any,
    ]);

    const result = await populateMissingTransactionFields('wallet-1');

    expect(result.updated).toBe(0);
    expect(getTransactionFieldPatches()).toEqual([]);
  });

  it('leaves received addressId unset when the transaction lookup misses or the wallet lookup id is missing', async () => {
    const missing = payingTransaction(WALLET.script, 30_000, '12');
    const received = payingTransaction(WALLET.script, 30_000, '13');
    const mockClient = {
      getAddressHistory: vi.fn(async () => []),
      getTransaction: serveNodeTransactions([
        [missing.getId(), new Error('transaction not found')],
        [received.getId(), nodeDetails(received)],
      ]),
    };

    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
    mockGetNodeClient.mockResolvedValue(mockClient);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      {
        id: 't-recv-lookup-miss',
        txid: missing.getId(),
        type: 'received',
        amount: BigInt(30000),
        fee: BigInt(1000),
        blockHeight: 999,
        blockTime: new Date('2024-01-01T00:00:00.000Z'),
        confirmations: 1,
        addressId: null,
        counterpartyAddress: 'already-set',
      },
      {
        id: 't-recv-missing-id',
        txid: received.getId(),
        type: 'received',
        amount: BigInt(30000),
        fee: BigInt(1000),
        blockHeight: 999,
        blockTime: new Date('2024-01-01T00:00:00.000Z'),
        confirmations: 1,
        addressId: null,
        counterpartyAddress: 'already-set',
      },
    ]);
    // Intentionally missing id to hit falsy lookup branch.
    mockPrismaClient.address.findMany.mockResolvedValue([
      { id: undefined, address: WALLET.address } as any,
    ]);

    const result = await populateMissingTransactionFields('wallet-1');

    expect(result.updated).toBe(0);
    expect(getTransactionFieldPatches()).toEqual([]);
  });
}
