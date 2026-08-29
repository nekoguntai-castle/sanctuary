import { vi, type Mock } from 'vitest';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { mockElectrumClient, resetElectrumMocks } from '../../../mocks/electrum';
import { testnetAddresses } from '../../../fixtures/bitcoin';

const legacyEvidence = vi.hoisted(() => ({
  transactions: new Map<string, any>(),
}));

vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

vi.mock('../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn().mockResolvedValue(mockElectrumClient),
}));

vi.mock('../../../../src/services/wallet/canonicalAddressValidation', () => ({
  assertCanonicalAddressesMatchWallet: vi.fn((_wallet, addresses) => {
    const bitcoin = require('bitcoinjs-lib');
    for (const address of addresses) {
      if (!address.scriptPubKey) {
        address.scriptPubKey = Buffer.from(bitcoin.address.toOutputScript(
          address.address,
          bitcoin.networks.testnet,
        )).toString('hex');
      }
    }
  }),
}));

vi.mock('../../../../src/services/bitcoin/blockchain/receiveEvidenceAuthentication', () => ({
  authenticateTransactionDetails: vi.fn((expectedTxid, candidate) => {
    if (!candidate) throw new Error('missing transaction');
    const bitcoin = require('bitcoinjs-lib');
    const normalized = {
      ...candidate,
      txid: expectedTxid,
      hex: expectedTxid,
      vin: (candidate.vin || []).map((input: any) => {
        const address = input.prevout?.scriptPubKey?.address
          || input.prevout?.scriptPubKey?.addresses?.[0];
        if (!address) return input;
        try {
          const hex = Buffer.from(
            bitcoin.address.toOutputScript(address, bitcoin.networks.testnet),
          ).toString('hex');
          return {
            ...input,
            prevout: {
              ...input.prevout,
              scriptPubKey: { ...input.prevout.scriptPubKey, hex },
            },
          };
        } catch {
          return input;
        }
      }),
      vout: (candidate.vout || []).map((output: any, n: number) => {
        const address = output.scriptPubKey?.address || output.scriptPubKey?.addresses?.[0];
        let hex = output.scriptPubKey?.hex;
        if (address) {
          try {
            hex = Buffer.from(
              bitcoin.address.toOutputScript(address, bitcoin.networks.testnet),
            ).toString('hex');
          } catch {
            hex = output.scriptPubKey?.hex;
          }
        }
        return { ...output, n, scriptPubKey: { ...output.scriptPubKey, hex } };
      }),
    };
    legacyEvidence.transactions.set(expectedTxid, normalized);
    return normalized;
  }),
}));

vi.mock('../../../../src/services/bitcoin/rawTransactionEvidence', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../src/services/bitcoin/rawTransactionEvidence')>();
  return {
    ...actual,
    authenticateRawTransactionOutput: vi.fn((input: any) => {
      const output = legacyEvidence.transactions.get(input.expectedTxid)?.vout?.[input.vout];
      if (!output) throw new actual.RawTransactionEvidenceError('missing_output');
      const valueSats = BigInt(Math.round(output.value * 100_000_000));
      if (valueSats !== input.expectedValueSats) {
        throw new actual.RawTransactionEvidenceError('amount_mismatch');
      }
      if (output.scriptPubKey.hex !== input.expectedScriptPubKeyHex) {
        throw new actual.RawTransactionEvidenceError('script_mismatch');
      }
      return { valueSats, scriptPubKeyHex: output.scriptPubKey.hex };
    }),
  };
});

vi.mock('../../../../src/services/bitcoin/utils', () => ({
  validateAddress: vi.fn().mockReturnValue({ valid: true }),
  parseTransaction: vi.fn(),
  getNetwork: vi.fn().mockReturnValue(require('bitcoinjs-lib').networks.testnet),
}));

vi.mock('../../../../src/websocket/notifications', () => ({
  walletLog: vi.fn(),
}));

vi.mock('../../../../src/services/bitcoin/utils/balanceCalculation', () => ({
  recalculateWalletBalances: vi.fn().mockResolvedValue(undefined),
}));

import { syncAddress, checkAddress } from '../../../../src/services/bitcoin/blockchain';
import { getConfirmations } from '../../../../src/services/bitcoin/blockchain/syncAddress';
import { authenticateTransactionDetails } from '../../../../src/services/bitcoin/blockchain/receiveEvidenceAuthentication';
import {
  authenticateRawTransactionOutput,
  RawTransactionEvidenceError,
} from '../../../../src/services/bitcoin/rawTransactionEvidence';
import {
  type AddressSyncTransactionInput,
  ADDRESS_SYNC_IO_UPSERT_MAX_BINDS,
  ADDRESS_SYNC_IO_UPSERT_MAX_ROWS,
  ADDRESS_SYNC_OUTPUT_UPSERT_BIND_COLUMNS,
  persistAddressSyncIORows,
  markClassificationRepairAttempts,
  markOwnershipRepairNeeded,
  markIoRepairAttempts,
  reconcileAddressSyncTransaction,
  reconcileTransactionBatch,
  findWalletRbfReplacements,
  reconcilePendingRbfForConfirmedTransactions,
  reconcileWalletRbfReplacement,
  batchUpdateByIds as batchUpdateTransactionsByIds,
  recalculateBalancesAtomically,
} from '../../../../src/repositories/transactions/sync';
import { storeTransactionIO } from '../../../../src/services/bitcoin/blockchain/transactionIO';
import { processHistoryTransactions } from '../../../../src/services/bitcoin/blockchain/historyTransactions';
import { validateAddress } from '../../../../src/services/bitcoin/utils';
import { recalculateWalletBalances } from '../../../../src/services/bitcoin/utils/balanceCalculation';
import { assertCanonicalAddressesMatchWallet } from '../../../../src/services/wallet/canonicalAddressValidation';
import { getNodeClient, type NodeClientInterface } from '../../../../src/services/bitcoin/nodeClient';

const transactionIoClient = {
  ...mockElectrumClient,
  getServerFeatures: vi.fn().mockResolvedValue({}),
} satisfies NodeClientInterface;

interface BatchedTransactionDetails {
  txid: string;
  vin: Array<{ txid: string; vout: number }>;
  vout: Array<{ value: number; scriptPubKey: { address: string } }>;
}

describe('Blockchain syncAddress branch coverage', () => {
  beforeEach(() => {
    legacyEvidence.transactions.clear();
    resetPrismaMocks();
    resetElectrumMocks();
    mockPrismaClient.transaction.createMany.mockResolvedValue({ count: 1 });
  });

  it('handles previous-tx batch fetch, consolidation detection, UTXO insert, and IO persistence', async () => {
    const addressId = 'addr-id';
    const walletId = 'wallet-id';
    const mainAddress = testnetAddresses.nativeSegwit[0];
    const changeAddress = testnetAddresses.nativeSegwit[1];
    const externalAddress = 'tb1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';

    const txMain = 'a'.repeat(64);
    const txMissing = 'b'.repeat(64);
    const prevTx = 'c'.repeat(64);
    const utxoOnlyTx = 'd'.repeat(64);

    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address: mainAddress,
      walletId,
      wallet: { id: walletId, network: 'testnet' },
      used: false,
    });

    mockPrismaClient.address.findMany.mockResolvedValue([
      { address: mainAddress },
      { address: changeAddress },
    ]);

    mockElectrumClient.getAddressHistory.mockResolvedValue([
      { tx_hash: txMissing, height: 101 },
      { tx_hash: txMain, height: 100 },
      { tx_hash: txMain, height: 100 },
    ]);

    mockPrismaClient.transaction.findMany
      .mockResolvedValueOnce([
        { id: 'sent-1', txid: 's'.repeat(64), type: 'sent' },
        { id: 'recv-1', txid: 'r'.repeat(64), type: 'received' },
        { id: 'cons-1', txid: 'k'.repeat(64), type: 'consolidation' },
        { id: 'skip-1', txid: 'z'.repeat(64), type: 'sent' },
      ]);

    mockElectrumClient.getTransactionsBatch.mockImplementation(async (txids: string[]) => {
      if (txids.includes(txMain)) {
        return new Map([
          [
            txMain,
            {
              txid: txMain,
              hex: '00',
              vin: [{ txid: prevTx, vout: 0 }],
              vout: [
                { value: 0.0005, n: 0, scriptPubKey: { hex: '0014' + '11'.repeat(20), address: mainAddress } },
                { value: 0.0004, n: 1, scriptPubKey: { hex: '0014' + '22'.repeat(20), address: changeAddress } },
              ],
            },
          ],
        ]);
      }
      if (txids.includes(prevTx)) {
        return new Map([
          [
            prevTx,
            {
              txid: prevTx,
              hex: '00',
              vin: [],
              vout: [
                { value: 0.001, n: 0, scriptPubKey: { hex: '0014' + '33'.repeat(20), address: mainAddress } },
              ],
            },
          ],
        ]);
      }
      if (txids.includes(utxoOnlyTx)) {
        return new Map([
          [
            utxoOnlyTx,
            {
              txid: utxoOnlyTx,
              hex: '00',
              vin: [],
              vout: [
                { value: 0.0002, n: 0, scriptPubKey: { hex: '0014' + '44'.repeat(20), address: mainAddress } },
              ],
            },
          ],
        ]);
      }
      if (txids.includes('s'.repeat(64))) {
        return new Map([
          [
            's'.repeat(64),
            {
              txid: 's'.repeat(64),
              hex: '00',
              vin: [
                {
                  txid: 'x'.repeat(64),
                  vout: 0,
                  prevout: {
                    value: 2_000_000,
                    scriptPubKey: { hex: '0014' + '55'.repeat(20), address: mainAddress },
                  },
                },
              ],
              vout: [
                { value: 0.0001, n: 0, scriptPubKey: { hex: '0014' + '66'.repeat(20), address: externalAddress } },
                { value: 0.0002, n: 1, scriptPubKey: { hex: '0014' + '77'.repeat(20), address: mainAddress } },
              ],
            },
          ],
          [
            'r'.repeat(64),
            {
              txid: 'r'.repeat(64),
              hex: '00',
              vin: [],
              vout: [
                { value: 0.0003, n: 0, scriptPubKey: { hex: '0014' + '88'.repeat(20), address: mainAddress } },
              ],
            },
          ],
          [
            'k'.repeat(64),
            {
              txid: 'k'.repeat(64),
              hex: '00',
              vin: [],
              vout: [
                { value: 0.0003, n: 0, scriptPubKey: { hex: '0014' + '99'.repeat(20), address: changeAddress } },
              ],
            },
          ],
        ]);
      }
      return new Map();
    });

    mockElectrumClient.getAddressUTXOs.mockResolvedValue([
      { tx_hash: txMain, tx_pos: 1, value: 40_000, height: 100 },
      { tx_hash: utxoOnlyTx, tx_pos: 0, value: 20_000, height: 105 },
    ]);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
    mockElectrumClient.getBlockHeight.mockResolvedValue(110);

    await expect(syncAddress(addressId)).rejects.toMatchObject({
      name: 'ReceiveEvidenceRetryableError',
    });
    expect(mockPrismaClient.transaction.createMany).not.toHaveBeenCalled();
    expect(mockPrismaClient.uTXO.createMany).not.toHaveBeenCalled();
  });

  it('caps history and previous-transaction fetches at 100 txids', async () => {
    const addressId = 'address-bounded-fetch';
    const walletId = 'wallet-bounded-fetch';
    const mainAddress = testnetAddresses.nativeSegwit[0];
    const currentTxids = Array.from(
      { length: 101 },
      (_, index) => index.toString(16).padStart(64, '0')
    );
    const previousTxids = Array.from(
      { length: 101 },
      (_, index) => (1000 + index).toString(16).padStart(64, '0')
    );
    const currentTxidSet = new Set(currentTxids);

    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address: mainAddress,
      walletId,
      wallet: { id: walletId, network: 'testnet' },
      used: false,
    });
    mockPrismaClient.address.findMany.mockResolvedValue([{ address: mainAddress }]);
    mockElectrumClient.getAddressHistory.mockResolvedValue(
      currentTxids.map(tx_hash => ({ tx_hash, height: 0 }))
    );
    mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);
    mockElectrumClient.getTransactionsBatch.mockImplementation(async (txids: string[]) => {
      return new Map<string, BatchedTransactionDetails>(txids.map(txid => {
        const currentIndex = currentTxids.indexOf(txid);
        if (currentTxidSet.has(txid)) {
          return [txid, {
            txid,
            vin: [{ txid: previousTxids[currentIndex], vout: 0 }],
            vout: [],
          }];
        }
        return [txid, {
          txid,
          vin: [],
          vout: [{ value: 1, scriptPubKey: { address: mainAddress } }],
        }];
      }));
    });
    mockPrismaClient.transaction.findMany.mockResolvedValue([]);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

    await syncAddress(addressId);

    const requestedBatches = mockElectrumClient.getTransactionsBatch.mock.calls
      .map(([txids]) => txids as string[]);
    expect(requestedBatches).toHaveLength(4);
    expect(requestedBatches.every(txids => txids.length <= 100)).toBe(true);
    expect(requestedBatches.flat()).toEqual([...currentTxids, ...previousTxids]);
  });

  it('propagates I/O persistence errors so authenticated backfill remains retryable', async () => {
    const addressId = 'addr-io-error';
    const walletId = 'wallet-io-error';
    const mainAddress = testnetAddresses.nativeSegwit[0];
    const historyTx = 'e'.repeat(64);

    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address: mainAddress,
      walletId,
      wallet: { id: walletId, network: 'regtest' },
      used: true,
    });
    mockPrismaClient.address.findMany.mockResolvedValue([{ address: mainAddress }]);
    mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: historyTx, height: 1 }]);
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(
      new Map([
        [
          historyTx,
          {
            txid: historyTx,
            hex: '00',
            vin: [],
            vout: [{ value: 0.0001, n: 0, scriptPubKey: { hex: '0014' + 'aa'.repeat(20), address: mainAddress } }],
          },
        ],
      ])
    );
    mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
    mockElectrumClient.getBlockHeight.mockRejectedValue(new Error('height unavailable'));
    mockPrismaClient.transaction.findMany
      .mockRejectedValueOnce(new Error('io persistence failed'));

    await expect(syncAddress(addressId)).rejects.toThrow('io persistence failed');
  });

  it('creates a sent transaction with unknown fee when wallet input value is missing', async () => {
    const addressId = 'addr-sent';
    const walletId = 'wallet-sent';
    const mainAddress = testnetAddresses.nativeSegwit[0];
    const externalAddress = testnetAddresses.nativeSegwit[1];
    const txid = 'f'.repeat(64);

    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address: mainAddress,
      walletId,
      wallet: { id: walletId, network: 'testnet' },
      used: true,
    });
    mockPrismaClient.address.findMany.mockResolvedValue([{ address: mainAddress }]);
    mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: txid, height: 500 }]);
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(
      new Map([
        [
          txid,
          {
            txid,
            hex: '00',
            vin: [
              {
                txid: 'p'.repeat(64),
                vout: 0,
                prevout: {
                  scriptPubKey: {
                    hex: '0014' + 'bb'.repeat(20),
                    address: mainAddress,
                  },
                },
              },
            ],
            vout: [
              { value: 0.0001, n: 0, scriptPubKey: { hex: '0014' + 'cc'.repeat(20), address: externalAddress } },
              { value: 0.0002, n: 1, scriptPubKey: { hex: '0014' + 'dd'.repeat(20), address: mainAddress } },
            ],
          },
        ],
      ])
    );
    mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
    mockElectrumClient.getBlockHeight.mockResolvedValue(510);
    mockPrismaClient.transaction.findMany.mockResolvedValueOnce([]);

    const result = await syncAddress(addressId);

    expect(result.transactions).toBe(1);
    expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({
          type: 'sent',
          fee: null,
          amount: BigInt(-10_000),
        })],
      })
    );
  });

  it('handles existing and incomplete UTXOs while skipping empty I/O persistence batches', async () => {
    const addressId = 'addr-utxo-edge';
    const walletId = 'wallet-utxo-edge';
    const mainAddress = testnetAddresses.nativeSegwit[0];
    const historyTx = 'g'.repeat(64);
    const existingUtxoTx = 'h'.repeat(64);
    const missingUtxoTx = 'i'.repeat(64);
    const zeroHeightUtxoTx = 'j'.repeat(64);
    const ioTx = 'k'.repeat(64);

    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address: mainAddress,
      walletId,
      wallet: { id: walletId, network: 'testnet' },
      used: true,
    });
    mockPrismaClient.address.findMany.mockResolvedValue([{ address: mainAddress }]);
    mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: historyTx, height: 100 }]);
    mockElectrumClient.getAddressUTXOs.mockResolvedValue([
      { tx_hash: existingUtxoTx, tx_pos: 0, value: 11_000, height: 120 },
      { tx_hash: missingUtxoTx, tx_pos: 0, value: 12_000, height: 121 },
      { tx_hash: zeroHeightUtxoTx, tx_pos: 0, value: 13_000, height: 0 },
    ]);
    mockPrismaClient.transaction.findMany
      .mockResolvedValueOnce([{ id: 'io-1', txid: ioTx, type: 'received' }]);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([{ txid: existingUtxoTx, vout: 0 }]);
    mockElectrumClient.getBlockHeight.mockResolvedValue(150);

    mockElectrumClient.getTransactionsBatch.mockImplementation(async (txids: string[]) => {
      if (txids.includes(historyTx)) {
        return new Map([
          [
            historyTx,
            {
              txid: historyTx,
              hex: '00',
              vin: [],
              vout: [{ value: 0.0001, n: 0, scriptPubKey: { hex: '0014' + '11'.repeat(20), address: mainAddress } }],
            },
          ],
        ]);
      }
      if (txids.includes(zeroHeightUtxoTx)) {
        return new Map([
          [
            zeroHeightUtxoTx,
            {
              txid: zeroHeightUtxoTx,
              hex: '00',
              vin: [],
              vout: [{ value: 0.00013, n: 0, scriptPubKey: { hex: '0014' + '12'.repeat(20), address: mainAddress } }],
            },
          ],
        ]);
      }
      if (txids.includes(ioTx)) {
        return new Map([
          [
            ioTx,
            {
              txid: ioTx,
              hex: '00',
              vout: [{ value: 0.0002, n: 0, scriptPubKey: { hex: '0014' + '13'.repeat(20) } }],
            },
          ],
        ]);
      }
      return new Map();
    });

    await expect(syncAddress(addressId)).rejects.toMatchObject({
      name: 'ReceiveEvidenceRetryableError',
    });
    expect(mockPrismaClient.transaction.createMany).not.toHaveBeenCalled();
    expect(mockPrismaClient.uTXO.createMany).not.toHaveBeenCalled();
  });

  it('covers I/O parsing fallbacks for input/output classification', async () => {
    const addressId = 'addr-io-branches';
    const walletId = 'wallet-io-branches';
    const mainAddress = testnetAddresses.nativeSegwit[0];
    const externalAddress = testnetAddresses.nativeSegwit[1];
    const historyTx = 'l'.repeat(64);
    const sentTx = 'm'.repeat(64);
    const receivedTx = 'n'.repeat(64);
    const consolidationTx = 'o'.repeat(64);
    const prevInputTx = 'p'.repeat(64);

    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address: mainAddress,
      walletId,
      wallet: { id: walletId, network: 'testnet' },
      used: true,
    });
    mockPrismaClient.address.findMany.mockResolvedValue([{ address: mainAddress }]);
    mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: historyTx, height: 600 }]);
    mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);
    mockElectrumClient.getBlockHeight.mockResolvedValue(610);
    mockPrismaClient.transaction.findMany
      .mockResolvedValueOnce([
        { id: 'sent-io', txid: sentTx, type: 'sent' },
        { id: 'recv-io', txid: receivedTx, type: 'received' },
        { id: 'cons-io', txid: consolidationTx, type: 'consolidation' },
      ])
      .mockResolvedValueOnce([
        { id: 'sent-io', type: 'sent' },
        { id: 'recv-io', type: 'received' },
        { id: 'cons-io', type: 'consolidation' },
      ]);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

    mockElectrumClient.getTransactionsBatch.mockImplementation(async (txids: string[]) => {
      if (txids.includes(historyTx)) {
        return new Map([
          [
            historyTx,
            {
              txid: historyTx,
              hex: '00',
              vin: [],
              vout: [{ value: 0.0002, n: 0, scriptPubKey: { hex: '0014' + '21'.repeat(20), address: mainAddress } }],
            },
          ],
        ]);
      }

      if (txids.includes(sentTx)) {
        return new Map([
          [
            sentTx,
            {
              txid: sentTx,
              hex: '00',
              vin: [
                { coinbase: true },
                {
                  txid: prevInputTx,
                  vout: 0,
                  prevout: {
                    scriptPubKey: {
                      hex: '0014' + '22'.repeat(20),
                      addresses: [mainAddress],
                    },
                  },
                },
                {
                  vout: 1,
                  prevout: {
                    value: 0.0003,
                    scriptPubKey: {
                      hex: '0014' + '23'.repeat(20),
                      address: mainAddress,
                    },
                  },
                },
                {
                  txid: 'q'.repeat(64),
                  vout: 2,
                },
              ],
              vout: [
                { value: 0, n: 0, scriptPubKey: { hex: '0014' + '24'.repeat(20), addresses: [externalAddress] } },
                { value: 0.0001, n: 1, scriptPubKey: { hex: '0014' + '25'.repeat(20), address: mainAddress } },
              ],
            },
          ],
          [
            receivedTx,
            {
              txid: receivedTx,
              hex: '00',
              vin: [],
              vout: [{ value: 0.0003, n: 0, scriptPubKey: { hex: '0014' + '26'.repeat(20), address: externalAddress } }],
            },
          ],
          [
            consolidationTx,
            {
              txid: consolidationTx,
              hex: '00',
              vin: [],
              vout: [{ value: 0.0004, n: 0, scriptPubKey: { hex: '0014' + '27'.repeat(20), address: mainAddress } }],
            },
          ],
        ]);
      }

      return new Map();
    });

    const result = await syncAddress(addressId);

    expect(result.transactions).toBe(1);
    expect(mockPrismaClient.transactionInput.createMany).not.toHaveBeenCalled();
    expect(mockPrismaClient.transactionOutput.createMany).not.toHaveBeenCalled();
  });

  it('covers sent/received skip paths, address fallbacks, and consolidation I/O branches', async () => {
    const addressId = 'addr-skip-branches';
    const walletId = 'wallet-skip-branches';
    const mainAddress = testnetAddresses.nativeSegwit[0];
    const changeAddress = testnetAddresses.nativeSegwit[1];
    const externalAddress = 'tb1q8n7f9k3m0v6x5p4s2t1w0y8z7a6b5c4d3e2f1g';

    const receivedTx = 'u'.repeat(64);
    const sentTx = 'v'.repeat(64);
    const existingSentTx = 'w'.repeat(64);
    const existingConsolidationTx = 'x'.repeat(64);
    const missingFieldsTx = 'y'.repeat(64);
    const noDestinationTx = '3'.repeat(64);
    const unknownTypeTx = '4'.repeat(64);
    const prevLookupTx = 'z'.repeat(64);
    const prevNoAddrTx = '1'.repeat(64);
    const prevMissingTx = '2'.repeat(64);

    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address: mainAddress,
      walletId,
      wallet: { id: walletId, network: 'testnet' },
      used: true,
    });
    mockPrismaClient.address.findMany.mockResolvedValue([
      { address: mainAddress },
      { address: changeAddress },
    ]);

    mockElectrumClient.getAddressHistory.mockResolvedValue([
      { tx_hash: receivedTx, height: 0 },
      { tx_hash: sentTx, height: 0 },
      { tx_hash: existingSentTx, height: 1 },
      { tx_hash: existingConsolidationTx, height: 2 },
      { tx_hash: missingFieldsTx, height: 3 },
      { tx_hash: noDestinationTx, height: 4 },
      { tx_hash: unknownTypeTx, height: 5 },
    ]);

    let batchCall = 0;
    mockElectrumClient.getTransactionsBatch.mockImplementation(async () => {
      batchCall += 1;

      if (batchCall === 1) {
        return new Map([
          [
            receivedTx,
            {
              txid: receivedTx,
              hex: '00',
              vin: [],
              vout: [{ value: 0.0003, n: 0, scriptPubKey: { hex: '0014' + '31'.repeat(20), addresses: [mainAddress] } }],
            },
          ],
          [
            sentTx,
            {
              txid: sentTx,
              hex: '00',
              vin: [
                { coinbase: true },
                {
                  prevout: {
                    value: 0.0005,
                    scriptPubKey: { hex: '0014' + '32'.repeat(20), addresses: [mainAddress] },
                  },
                },
                {
                  prevout: {
                    value: 0.0001,
                    scriptPubKey: { hex: '0014' + '33'.repeat(20) },
                  },
                },
                {},
                { txid: prevMissingTx, vout: 0 },
              ],
              vout: [
                { value: 0.0001, n: 0, scriptPubKey: { hex: '0014' + '34'.repeat(20), addresses: [externalAddress] } },
                { value: 0.0002, n: 1, scriptPubKey: { hex: '0014' + '35'.repeat(20), address: mainAddress } },
                { value: 0.00001, n: 2 },
              ],
            },
          ],
          [
            existingSentTx,
            {
              txid: existingSentTx,
              hex: '00',
              vin: [
                { txid: prevLookupTx, vout: 0 },
                { txid: prevNoAddrTx, vout: 0 },
              ],
              vout: [{ value: 0.0001, n: 0, scriptPubKey: { hex: '0014' + '36'.repeat(20), address: externalAddress } }],
            },
          ],
          [
            existingConsolidationTx,
            {
              txid: existingConsolidationTx,
              hex: '00',
              vin: [
                {
                  prevout: {
                    value: 0.0004,
                    scriptPubKey: { hex: '0014' + '37'.repeat(20), address: mainAddress },
                  },
                },
              ],
              vout: [{ value: 0.00039, n: 0, scriptPubKey: { hex: '0014' + '38'.repeat(20), address: changeAddress } }],
            },
          ],
          [missingFieldsTx, { txid: missingFieldsTx, hex: '00' }],
          [
            noDestinationTx,
            {
              txid: noDestinationTx,
              hex: '00',
              vin: [
                {
                  prevout: {
                    value: 0.0006,
                    scriptPubKey: { hex: '0014' + '42'.repeat(20), address: mainAddress },
                  },
                },
              ],
              vout: [{ value: 0.00059, n: 0 }],
            },
          ],
          [
            unknownTypeTx,
            {
              txid: unknownTypeTx,
              hex: '00',
              vin: [],
              vout: [{ value: 0.00011, n: 0, scriptPubKey: { hex: '0014' + '43'.repeat(20), address: externalAddress } }],
            },
          ],
        ]);
      }

      if (batchCall === 2) {
        return new Map([
          [
            prevLookupTx,
            {
              txid: prevLookupTx,
              hex: '00',
              vout: [{ value: 0.0008, n: 0, scriptPubKey: { hex: '0014' + '39'.repeat(20), addresses: [mainAddress] } }],
            },
          ],
          [
            prevNoAddrTx,
            {
              txid: prevNoAddrTx,
              hex: '00',
              vout: [{ value: 0.0002, n: 0, scriptPubKey: { hex: '0014' + '40'.repeat(20) } }],
            },
          ],
        ]);
      }

      return new Map([
        [
          existingConsolidationTx,
          {
            txid: existingConsolidationTx,
            hex: '00',
            vin: [],
            vout: [{ value: 0.00039, n: 0, scriptPubKey: { hex: '0014' + '41'.repeat(20), address: mainAddress } }],
          },
        ],
        [missingFieldsTx, { txid: missingFieldsTx, hex: '00', vin: [] }],
        [
          unknownTypeTx,
          {
            txid: unknownTypeTx,
            hex: '00',
            vin: [],
            vout: [{ value: 0.00011, n: 0, scriptPubKey: { hex: '0014' + '43'.repeat(20), address: externalAddress } }],
          },
        ],
      ]);
    });

    mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
    mockPrismaClient.transaction.findMany
      .mockResolvedValueOnce([
        { id: 'io-cons', txid: existingConsolidationTx, type: 'consolidation' },
        { id: 'io-empty', txid: missingFieldsTx, type: 'sent' },
        { id: 'io-unknown', txid: unknownTypeTx, type: 'unknown' as any },
      ])
      .mockResolvedValueOnce([
        { id: 'io-cons', type: 'consolidation' },
        { id: 'io-empty', type: 'sent' },
        { id: 'io-unknown', type: 'unknown' as any },
      ]);

    mockPrismaClient.transaction.createMany.mockImplementation(async ({ data }: any) => ({
      count: [existingSentTx, existingConsolidationTx].includes(data[0].txid) ? 0 : 1,
    }));

    await expect(syncAddress(addressId)).rejects.toMatchObject({
      name: 'ReceiveEvidenceRetryableError',
    });
    expect(mockPrismaClient.transaction.createMany).not.toHaveBeenCalled();
    expect(mockPrismaClient.transactionOutput.createMany).not.toHaveBeenCalled();
  });

  it('retries missing transaction I/O when scalar reconciliation is unchanged', async () => {
    const addressId = 'addr-io-retry';
    const walletId = 'wallet-io-retry';
    const mainAddress = testnetAddresses.nativeSegwit[0];
    const txid = '5'.repeat(64);

    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address: mainAddress,
      walletId,
      wallet: { id: walletId, network: 'regtest' },
      used: true,
    });
    mockPrismaClient.address.findMany.mockResolvedValue([{ address: mainAddress }]);
    mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: txid, height: 0 }]);
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([
      [txid, {
        txid,
        hex: '00',
        vin: [],
        vout: [{
          value: 0.0001,
          n: 0,
          scriptPubKey: { hex: '0014' + '51'.repeat(20), address: mainAddress },
        }],
      }],
    ]));
    mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
    mockPrismaClient.transaction.createMany.mockResolvedValue({ count: 0 });
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      { id: 'existing-io-retry', txid, type: 'received' },
    ]);

    const result = await syncAddress(addressId);

    expect(result.transactions).toBe(0);
    expect(mockPrismaClient.transactionOutput.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ transactionId: 'existing-io-retry' })],
        skipDuplicates: true,
      })
    );
  });

  it('retries balance recalculation after an address sync post-commit failure', async () => {
    const addressId = 'addr-balance-retry';
    const walletId = 'wallet-balance-retry';
    const address = testnetAddresses.nativeSegwit[0];
    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address,
      walletId,
      wallet: { id: walletId, network: 'testnet' },
      used: true,
    });
    mockPrismaClient.address.findMany.mockResolvedValue([{ address }]);
    mockElectrumClient.getAddressHistory.mockResolvedValue([]);
    mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
    mockPrismaClient.$queryRaw.mockResolvedValue([{ pending: true }]);
    (recalculateWalletBalances as Mock)
      .mockRejectedValueOnce(new Error('balance update failed'))
      .mockResolvedValueOnce(undefined);

    await expect(syncAddress(addressId)).rejects.toThrow('balance update failed');
    await expect(syncAddress(addressId)).resolves.toEqual({ transactions: 0, utxos: 0 });

    expect(recalculateWalletBalances).toHaveBeenCalledTimes(2);
    expect(recalculateWalletBalances).toHaveBeenNthCalledWith(2, walletId);
  });

  it('sums every wallet-owned output for a receive discovered by one address', async () => {
    const addressId = 'addr-wallet-wide-receive';
    const walletId = 'wallet-wide-receive';
    const triggeringAddress = testnetAddresses.nativeSegwit[0];
    const secondWalletAddress = testnetAddresses.nativeSegwit[1];
    const txid = '4'.repeat(64);

    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address: triggeringAddress,
      walletId,
      wallet: { id: walletId, network: 'testnet' },
      used: true,
    });
    mockPrismaClient.address.findMany.mockResolvedValue([
      { address: triggeringAddress },
      { address: secondWalletAddress },
    ]);
    mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: txid, height: 0 }]);
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([
      [txid, {
        txid,
        hex: '00',
        vin: [],
        vout: [
          {
            value: 0.0001,
            n: 0,
            scriptPubKey: { hex: '0014' + '41'.repeat(20), address: triggeringAddress },
          },
          {
            value: 0.0002,
            n: 1,
            scriptPubKey: { hex: '0014' + '42'.repeat(20), address: secondWalletAddress },
          },
        ],
      }],
    ]));
    mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
    await syncAddress(addressId);

    expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({
          txid,
          addressId,
          type: 'received',
          amount: BigInt(30_000),
          rbfStatus: 'active',
        })],
      })
    );
  });

  it('uses wallet delta for a mixed-owner Payjoin receive in address sync', async () => {
    const addressId = 'addr-payjoin-receive';
    const walletId = 'wallet-payjoin-receive';
    const walletAddress = testnetAddresses.nativeSegwit[0];
    const externalAddress = testnetAddresses.nativeSegwit[1];
    const txid = '8'.repeat(64);
    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address: walletAddress,
      walletId,
      wallet: { id: walletId, network: 'testnet' },
      used: true,
    });
    mockPrismaClient.address.findMany.mockResolvedValue([{ address: walletAddress }]);
    mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: txid, height: 0 }]);
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, {
      txid,
      vin: [
        { prevout: { value: 0.001, scriptPubKey: { address: walletAddress } } },
        { prevout: { value: 0.002, scriptPubKey: { address: externalAddress } } },
      ],
      vout: [
        { value: 0.0014, n: 0, scriptPubKey: { address: walletAddress } },
        { value: 0.0015, n: 1, scriptPubKey: { address: externalAddress } },
      ],
    }]]));
    mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
    mockPrismaClient.transaction.createMany.mockResolvedValue({ count: 0 });
    mockPrismaClient.$queryRaw.mockResolvedValue([{
      id: 'stale-payjoin-row',
      classificationInputsComplete: true,
      classificationVersion: 1,
    }]);

    await syncAddress(addressId);

    expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({
          txid,
          type: 'received',
          amount: BigInt(40_000),
          classificationInputsComplete: true,
          classificationVersion: 2,
        })],
      })
    );
    expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
      where: { id: 'stale-payjoin-row' },
      data: expect.objectContaining({
        amount: BigInt(40_000),
        classificationVersion: 2,
      }),
    });
    expect(recalculateWalletBalances).toHaveBeenCalledWith(walletId);
  });

  it('fetches a referenced value when an inline input has only an address', async () => {
    const addressId = 'addr-inline-value-repair';
    const walletId = 'wallet-inline-value-repair';
    const walletAddress = testnetAddresses.nativeSegwit[0];
    const externalAddress = testnetAddresses.nativeSegwit[1];
    const txid = '6'.repeat(64);
    const previousTxid = '7'.repeat(64);
    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address: walletAddress,
      walletId,
      wallet: { id: walletId, network: 'testnet' },
      used: true,
    });
    mockPrismaClient.address.findMany.mockResolvedValue([{ address: walletAddress }]);
    mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: txid, height: 0 }]);
    mockElectrumClient.getTransactionsBatch
      .mockResolvedValueOnce(new Map([[txid, {
        txid,
        vin: [{
          txid: previousTxid,
          vout: 0,
          prevout: { scriptPubKey: { address: walletAddress } },
        }],
        vout: [{ value: 0.0009, n: 0, scriptPubKey: { address: externalAddress } }],
      }]]))
      .mockResolvedValueOnce(new Map([[previousTxid, {
        txid: previousTxid,
        vin: [],
        vout: [{ value: 0.001, n: 0, scriptPubKey: { address: walletAddress } }],
      }]]));
    mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
    mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
      if (args?.where?.ioComplete === false) {
        return [{ id: 'inline-value-row', txid, type: 'sent' }];
      }
      if (args?.select?.id && args?.select?.txid && args?.select?.type) {
        return [{ id: 'inline-value-row', txid, type: 'sent' }];
      }
      return [];
    });

    await syncAddress(addressId);

    expect(mockElectrumClient.getTransactionsBatch).toHaveBeenNthCalledWith(
      2,
      [previousTxid],
      true
    );
    expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({
          txid,
          type: 'sent',
          amount: BigInt(-100_000),
          fee: BigInt(10_000),
          classificationInputsComplete: true,
        })],
      })
    );
    expect(mockPrismaClient.transactionInput.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({
          txid: previousTxid,
          amount: BigInt(100_000),
        })],
      })
    );
  });

  it('reclassifies and repairs output ownership after the wallet address set expands', async () => {
    const addressId = 'addr-gap-repair';
    const walletId = 'wallet-gap-repair';
    const originalWalletAddress = testnetAddresses.nativeSegwit[0];
    const discoveredWalletAddress = testnetAddresses.nativeSegwit[1];
    const txid = 'd'.repeat(64);
    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address: originalWalletAddress,
      walletId,
      wallet: { id: walletId, network: 'testnet' },
      used: true,
    });
    mockPrismaClient.address.findMany.mockResolvedValue([
      { address: originalWalletAddress },
      { address: discoveredWalletAddress },
    ]);
    mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: txid, height: 0 }]);
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, {
      txid,
      vin: [
        { prevout: { value: 0.001, scriptPubKey: { address: originalWalletAddress } } },
        { prevout: { value: 0.002, scriptPubKey: { address: discoveredWalletAddress } } },
      ],
      vout: [
        { value: 0.0014, n: 0, scriptPubKey: { address: originalWalletAddress } },
        { value: 0.0015, n: 1, scriptPubKey: { address: discoveredWalletAddress } },
      ],
    }]]));
    mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
    mockPrismaClient.transaction.createMany.mockResolvedValue({ count: 0 });
    mockPrismaClient.$queryRaw.mockResolvedValue([{
      id: 'gap-repair-row',
      classificationInputsComplete: true,
      classificationVersion: 2,
      classificationAddressCount: 1,
    }]);
    mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
      if (args?.select?.id && args?.select?.txid && args?.select?.type) {
        return [{ id: 'gap-repair-row', txid, type: 'consolidation' }];
      }
      return [];
    });

    await syncAddress(addressId);

    expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
      where: { id: 'gap-repair-row' },
      data: expect.objectContaining({
        type: 'consolidation',
        amount: BigInt(-10_000),
        fee: BigInt(10_000),
        classificationAddressCount: 2,
      }),
    });
    const ownershipPatch = mockPrismaClient.$executeRaw.mock.calls.find(([statement]) => (
      (statement as { strings?: string[] }).strings?.join('').includes(
        'UPDATE "transaction_outputs" AS stored'
      ) && (statement as { values?: unknown[] }).values?.includes(discoveredWalletAddress)
    ));
    expect(ownershipPatch).toBeDefined();
    const ownershipValues = (ownershipPatch?.[0] as { values: unknown[] }).values;
    const ownershipOffset = ownershipValues.indexOf(discoveredWalletAddress) - 2;
    expect(ownershipValues.slice(ownershipOffset, ownershipOffset + 8)).toEqual([
      'gap-repair-row',
      1,
      discoveredWalletAddress,
      BigInt(150_000),
      expect.any(String),
      true,
      true,
      'consolidation',
    ]);
    expect(recalculateWalletBalances).toHaveBeenCalledWith(walletId);
  });

  it('records an addressless-only wallet spend in address sync scalar history', async () => {
    const addressId = 'addr-op-return';
    const walletId = 'wallet-op-return';
    const walletAddress = testnetAddresses.nativeSegwit[0];
    const txid = '9'.repeat(64);
    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address: walletAddress,
      walletId,
      wallet: { id: walletId, network: 'testnet' },
      used: true,
    });
    mockPrismaClient.address.findMany.mockResolvedValue([{ address: walletAddress }]);
    mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: txid, height: 0 }]);
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, {
      txid,
      vin: [{ prevout: { value: 0.001, scriptPubKey: { address: walletAddress } } }],
      vout: [{ value: 0, n: 0, scriptPubKey: { hex: '6a026869' } }],
    }]]));
    mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

    await syncAddress(addressId);

    expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({
          txid,
          type: 'sent',
          amount: BigInt(-100_000),
          fee: BigInt(100_000),
        })],
      })
    );
  });

  it('uses external evidence to classify a zero-delta address sync transaction as sent', async () => {
    const addressId = 'addr-zero-delta-external';
    const walletId = 'wallet-zero-delta-external';
    const walletAddress = testnetAddresses.nativeSegwit[0];
    const externalAddress = testnetAddresses.nativeSegwit[1];
    const txid = '0'.repeat(64);
    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address: walletAddress,
      walletId,
      wallet: { id: walletId, network: 'testnet' },
      used: true,
    });
    mockPrismaClient.address.findMany.mockResolvedValue([{ address: walletAddress }]);
    mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: txid, height: 0 }]);
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, {
      txid,
      vin: [
        { prevout: { value: 0.001, scriptPubKey: { address: walletAddress } } },
        { prevout: { value: 0.002, scriptPubKey: { address: externalAddress } } },
      ],
      vout: [
        { value: 0.001, n: 0, scriptPubKey: { address: walletAddress } },
        { value: 0.0019, n: 1, scriptPubKey: { hex: '6a026869' } },
      ],
    }]]));
    mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

    await syncAddress(addressId);

    expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({
          txid,
          type: 'sent',
          amount: BigInt(0),
          fee: BigInt(10_000),
          classificationInputsComplete: true,
        })],
      })
    );
  });

  it('classifies a zero-delta address sync transaction without external evidence as consolidation', async () => {
    const addressId = 'addr-zero-delta-consolidation';
    const walletId = 'wallet-zero-delta-consolidation';
    const walletAddress = testnetAddresses.nativeSegwit[0];
    const txid = 'f'.repeat(64);
    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address: walletAddress,
      walletId,
      wallet: { id: walletId, network: 'testnet' },
      used: true,
    });
    mockPrismaClient.address.findMany.mockResolvedValue([{ address: walletAddress }]);
    mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: txid, height: 0 }]);
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, {
      txid,
      vin: [{ prevout: { value: 0.001, scriptPubKey: { address: walletAddress } } }],
      vout: [{ value: 0.001, n: 0, scriptPubKey: { address: walletAddress } }],
    }]]));
    mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

    await syncAddress(addressId);

    expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({
          txid,
          type: 'consolidation',
          amount: BigInt(0),
          fee: BigInt(0),
          classificationInputsComplete: true,
        })],
      })
    );
  });

  it('rejects a negative fee from malformed complete address-sync evidence', async () => {
    const addressId = 'addr-negative-fee';
    const walletId = 'wallet-negative-fee';
    const walletAddress = testnetAddresses.nativeSegwit[0];
    const externalAddress = testnetAddresses.nativeSegwit[1];
    const txid = 'e'.repeat(64);
    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address: walletAddress,
      walletId,
      wallet: { id: walletId, network: 'testnet' },
      used: true,
    });
    mockPrismaClient.address.findMany.mockResolvedValue([{ address: walletAddress }]);
    mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: txid, height: 0 }]);
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, {
      txid,
      vin: [{ prevout: { value: 0.001, scriptPubKey: { address: walletAddress } } }],
      vout: [{ value: 0.002, n: 0, scriptPubKey: { address: externalAddress } }],
    }]]));
    mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

    await syncAddress(addressId);

    expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({
          txid,
          type: 'sent',
          amount: BigInt(-100_000),
          fee: null,
          classificationInputsComplete: true,
        })],
      })
    );
  });

  it('repairs all output roles when promoting a received transaction to consolidation', async () => {
    mockPrismaClient.transaction.createMany.mockResolvedValue({ count: 0 });
    mockPrismaClient.$queryRaw.mockResolvedValue([{
      id: 'consolidation-row',
      classificationInputsComplete: true,
      classificationVersion: 1,
    }]);

    const legacyCandidate = {
      txid: '6'.repeat(64),
      walletId: 'wallet-consolidation',
      type: 'consolidation',
      amount: BigInt(-100),
      fee: BigInt(100),
      confirmations: 1,
      rbfStatus: 'confirmed',
      classificationInputsComplete: true,
      classificationVersion: 2,
      classificationAddressCount: 1,
    } satisfies AddressSyncTransactionInput;
    Reflect.deleteProperty(legacyCandidate, 'classificationAddressCount');

    const outcome = await reconcileAddressSyncTransaction(
      legacyCandidate,
      mockPrismaClient as never,
    );

    expect(outcome).toBe('repaired');
    expect(mockPrismaClient.transactionOutput.updateMany).toHaveBeenCalledWith({
      where: {
        transaction: {
          is: { txid: '6'.repeat(64), walletId: 'wallet-consolidation' },
        },
      },
      data: { outputType: 'consolidation' },
    });
  });

  it('returns exact created and repaired outcomes from batch reconciliation', async () => {
    const createdTxid = 'a'.repeat(64);
    const repairedTxid = 'b'.repeat(64);
    mockPrismaClient.transaction.createManyAndReturn.mockResolvedValue([{ txid: createdTxid }]);
    mockPrismaClient.transaction.createMany.mockResolvedValue({ count: 0 });
    mockPrismaClient.$queryRaw.mockResolvedValue([{
      id: 'repaired-row',
      classificationInputsComplete: true,
      classificationVersion: 1,
    }]);

    const results = await reconcileTransactionBatch([
      {
        txid: createdTxid,
        walletId: 'wallet-batch',
        type: 'received',
        amount: BigInt(1),
        confirmations: 0,
        rbfStatus: 'active',
        classificationInputsComplete: true,
        classificationVersion: 2,
        classificationAddressCount: 1,
      },
      {
        txid: repairedTxid,
        walletId: 'wallet-batch',
        type: 'sent',
        amount: BigInt(-2),
        fee: BigInt(1),
        confirmations: 1,
        rbfStatus: 'confirmed',
        classificationInputsComplete: true,
        classificationVersion: 2,
        classificationAddressCount: 1,
      },
    ], mockPrismaClient as never);

    expect(results.map(result => result.outcome)).toEqual(['created', 'repaired']);
  });

  it('blocks insufficient targeted candidates in batch reconciliation', async () => {
    const incomplete = {
      txid: '1'.repeat(64),
      walletId: 'wallet-targeted-batch',
      type: 'received' as const,
      amount: BigInt(1),
      confirmations: 0,
      rbfStatus: 'active' as const,
      classificationInputsComplete: false,
      classificationVersion: 2,
      classificationAddressCount: 2,
    };
    const belowTarget = {
      ...incomplete,
      txid: '2'.repeat(64),
      classificationInputsComplete: true,
      classificationAddressCount: 1,
    };
    mockPrismaClient.$queryRaw
      .mockResolvedValueOnce([{ id: 'target-incomplete', targetAddressCount: 2 }])
      .mockResolvedValueOnce([{ id: 'target-low', targetAddressCount: 2 }]);
    mockPrismaClient.transaction.createManyAndReturn.mockResolvedValue([]);

    const results = await reconcileTransactionBatch([incomplete, belowTarget]);

    expect(results.map(result => result.outcome)).toEqual(['unchanged', 'unchanged']);
    expect(mockPrismaClient.transaction.createManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({ data: [] })
    );
  });

  it('locks duplicate batch keys once and reports their exact created outcome', async () => {
    const transaction = {
      txid: '3'.repeat(64),
      walletId: 'wallet-duplicate-batch',
      type: 'received' as const,
      amount: BigInt(1),
      confirmations: 0,
      rbfStatus: 'active' as const,
      classificationInputsComplete: true,
      classificationVersion: 2,
      classificationAddressCount: 1,
    };
    mockPrismaClient.$queryRaw.mockResolvedValueOnce([]);
    mockPrismaClient.transaction.createManyAndReturn.mockResolvedValue([
      { txid: transaction.txid },
    ]);

    const results = await reconcileTransactionBatch([transaction, transaction]);

    expect(results.map(result => result.outcome)).toEqual(['created', 'created']);
    expect(mockPrismaClient.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('keeps missing, stronger, and authoritative existing batch rows unchanged', async () => {
    const makeCandidate = (txid: string, classificationAddressCount: number) => ({
      txid,
      walletId: 'wallet-existing-batch',
      type: 'received' as const,
      amount: BigInt(1),
      confirmations: 0,
      rbfStatus: 'active' as const,
      classificationInputsComplete: true,
      classificationVersion: 2,
      classificationAddressCount,
    });
    const missing = makeCandidate('4'.repeat(64), 1);
    const downgrade = makeCandidate('5'.repeat(64), 1);
    const authoritative = makeCandidate('6'.repeat(64), 2);
    mockPrismaClient.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'target-authoritative', targetAddressCount: 2 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'stronger-row',
        classificationInputsComplete: false,
        classificationVersion: 1,
        classificationAddressCount: 2,
      }])
      .mockResolvedValueOnce([{
        id: 'authoritative-row',
        classificationInputsComplete: true,
        classificationVersion: 2,
        classificationAddressCount: 2,
      }]);
    mockPrismaClient.transaction.createManyAndReturn.mockResolvedValue([]);

    const results = await reconcileTransactionBatch([missing, downgrade, authoritative]);

    expect(results.map(result => result.outcome)).toEqual([
      'unchanged',
      'unchanged',
      'unchanged',
    ]);
    expect(mockPrismaClient.transactionOwnershipRepair.delete).toHaveBeenCalledWith({
      where: { id: 'target-authoritative' },
    });
  });

  it('does no persistence work for an empty reconciliation batch', async () => {
    await expect(reconcileTransactionBatch([])).resolves.toEqual([]);
    expect(mockPrismaClient.transaction.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('repairs stale same-type scalar data and completeness atomically', async () => {
    const txid = 'c'.repeat(64);
    mockPrismaClient.transaction.createMany.mockResolvedValue({ count: 0 });
    mockPrismaClient.$queryRaw.mockResolvedValue([{
      id: 'same-type-row',
      classificationInputsComplete: false,
      classificationVersion: 1,
    }]);

    const outcome = await reconcileAddressSyncTransaction({
      txid,
      walletId: 'wallet-completeness',
      type: 'received',
      amount: BigInt(1),
      confirmations: 1,
      rbfStatus: 'confirmed',
      classificationInputsComplete: true,
      classificationVersion: 2,
      classificationAddressCount: 1,
    });

    expect(outcome).toBe('repaired');
    expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
      where: { id: 'same-type-row' },
      data: expect.objectContaining({
        type: 'received',
        amount: BigInt(1),
        classificationInputsComplete: true,
        classificationVersion: 2,
      }),
    });
  });

  it('does not overwrite a completed current-version classification', async () => {
    const txid = 'current-classification'.padEnd(64, 'c');
    mockPrismaClient.transaction.createMany.mockResolvedValue({ count: 0 });
    mockPrismaClient.$queryRaw.mockResolvedValue([{
      id: 'current-row',
      classificationInputsComplete: true,
      classificationVersion: 2,
      classificationAddressCount: 1,
    }]);

    await expect(reconcileAddressSyncTransaction({
      txid,
      walletId: 'wallet-current',
      type: 'sent',
      amount: BigInt(-999),
      fee: BigInt(1),
      confirmations: 1,
      rbfStatus: 'confirmed',
      classificationInputsComplete: true,
      classificationVersion: 2,
      classificationAddressCount: 1,
    })).resolves.toBe('unchanged');

    expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
    expect(mockPrismaClient.transactionOutput.updateMany).not.toHaveBeenCalled();
  });

  it('fences and consumes durable ownership targets only with sufficient evidence', async () => {
    const txid = 'ownership-target'.padEnd(64, 'a');
    const baseCandidate = {
      txid,
      walletId: 'wallet-ownership-target',
      type: 'received' as const,
      amount: BigInt(1),
      confirmations: 1,
      rbfStatus: 'confirmed' as const,
      classificationInputsComplete: true,
      classificationVersion: 2,
    };
    const target = { id: 'ownership-target-row', targetAddressCount: 2 };

    mockPrismaClient.$queryRaw.mockResolvedValueOnce([target]);
    await expect(reconcileAddressSyncTransaction({
      ...baseCandidate,
      classificationAddressCount: 1,
    })).resolves.toBe('unchanged');
    expect(mockPrismaClient.transaction.createMany).not.toHaveBeenCalled();

    mockPrismaClient.$queryRaw.mockResolvedValueOnce([target]);
    await expect(reconcileAddressSyncTransaction({
      ...baseCandidate,
      classificationInputsComplete: false,
      classificationAddressCount: 2,
    })).resolves.toBe('unchanged');

    mockPrismaClient.$queryRaw.mockResolvedValueOnce([target]);
    mockPrismaClient.transaction.createMany.mockResolvedValueOnce({ count: 1 });
    await expect(reconcileAddressSyncTransaction({
      ...baseCandidate,
      classificationAddressCount: 2,
    })).resolves.toBe('created');
    expect(mockPrismaClient.transactionOwnershipRepair.delete).toHaveBeenCalledWith({
      where: { id: target.id },
    });

    mockPrismaClient.$queryRaw
      .mockResolvedValueOnce([target])
      .mockResolvedValueOnce([{
        id: 'strong-current-row',
        classificationInputsComplete: true,
        classificationVersion: 2,
        classificationAddressCount: 2,
      }]);
    mockPrismaClient.transaction.createMany.mockResolvedValueOnce({ count: 0 });
    await expect(reconcileAddressSyncTransaction({
      ...baseCandidate,
      classificationAddressCount: 2,
    })).resolves.toBe('unchanged');

    mockPrismaClient.$queryRaw
      .mockResolvedValueOnce([target])
      .mockResolvedValueOnce([{
        id: 'stale-target-row',
        classificationInputsComplete: true,
        classificationVersion: 1,
        classificationAddressCount: 1,
      }]);
    mockPrismaClient.transaction.createMany.mockResolvedValueOnce({ count: 0 });
    await expect(reconcileAddressSyncTransaction({
      ...baseCandidate,
      classificationAddressCount: 2,
    })).resolves.toBe('repaired');
    expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
      where: { id: 'stale-target-row' },
      data: expect.objectContaining({
        classificationAddressCount: 2,
        ioComplete: false,
      }),
    });

    mockPrismaClient.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'larger-address-row',
        classificationInputsComplete: false,
        classificationVersion: 1,
        classificationAddressCount: 3,
      }]);
    mockPrismaClient.transaction.createMany.mockResolvedValueOnce({ count: 0 });
    await expect(reconcileAddressSyncTransaction({
      ...baseCandidate,
      classificationAddressCount: 2,
    })).resolves.toBe('unchanged');
  });

  it('marks selected repair attempts with parameterized SQL without touching updatedAt', async () => {
    const txid = 'd'.repeat(64);
    await markClassificationRepairAttempts('wallet-incomplete-attempt', [txid]);
    const statement = mockPrismaClient.$executeRaw.mock.calls[0][0] as {
      strings: string[];
      values: unknown[];
    };
    expect(statement.strings.join('?')).toContain('SET "classificationLastAttemptAt" = CURRENT_TIMESTAMP');
    expect(statement.strings.join('?')).not.toContain('"updatedAt"');
    expect(statement.values).toEqual(['wallet-incomplete-attempt', txid, 2]);
  });

  it('marks selected I/O attempts without touching public updatedAt', async () => {
    const txid = 'f'.repeat(64);
    await markIoRepairAttempts('wallet-io-attempt', [txid]);
    const statement = mockPrismaClient.$executeRaw.mock.calls[0][0] as {
      strings: string[];
      values: unknown[];
    };
    expect(statement.strings.join('?')).toContain('SET "ioLastAttemptAt" = CURRENT_TIMESTAMP');
    expect(statement.strings.join('?')).not.toContain('"updatedAt"');
    expect(statement.values).toEqual(['wallet-io-attempt', txid]);
  });

  it('reuses the supplied client for ownership and bulk sync writers', async () => {
    await markOwnershipRepairNeeded(
      'wallet-fenced',
      ['a'.repeat(64)],
      3,
      mockPrismaClient as never,
    );
    await batchUpdateTransactionsByIds(
      [{ id: 'tx-fields', data: { confirmations: 2 } }],
      100,
      mockPrismaClient as never,
    );
    await expect(recalculateBalancesAtomically(
      'wallet-fenced',
      mockPrismaClient as never,
    )).resolves.toBe(0);

    expect(mockPrismaClient.$transaction).not.toHaveBeenCalled();
    const fieldPatch = mockPrismaClient.$executeRaw.mock.calls.find(([statement]) => (
      (statement as { strings?: string[] }).strings?.join('').includes('jsonb_to_recordset')
    ));
    expect(fieldPatch).toBeDefined();
    expect((fieldPatch?.[0] as { values: unknown[] }).values).toContain(
      JSON.stringify([{ id: 'tx-fields', data: { confirmations: 2 } }]),
    );
  });

  it('serializes heterogeneous transaction field patches in one client round trip', async () => {
    const blockTime = new Date('2026-08-22T12:34:56.000Z');
    await batchUpdateTransactionsByIds([{
      id: 'tx-fields',
      data: {
        addressId: 'address-1',
        amount: 123n,
        blockHeight: 900_000,
        blockTime,
        confirmations: 2,
        counterpartyAddress: 'counterparty',
        fee: 4n,
        rbfStatus: 'confirmed',
      },
    }], 100, mockPrismaClient as never);

    expect(mockPrismaClient.$executeRaw).toHaveBeenCalledOnce();
    const statement = mockPrismaClient.$executeRaw.mock.calls[0][0] as {
      strings: string[];
      values: unknown[];
    };
    expect(statement.strings.join('')).toContain('jsonb_to_recordset');
    expect(statement.values).toContain(JSON.stringify([{
      id: 'tx-fields',
      data: {
        addressId: 'address-1',
        amount: '123',
        blockHeight: 900_000,
        blockTime: blockTime.toISOString(),
        confirmations: 2,
        counterpartyAddress: 'counterparty',
        fee: '4',
        rbfStatus: 'confirmed',
      },
    }]));
  });

  it('rejects unsupported transaction field patches before querying', async () => {
    await expect(batchUpdateTransactionsByIds([{
      id: 'tx-fields',
      data: { walletId: 'another-wallet' },
    }], 100, mockPrismaClient as never)).rejects.toThrow(
      'Unsupported transaction batch-update field: walletId',
    );
    expect(mockPrismaClient.$executeRaw).not.toHaveBeenCalled();
  });

  it('skips an empty repair-attempt batch and avoids a reconciliation double-touch', async () => {
    await markClassificationRepairAttempts('wallet-incomplete-attempt', []);
    await markOwnershipRepairNeeded('wallet-incomplete-attempt', [], 0);
    expect(mockPrismaClient.$executeRaw).not.toHaveBeenCalled();

    mockPrismaClient.transaction.createMany.mockResolvedValue({ count: 0 });
    await expect(reconcileAddressSyncTransaction({
      txid: 'e'.repeat(64),
      walletId: 'wallet-incomplete-attempt',
      type: 'received',
      amount: BigInt(1),
      confirmations: 1,
      rbfStatus: 'confirmed',
      classificationInputsComplete: false,
      classificationVersion: 2,
      classificationAddressCount: 1,
    })).resolves.toBe('unchanged');
    expect(mockPrismaClient.$executeRaw).toHaveBeenCalledTimes(1);
    const advisoryStatement = mockPrismaClient.$executeRaw.mock.calls[0][0] as {
      strings: string[];
    };
    expect(advisoryStatement.strings.join('')).toContain('pg_advisory_xact_lock');
  });

  it('repairs owned and external output roles when promoting a transaction to sent', async () => {
    mockPrismaClient.transaction.createMany.mockResolvedValue({ count: 0 });
    mockPrismaClient.$queryRaw.mockResolvedValue([{
      id: 'sent-row',
      classificationInputsComplete: true,
      classificationVersion: 1,
    }]);

    const outcome = await reconcileAddressSyncTransaction({
      txid: '7'.repeat(64),
      walletId: 'wallet-sent',
      type: 'sent',
      amount: BigInt(-200),
      fee: BigInt(100),
      confirmations: 1,
      rbfStatus: 'confirmed',
      classificationInputsComplete: true,
      classificationVersion: 2,
      classificationAddressCount: 1,
    });

    expect(outcome).toBe('repaired');
    expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith({
      where: { id: 'sent-row' },
      data: expect.objectContaining({
        type: 'sent',
        rbfStatus: 'confirmed',
        classificationVersion: 2,
      }),
    });
    expect(mockPrismaClient.transactionOutput.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        transaction: {
          is: { txid: '7'.repeat(64), walletId: 'wallet-sent' },
        },
        isOurs: true,
      },
      data: { outputType: 'change' },
    });
    expect(mockPrismaClient.transactionOutput.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        transaction: {
          is: { txid: '7'.repeat(64), walletId: 'wallet-sent' },
        },
        isOurs: false,
      },
      data: { outputType: 'recipient' },
    });
  });

  it('persists an inputs-only I/O repair atomically', async () => {
    await persistAddressSyncIORows([
      {
        transactionId: 'inputs-only',
        inputIndex: 0,
        txid: '8'.repeat(64),
        vout: 0,
        address: 'input-address',
        amount: BigInt(1),
      },
    ], [], [], undefined, mockPrismaClient as never);

    expect(mockPrismaClient.transactionInput.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ transactionId: 'inputs-only' })],
      skipDuplicates: true,
    });
    expect(mockPrismaClient.transactionOutput.createMany).not.toHaveBeenCalled();
    expect(mockPrismaClient.$transaction).not.toHaveBeenCalled();
  });

  it('rejects stale I/O rows after the parent classification horizon advances', async () => {
    mockPrismaClient.transaction.findMany.mockResolvedValueOnce([{
      id: 'stale-io-row',
      txid: 'stale-io-txid',
      type: 'received',
      classificationAddressCount: 2,
    }]);

    await persistAddressSyncIORows(
      [{
        transactionId: 'stale-io-row',
        inputIndex: 0,
        txid: '8'.repeat(64),
        vout: 0,
        address: 'stale-input',
        amount: 1n,
      }],
      [{
        transactionId: 'stale-io-row',
        outputIndex: 0,
        address: 'stale-output',
        amount: 1n,
        isOurs: true,
      }],
      ['stale-io-row'],
      1,
      mockPrismaClient as never,
    );

    expect(mockPrismaClient.transactionInput.createMany).not.toHaveBeenCalled();
    expect(mockPrismaClient.transactionOutput.createMany).not.toHaveBeenCalled();
    expect(mockPrismaClient.$executeRaw.mock.calls.some(([statement]) => (
      (statement as { strings?: string[] }).strings?.join('').includes('SET "ioComplete" = true')
    ))).toBe(false);
  });

  it('bounds address-sync output upserts and SQL binds to 512 rows', async () => {
    expect(ADDRESS_SYNC_IO_UPSERT_MAX_BINDS).toBe(
      ADDRESS_SYNC_IO_UPSERT_MAX_ROWS * ADDRESS_SYNC_OUTPUT_UPSERT_BIND_COLUMNS
    );
    expect(ADDRESS_SYNC_IO_UPSERT_MAX_BINDS).toBeLessThan(65_535);
    const outputs = Array.from(
      { length: ADDRESS_SYNC_IO_UPSERT_MAX_ROWS + 1 },
      (_, outputIndex) => ({
        transactionId: 'output-boundary',
        outputIndex,
        address: `output-${outputIndex}`,
        amount: BigInt(outputIndex),
        isOurs: outputIndex % 2 === 0,
      })
    );

    await persistAddressSyncIORows(
      [],
      outputs,
      [],
      undefined,
      mockPrismaClient as never
    );

    expect(mockPrismaClient.transactionOutput.createMany).toHaveBeenCalledTimes(2);
    expect(mockPrismaClient.transactionOutput.createMany.mock.calls[0][0].data)
      .toHaveLength(ADDRESS_SYNC_IO_UPSERT_MAX_ROWS);
    expect(mockPrismaClient.transactionOutput.createMany.mock.calls[1][0].data)
      .toHaveLength(1);
    const updates = mockPrismaClient.$executeRaw.mock.calls.filter(([statement]) => (
      (statement as { strings?: string[] }).strings?.join('').includes(
        'UPDATE "transaction_outputs" AS stored'
      )
    ));
    expect(updates).toHaveLength(2);
    expect((updates[0][0] as { values: unknown[] }).values)
      .toHaveLength(ADDRESS_SYNC_IO_UPSERT_MAX_BINDS);
    expect((updates[1][0] as { values: unknown[] }).values)
      .toHaveLength(ADDRESS_SYNC_OUTPUT_UPSERT_BIND_COLUMNS);
  });

  it('finds a bounded RBF cleanup page without loading input relations', async () => {
    mockPrismaClient.$queryRaw.mockResolvedValue([{ id: 'pending', txid: 'old', replacementTxid: 'new' }]);
    const assertActive = vi.fn();

    await expect(findWalletRbfReplacements(
      'wallet-rbf', 'active', mockPrismaClient as never, assertActive
    )).resolves.toEqual([{ id: 'pending', txid: 'old', replacementTxid: 'new' }]);

    expect(assertActive).toHaveBeenCalledTimes(2);
    const statement = mockPrismaClient.$queryRaw.mock.calls[0][0] as {
      strings: string[];
      values: unknown[];
    };
    expect(statement.strings.join('')).toContain('LIMIT ');
    expect(statement.strings.join('')).not.toContain('inputs:');
    expect(statement.values).toEqual([
      'wallet-rbf',
      'wallet-rbf',
      ADDRESS_SYNC_IO_UPSERT_MAX_ROWS,
    ]);
  });

  it('stops bounded RBF cleanup selection when cancellation follows its query', async () => {
    mockPrismaClient.$queryRaw.mockResolvedValue([]);
    const cancellation = new Error('RBF cleanup selection expired');
    const assertActive = vi.fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => { throw cancellation; });

    await expect(findWalletRbfReplacements(
      'wallet-rbf', 'unlinked', mockPrismaClient as never, assertActive
    )).rejects.toBe(cancellation);

    expect(mockPrismaClient.$queryRaw).toHaveBeenCalledOnce();
  });

  it('reconciles maximum-input RBF matches database-side in bounded result pages', async () => {
    mockPrismaClient.$queryRaw
      .mockResolvedValueOnce([{ count: ADDRESS_SYNC_IO_UPSERT_MAX_ROWS }])
      .mockResolvedValueOnce([{ count: 1 }]);
    const assertActive = vi.fn();

    await expect(reconcilePendingRbfForConfirmedTransactions(
      'wallet-rbf',
      [{ id: 'confirmed-row', txid: 'confirmed-txid' }],
      mockPrismaClient as never,
      assertActive,
    )).resolves.toBe(ADDRESS_SYNC_IO_UPSERT_MAX_ROWS + 1);

    expect(assertActive).toHaveBeenCalledTimes(4);
    expect(mockPrismaClient.$queryRaw).toHaveBeenCalledTimes(2);
    for (const [statement] of mockPrismaClient.$queryRaw.mock.calls) {
      const sql = (statement as { strings: string[] }).strings.join('');
      expect(sql).toContain('INNER JOIN "transaction_inputs"');
      expect(sql).toContain(`LIMIT `);
      expect(sql).not.toContain(' OR ');
      expect((statement as { values: unknown[] }).values).toEqual([
        'confirmed-row',
        'confirmed-txid',
        'wallet-rbf',
        'wallet-rbf',
        ADDRESS_SYNC_IO_UPSERT_MAX_ROWS,
      ]);
    }
  });

  it('stops database-side RBF reconciliation immediately after cancellation', async () => {
    mockPrismaClient.$queryRaw.mockResolvedValueOnce([{
      count: ADDRESS_SYNC_IO_UPSERT_MAX_ROWS,
    }]);
    const cancellation = new Error('RBF reconciliation expired');
    const assertActive = vi.fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => { throw cancellation; });

    await expect(reconcilePendingRbfForConfirmedTransactions(
      'wallet-rbf',
      [{ id: 'confirmed-row', txid: 'confirmed-txid' }],
      mockPrismaClient as never,
      assertActive,
    )).rejects.toBe(cancellation);

    expect(mockPrismaClient.$queryRaw).toHaveBeenCalledOnce();
  });

  it('returns without querying when no confirmed RBF transactions are supplied', async () => {
    await expect(reconcilePendingRbfForConfirmedTransactions(
      'wallet-rbf',
      [],
    )).resolves.toBe(0);

    expect(mockPrismaClient.$queryRaw).not.toHaveBeenCalled();
  });

  it('uses the default repository client and activity guard for RBF queries', async () => {
    mockPrismaClient.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await expect(reconcilePendingRbfForConfirmedTransactions(
      'wallet-rbf',
      [{ id: 'confirmed-row', txid: 'confirmed-txid' }],
    )).resolves.toBe(0);
    await expect(findWalletRbfReplacements(
      'wallet-rbf',
      'active',
    )).resolves.toEqual([]);

    expect(mockPrismaClient.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('revalidates active and unlinked RBF cleanup targets with exact outcomes', async () => {
    mockPrismaClient.$queryRaw
      .mockResolvedValueOnce([{ id: 'active-row' }])
      .mockResolvedValueOnce([]);

    await expect(reconcileWalletRbfReplacement(
      'wallet-rbf',
      'active-row',
      'replacement-txid',
      'active',
    )).resolves.toBe(true);
    await expect(reconcileWalletRbfReplacement(
      'wallet-rbf',
      'unlinked-row',
      'replacement-txid',
      'unlinked',
    )).resolves.toBe(false);

    const [activeStatement] = mockPrismaClient.$queryRaw.mock.calls[0] as [{ strings: string[] }];
    const [unlinkedStatement] = mockPrismaClient.$queryRaw.mock.calls[1] as [{ strings: string[] }];
    expect(activeStatement.strings.join('')).toContain('"rbfStatus" = \'replaced\'');
    expect(unlinkedStatement.strings.join('')).toContain('"replacedByTxid" IS NULL');
  });

  it('completes coinbase/no-input I/O atomically without changing updatedAt', async () => {
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      { id: 'coinbase-row', txid: 'a'.repeat(64), type: 'received' },
    ]);

    await persistAddressSyncIORows([], [], ['coinbase-row']);

    const statement = mockPrismaClient.$executeRaw.mock.calls[0][0] as {
      strings: string[];
      values: unknown[];
    };
    expect(statement.strings.join('?')).toContain('SET "ioComplete" = true');
    expect(statement.strings.join('?')).not.toContain('"updatedAt"');
    expect(statement.values).toEqual(['coinbase-row']);
  });

  it('skips the I/O transaction when there are no rows to persist', async () => {
    await persistAddressSyncIORows([], []);

    expect(mockPrismaClient.$transaction).not.toHaveBeenCalled();
  });

  it('bounds incomplete-I/O lookups to 100 history txids per batch', async () => {
    const history = Array.from({ length: 101 }, (_, index) => ({
      tx_hash: index.toString(16).padStart(64, '0'),
      height: index,
    }));
    mockPrismaClient.transaction.findMany.mockResolvedValue([]);

    await storeTransactionIO(
      transactionIoClient,
      'wallet-batched-io',
      history,
      new Set()
    );

    expect(mockPrismaClient.transaction.findMany).toHaveBeenCalledTimes(2);
    expect(mockPrismaClient.transaction.findMany.mock.calls[0][0].where.txid.in).toHaveLength(100);
    expect(mockPrismaClient.transaction.findMany.mock.calls[0][0].where.ioComplete).toBe(false);
    expect(mockPrismaClient.transaction.findMany.mock.calls[1][0].where.txid.in).toHaveLength(1);
    expect(mockElectrumClient.getTransactionsBatch).not.toHaveBeenCalled();
  });

  it('marks a live coinbase/no-input backfill complete and stops relation-based retries', async () => {
    const txid = 'b'.repeat(64);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      { id: 'coinbase-live-row', txid, type: 'received' },
    ]);
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, {
      txid,
      vin: [{ coinbase: 'block-reward' }],
      vout: [{ value: 1, n: 0, scriptPubKey: { hex: '6a' } }],
    }]]));

    await storeTransactionIO(
      transactionIoClient,
      'wallet-live-coinbase',
      [{ tx_hash: txid, height: 1 }],
      new Set()
    );

    expect(mockPrismaClient.transaction.findMany.mock.calls[0][0].where).toEqual({
      walletId: 'wallet-live-coinbase',
      txid: { in: [txid] },
      ioComplete: false,
    });
    const completion = mockPrismaClient.$executeRaw.mock.calls[0][0] as { strings: string[] };
    expect(completion.strings.join('')).toContain('SET "ioComplete" = true');
  });

  it('keeps a live unresolved-input backfill incomplete', async () => {
    const txid = 'c'.repeat(64);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      { id: 'partial-live-row', txid, type: 'received' },
    ]);
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, {
      txid,
      vin: [{ txid: 'd'.repeat(64) }],
      vout: [{ value: 1, n: 0, scriptPubKey: { address: 'wallet-output' } }],
    }]]));

    await storeTransactionIO(
      transactionIoClient,
      'wallet-live-partial',
      [{ tx_hash: txid, height: 1 }],
      new Set(['wallet-output'])
    );

    expect(mockPrismaClient.transactionOutput.createMany).toHaveBeenCalled();
    expect(mockPrismaClient.$executeRaw.mock.calls.some(([statement]) => (
      (statement as { strings?: string[] }).strings?.join('').includes(
        'SET "ioComplete" = true'
      )
    ))).toBe(false);
  });

  it.each([
    {
      name: 'resolves a live txid/vout-only input from its previous transaction',
      prevout: undefined,
      expectedAmount: BigInt(100000000),
    },
    {
      name: 'falls through from an addressless inline script to its previous transaction',
      prevout: { value: 0.1, scriptPubKey: { hex: '0014-addressless' } },
      expectedAmount: BigInt(10000000),
    },
  ])('$name and completes the backfill', async ({ prevout, expectedAmount }) => {
    const txid = 'e'.repeat(64);
    const previousTxid = 'f'.repeat(64);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      { id: 'resolved-live-row', txid, type: 'sent' },
    ]);
    mockElectrumClient.getTransactionsBatch
      .mockResolvedValueOnce(new Map([[txid, {
        txid,
        vin: [{ txid: previousTxid, vout: 1, ...(prevout ? { prevout } : {}) }],
        vout: [{ value: 0.9, n: 0, scriptPubKey: { address: 'recipient-output' } }],
      }]]))
      .mockResolvedValueOnce(new Map([[previousTxid, {
        txid: previousTxid,
        vin: [],
        vout: [
          { value: 0.25, n: 0, scriptPubKey: { address: 'unrelated-output' } },
          { value: 1, n: 1, scriptPubKey: { address: 'wallet-input' } },
        ],
      }]]));

    await storeTransactionIO(
      transactionIoClient,
      'wallet-live-resolved',
      [{ tx_hash: txid, height: 1 }],
      new Set(['wallet-input'])
    );

    expect(mockElectrumClient.getTransactionsBatch).toHaveBeenNthCalledWith(
      2,
      [previousTxid],
      true
    );
    expect(mockPrismaClient.transactionInput.createMany).toHaveBeenCalledWith({
      data: [{
        transactionId: 'resolved-live-row',
        inputIndex: 0,
        txid: previousTxid,
        vout: 1,
        address: 'wallet-input',
        amount: expectedAmount,
      }],
      skipDuplicates: true,
    });
    const completion = mockPrismaClient.$executeRaw.mock.calls.find(([statement]) => (
      (statement as { strings?: string[] }).strings?.join('').includes(
        'SET "ioComplete" = true'
      )
    ))?.[0] as { strings: string[] };
    expect(completion.strings.join('')).toContain('SET "ioComplete" = true');
  });

  it('reuses address-sync previous-output evidence without refetching it', async () => {
    const txid = '1'.repeat(64);
    const previousTxid = '2'.repeat(64);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      { id: 'cached-live-row', txid, type: 'sent' },
    ]);
    const existingDetails = new Map([
      [txid, {
        txid,
        vin: [{ txid: previousTxid, vout: 0, sequence: 0xffffffff }],
        vout: [],
      }],
      [previousTxid, {
        txid: previousTxid,
        vin: [],
        vout: [{
          value: 0.5,
          n: 0,
          scriptPubKey: {
            hex: '0014' + '11'.repeat(20),
            address: 'cached-wallet-input',
            addresses: ['cached-wallet-input'],
          },
        }],
      }],
    ]);

    await storeTransactionIO(
      transactionIoClient,
      'wallet-live-cached',
      [{ tx_hash: txid, height: 1 }],
      new Set(['cached-wallet-input']),
      existingDetails
    );

    expect(mockElectrumClient.getTransactionsBatch).not.toHaveBeenCalled();
    expect(mockPrismaClient.transactionInput.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        transactionId: 'cached-live-row',
        txid: previousTxid,
        address: 'cached-wallet-input',
        amount: BigInt(50000000),
      })],
      skipDuplicates: true,
    });
    expect(mockPrismaClient.$executeRaw).toHaveBeenCalledTimes(2);
    expect(mockPrismaClient.$executeRaw.mock.calls.some(([statement]) => (
      (statement as { strings?: string[] }).strings?.join('').includes(
        'SET "ioComplete" = true'
      )
    ))).toBe(true);
  });

  it('skips history rows whose authenticated details are absent or unrelated', async () => {
    const missingTxid = '3'.repeat(64);
    const unrelatedTxid = '4'.repeat(64);
    const count = await processHistoryTransactions({
      history: [
        { tx_hash: missingTxid, height: 1 },
        { tx_hash: unrelatedTxid, height: 1 },
      ],
      txDetailsMap: new Map([[unrelatedTxid, {
        vin: [],
        vout: [{ value: 1, n: 0, scriptPubKey: { address: 'external-only' } }],
      }]]) as any,
      addressRecord: { id: 'address-history-skip', walletId: 'wallet-history-skip', address: 'wallet-address' },
      walletAddressSet: new Set(['wallet-address']),
      network: 'testnet3',
      getConfirmations: vi.fn().mockResolvedValue(1),
    });

    expect(count).toBe(0);
    expect(mockPrismaClient.transaction.createMany).not.toHaveBeenCalled();
  });

  it('handles empty transaction collections without inventing a classification', async () => {
    const txid = '8'.repeat(64);
    const count = await processHistoryTransactions({
      history: [{ tx_hash: txid, height: 0 }],
      txDetailsMap: new Map([[txid, {}]]),
      addressRecord: { id: 'address-empty-details', walletId: 'wallet-empty-details', address: 'wallet-address' },
      walletAddressSet: new Set(['wallet-address']),
      network: 'testnet3',
      getConfirmations: vi.fn().mockResolvedValue(0),
    });

    expect(count).toBe(0);
  });

  it('keeps received classification when an input cannot reference a previous output', async () => {
    const txid = 'b'.repeat(64);
    const walletAddress = 'wallet-unreferenced-input';
    const count = await processHistoryTransactions({
      history: [{ tx_hash: txid, height: 0 }],
      txDetailsMap: new Map([[txid, {
        vin: [{ txid: '', sequence: 0xffffffff }],
        vout: [{ value: 0.0001, n: 0, scriptPubKey: { address: walletAddress } }],
      }]]) as any,
      addressRecord: { id: 'address-unreferenced-input', walletId: 'wallet-unreferenced-input', address: walletAddress },
      walletAddressSet: new Set([walletAddress]),
      network: 'testnet3',
      getConfirmations: vi.fn().mockResolvedValue(0),
    });

    expect(count).toBe(1);
    expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ type: 'received', classificationInputsComplete: false })],
      })
    );
  });

  it('classifies incomplete wallet input evidence as consolidation and deduplicates history rows', async () => {
    const txid = '9'.repeat(64);
    const walletAddress = 'wallet-consolidation-address';
    const getConfirmations = vi.fn().mockResolvedValue(1);
    const count = await processHistoryTransactions({
      history: [
        { tx_hash: txid, height: 1 },
        { tx_hash: txid, height: 1 },
      ],
      txDetailsMap: new Map([[txid, {
        time: 1_700_000_000,
        vin: [
          { coinbase: 'ignored', sequence: 0xffffffff },
          {
            txid: 'a'.repeat(64),
            vout: 0,
            sequence: 0xffffffff,
            prevout: { scriptPubKey: { address: walletAddress } },
          },
        ],
        vout: [{ value: 0.0009, n: 0, scriptPubKey: { address: walletAddress } }],
      }]]) as any,
      addressRecord: { id: 'address-incomplete-consolidation', walletId: 'wallet-incomplete-consolidation', address: walletAddress },
      walletAddressSet: new Set([walletAddress]),
      network: 'testnet3',
      getConfirmations,
    });

    expect(count).toBe(1);
    expect(getConfirmations).toHaveBeenCalledOnce();
    expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({
          txid,
          type: 'consolidation',
          amount: BigInt(0),
          fee: null,
          blockTime: new Date(1_700_000_000_000),
        })],
      })
    );
  });

  it('covers canonical I/O defaults, zero outputs, and satoshi-denominated inline inputs', async () => {
    const txid = '5'.repeat(64);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      { id: 'io-default-row', txid, type: 'sent' },
    ]);
    const existingDetails = new Map([[txid, {
      vin: [{
        txid: '6'.repeat(64),
        vout: 0,
        sequence: 0xffffffff,
        prevout: {
          value: 1_000_000,
          scriptPubKey: { address: 'wallet-input' },
        },
      }],
      vout: [{ value: 0, n: 0, scriptPubKey: { address: 'wallet-output' } }],
    }]]);

    await storeTransactionIO(
      transactionIoClient,
      'wallet-io-defaults',
      [{ tx_hash: txid, height: 1 }],
      new Set(['wallet-input', 'wallet-output']),
      existingDetails as any,
    );

    expect(mockPrismaClient.transactionInput.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ amount: BigInt(1_000_000) })],
      skipDuplicates: true,
    });
    expect(mockPrismaClient.transactionOutput.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ amount: BigInt(0) })],
      skipDuplicates: true,
    });
  });

  it('treats absent vin and vout collections as a complete empty I/O set', async () => {
    const txid = '7'.repeat(64);
    mockPrismaClient.transaction.findMany.mockResolvedValue([
      { id: 'io-empty-default-row', txid, type: 'received' },
    ]);

    await storeTransactionIO(
      transactionIoClient,
      'wallet-io-empty-defaults',
      [{ tx_hash: txid, height: 1 }],
      new Set(),
      new Map([[txid, {}]]),
    );

    expect(mockPrismaClient.transactionInput.createMany).not.toHaveBeenCalled();
    expect(mockPrismaClient.transactionOutput.createMany).not.toHaveBeenCalled();
    expect(mockPrismaClient.$executeRaw).toHaveBeenCalledOnce();
  });

  it('rethrows syncAddress errors after logging', async () => {
    const addressId = 'addr-sync-error';
    const walletId = 'wallet-sync-error';
    const mainAddress = testnetAddresses.nativeSegwit[0];

    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address: mainAddress,
      walletId,
      wallet: { id: walletId, network: 'testnet' },
      used: false,
    });
    mockElectrumClient.getAddressHistory.mockRejectedValue(new Error('history fetch failed'));

    await expect(syncAddress(addressId)).rejects.toThrow('history fetch failed');
  });

  it('rejects an unknown address before attempting network access', async () => {
    mockPrismaClient.address.findUnique.mockResolvedValue(null);

    await expect(syncAddress('missing-address')).rejects.toThrow('Address not found');
    expect(mockElectrumClient.getAddressHistory).not.toHaveBeenCalled();
  });

  it('fails closed when the address being synced disappears from the canonical wallet inventory', async () => {
    const addressId = 'addr-inventory-drift';
    const walletId = 'wallet-inventory-drift';
    const triggeringAddress = testnetAddresses.nativeSegwit[0];
    const remainingAddress = testnetAddresses.nativeSegwit[1];

    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address: triggeringAddress,
      walletId,
      wallet: { id: walletId, network: 'testnet' },
      used: false,
    });
    mockPrismaClient.address.findMany.mockResolvedValue([{ address: remainingAddress }]);
    mockElectrumClient.getAddressHistory.mockResolvedValue([]);

    await expect(syncAddress(addressId)).rejects.toThrow(
      'Canonical wallet address inventory changed during sync'
    );
    expect(mockElectrumClient.getTransactionsBatch).not.toHaveBeenCalled();
    expect(mockPrismaClient.uTXO.createMany).not.toHaveBeenCalled();
  });

  it('fails before network access when the canonical address has no script evidence', async () => {
    const addressId = 'addr-missing-script';
    const walletId = 'wallet-missing-script';

    vi.mocked(assertCanonicalAddressesMatchWallet).mockImplementationOnce(() => undefined);
    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address: testnetAddresses.nativeSegwit[0],
      walletId,
      wallet: { id: walletId, network: 'testnet' },
      used: false,
      scriptPubKey: null,
    });

    await expect(syncAddress(addressId)).rejects.toThrow(
      'Canonical address script evidence is missing'
    );
    expect(mockElectrumClient.getAddressHistory).not.toHaveBeenCalled();
    expect(mockPrismaClient.address.findMany).not.toHaveBeenCalled();
  });

  it('uses mainnet when confirmation calculation omits an explicit network', async () => {
    mockElectrumClient.getBlockHeight.mockResolvedValueOnce(105);

    await expect(getConfirmations(100)).resolves.toBe(6);
  });

  it('falls back to mainnet when a legacy wallet has no stored network', async () => {
    const addressId = 'addr-legacy-network';
    const walletId = 'wallet-legacy-network';
    const address = testnetAddresses.nativeSegwit[0];

    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address,
      walletId,
      wallet: { id: walletId, network: '' },
      used: true,
    });
    mockPrismaClient.address.findMany.mockResolvedValue([{ address }]);
    mockElectrumClient.getAddressHistory.mockResolvedValue([]);
    mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);

    await expect(syncAddress(addressId)).resolves.toEqual({ transactions: 0, utxos: 0 });
    expect(getNodeClient).toHaveBeenCalledWith('mainnet');
  });

  it('fails closed when a requested history transaction is missing', async () => {
    const addressId = 'addr-missing-history-evidence';
    const walletId = 'wallet-missing-history-evidence';
    const address = testnetAddresses.nativeSegwit[0];
    const txid = 'f'.repeat(64);

    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address,
      walletId,
      wallet: { id: walletId, network: 'testnet' },
      used: false,
    });
    mockPrismaClient.address.findMany.mockResolvedValue([{ address }]);
    mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: txid, height: 100 }]);
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map());
    mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);

    await expect(syncAddress(addressId)).rejects.toMatchObject({
      name: 'ReceiveEvidenceRetryableError',
    });
    expect(mockPrismaClient.transaction.createMany).not.toHaveBeenCalled();
    expect(mockPrismaClient.uTXO.createMany).not.toHaveBeenCalled();
  });

  it.each([
    ['typed raw-evidence', new RawTransactionEvidenceError('script_mismatch'), '1'],
    ['unexpected parser', new Error('malformed transaction candidate'), '2'],
  ])('fails closed on a %s history failure', async (_label, evidenceError, txidCharacter) => {
    const addressId = 'addr-history-authentication-failure';
    const walletId = 'wallet-history-authentication-failure';
    const address = testnetAddresses.nativeSegwit[0];
    const txid = txidCharacter.repeat(64);

    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address,
      walletId,
      wallet: { id: walletId, network: 'testnet' },
      used: false,
    });
    mockPrismaClient.address.findMany.mockResolvedValue([{ address }]);
    mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: txid, height: 100 }]);
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, { txid }]]));
    mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);
    vi.mocked(authenticateTransactionDetails).mockImplementationOnce(() => {
      throw evidenceError;
    });

    await expect(syncAddress(addressId)).rejects.toMatchObject({
      name: 'ReceiveEvidenceRetryableError',
    });
    expect(mockPrismaClient.transaction.createMany).not.toHaveBeenCalled();
    expect(mockPrismaClient.uTXO.createMany).not.toHaveBeenCalled();
  });

  it('treats an absent authenticated input collection as having no previous transactions', async () => {
    const addressId = 'addr-absent-vin';
    const walletId = 'wallet-absent-vin';
    const address = testnetAddresses.nativeSegwit[0];
    const txid = 'a'.repeat(64);
    const bitcoin = require('bitcoinjs-lib');
    const scriptPubKey = Buffer.from(
      bitcoin.address.toOutputScript(address, bitcoin.networks.testnet),
    ).toString('hex');

    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address,
      walletId,
      wallet: { id: walletId, network: 'testnet' },
      used: true,
    });
    mockPrismaClient.address.findMany.mockResolvedValue([{ address }]);
    mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: txid, height: 0 }]);
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, { txid }]]));
    mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
    vi.mocked(authenticateTransactionDetails).mockReturnValueOnce({
      txid,
      hex: txid,
      vin: undefined,
      vout: [{ value: 0.0001, n: 0, scriptPubKey: { hex: scriptPubKey, address } }],
    } as any);

    await expect(syncAddress(addressId)).resolves.toEqual({ transactions: 1, utxos: 0 });
    expect(mockElectrumClient.getTransactionsBatch).toHaveBeenCalledOnce();
  });

  it('fails closed when raw UTXO authentication throws an unexpected error', async () => {
    const addressId = 'addr-invalid-utxo-shape';
    const walletId = 'wallet-invalid-utxo-shape';
    const address = testnetAddresses.nativeSegwit[0];
    const txid = 'b'.repeat(64);

    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address,
      walletId,
      wallet: { id: walletId, network: 'testnet' },
      used: false,
    });
    mockPrismaClient.address.findMany.mockResolvedValue([{ address }]);
    mockElectrumClient.getAddressHistory.mockResolvedValue([]);
    mockElectrumClient.getAddressUTXOs.mockResolvedValue([
      { tx_hash: txid, tx_pos: 0, value: 10_000, height: 0 },
    ]);
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, {
      txid,
      hex: txid,
      vin: [],
      vout: [{ value: 0.0001, n: 0, scriptPubKey: { address } }],
    }]]));
    vi.mocked(authenticateRawTransactionOutput).mockImplementationOnce(() => {
      throw new Error('unexpected raw transaction shape');
    });

    await expect(syncAddress(addressId)).rejects.toMatchObject({
      name: 'ReceiveEvidenceRetryableError',
    });
    expect(mockPrismaClient.uTXO.findMany).not.toHaveBeenCalled();
    expect(mockPrismaClient.uTXO.createMany).not.toHaveBeenCalled();
    expect(mockPrismaClient.address.update).not.toHaveBeenCalled();
  });

  it('deduplicates authenticated UTXOs and preserves confirmed and mempool metadata', async () => {
    const addressId = 'addr-authenticated-utxos';
    const walletId = 'wallet-authenticated-utxos';
    const address = testnetAddresses.nativeSegwit[0];
    const existingTxid = 'c'.repeat(64);
    const confirmedTxid = 'd'.repeat(64);
    const mempoolTxid = 'e'.repeat(64);
    const utxos = [
      { tx_hash: existingTxid, tx_pos: 0, value: 11_000, height: 95 },
      { tx_hash: confirmedTxid, tx_pos: 1, value: 12_000, height: 100 },
      { tx_hash: mempoolTxid, tx_pos: 0, value: 13_000, height: 0 },
    ];

    mockPrismaClient.address.findUnique.mockResolvedValue({
      id: addressId,
      address,
      walletId,
      wallet: { id: walletId, network: 'testnet' },
      used: true,
    });
    mockPrismaClient.address.findMany.mockResolvedValue([{ address }]);
    mockElectrumClient.getAddressHistory.mockResolvedValue([]);
    mockElectrumClient.getAddressUTXOs.mockResolvedValue(utxos);
    mockElectrumClient.getBlockHeight.mockResolvedValue(105);
    mockPrismaClient.uTXO.findMany.mockResolvedValue([{ txid: existingTxid, vout: 0 }]);
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map(utxos.map(utxo => [
      utxo.tx_hash,
      {
        txid: utxo.tx_hash,
        hex: utxo.tx_hash,
        vin: [],
        vout: Array.from({ length: utxo.tx_pos + 1 }, (_, n) => ({
          value: n === utxo.tx_pos ? utxo.value / 100_000_000 : 0,
          n,
          scriptPubKey: { address },
        })),
      },
    ])));

    await expect(syncAddress(addressId)).resolves.toEqual({ transactions: 0, utxos: 2 });
    expect(mockPrismaClient.uTXO.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          txid: confirmedTxid,
          vout: 1,
          amount: BigInt(12_000),
          confirmations: 6,
          blockHeight: 100,
        }),
        expect.objectContaining({
          txid: mempoolTxid,
          vout: 0,
          amount: BigInt(13_000),
          confirmations: 0,
          blockHeight: null,
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('returns validation failure from checkAddress without hitting the network', async () => {
    vi.mocked(validateAddress).mockReturnValueOnce({
      valid: false,
      error: 'Invalid address format',
    });

    const result = await checkAddress('bad-address', 'testnet3');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid address');
    expect(mockElectrumClient.getAddressBalance).not.toHaveBeenCalled();
  });
});
