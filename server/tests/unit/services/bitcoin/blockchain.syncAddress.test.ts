import { vi } from 'vitest';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { mockElectrumClient, resetElectrumMocks } from '../../../mocks/electrum';
import { testnetAddresses } from '../../../fixtures/bitcoin';

vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

vi.mock('../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn().mockResolvedValue(mockElectrumClient),
}));

vi.mock('../../../../src/services/bitcoin/utils', () => ({
  validateAddress: vi.fn().mockReturnValue({ valid: true }),
  parseTransaction: vi.fn(),
  getNetwork: vi.fn().mockReturnValue(require('bitcoinjs-lib').networks.testnet),
}));

vi.mock('../../../../src/websocket/notifications', () => ({
  walletLog: vi.fn(),
}));

import { syncAddress, checkAddress } from '../../../../src/services/bitcoin/blockchain';
import {
  persistAddressSyncIORows,
  markClassificationRepairAttempts,
  markIoRepairAttempts,
  reconcileAddressSyncTransaction,
  reconcileTransactionBatch,
} from '../../../../src/repositories/transactions/sync';
import { storeTransactionIO } from '../../../../src/services/bitcoin/blockchain/transactionIO';
import { validateAddress } from '../../../../src/services/bitcoin/utils';

describe('Blockchain syncAddress branch coverage', () => {
  beforeEach(() => {
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

    const result = await syncAddress(addressId);

    expect(result.transactions).toBe(1);
    expect(result.utxos).toBe(2);
    expect(mockPrismaClient.transaction.createMany).toHaveBeenCalled();
    const txMainCreates = mockPrismaClient.transaction.createMany.mock.calls
      .filter(([call]) => call.data[0].txid === txMain);
    expect(txMainCreates).toHaveLength(1);
    expect(txMainCreates[0][0].data[0].type).toBe('consolidation');
    expect(mockPrismaClient.uTXO.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ txid: txMain, vout: 1 }),
          expect.objectContaining({ txid: utxoOnlyTx, vout: 0 }),
        ]),
      })
    );
    expect(mockPrismaClient.transactionInput.createMany).toHaveBeenCalled();
    expect(mockPrismaClient.transactionOutput.createMany).toHaveBeenCalled();
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
      return new Map(txids.map(txid => {
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

  it('swallows I/O persistence errors and still returns sync result', async () => {
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

    const result = await syncAddress(addressId);

    expect(result.transactions).toBe(1);
    expect(result.utxos).toBe(0);
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

    const result = await syncAddress(addressId);

    expect(result.transactions).toBe(1);
    expect(result.utxos).toBe(1);
    expect(mockPrismaClient.transactionInput.createMany).not.toHaveBeenCalled();
    expect(mockPrismaClient.transactionOutput.createMany).not.toHaveBeenCalled();
    expect(mockPrismaClient.uTXO.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            txid: zeroHeightUtxoTx,
            confirmations: 0,
            blockHeight: null,
          }),
        ]),
      })
    );
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
    expect(mockPrismaClient.transactionInput.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            transactionId: 'sent-io',
            txid: prevInputTx,
            amount: BigInt(0),
          }),
        ]),
      })
    );
    expect(mockPrismaClient.transactionOutput.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ transactionId: 'recv-io', outputType: 'unknown' }),
          expect.objectContaining({ transactionId: 'cons-io', outputType: 'consolidation' }),
        ]),
      })
    );
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

    const result = await syncAddress(addressId);

    expect(result.transactions).toBe(2);
    const sentTxCreates = mockPrismaClient.transaction.createMany.mock.calls
      .filter(([call]) => call.data[0].txid === sentTx);
    expect(sentTxCreates).toHaveLength(1);
    expect(sentTxCreates[0][0].data[0].type).toBe('sent');
    expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({
          txid: receivedTx,
          type: 'received',
          confirmations: 0,
          blockHeight: null,
        })],
      })
    );
    expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({
          txid: sentTx,
          type: 'sent',
          confirmations: 0,
          blockHeight: null,
        })],
      })
    );
    expect(mockPrismaClient.transactionOutput.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            transactionId: 'io-cons',
            outputType: 'consolidation',
          }),
          expect.objectContaining({
            transactionId: 'io-unknown',
            outputType: 'unknown',
          }),
        ]),
      })
    );
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

  it('repairs all output roles when promoting a received transaction to consolidation', async () => {
    mockPrismaClient.transaction.createMany.mockResolvedValue({ count: 0 });
    mockPrismaClient.transaction.updateMany.mockResolvedValue({ count: 1 });

    const outcome = await reconcileAddressSyncTransaction({
      txid: '6'.repeat(64),
      walletId: 'wallet-consolidation',
      type: 'consolidation',
      amount: BigInt(-100),
      fee: BigInt(100),
      confirmations: 1,
      rbfStatus: 'confirmed',
    });

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
    mockPrismaClient.transaction.updateMany.mockResolvedValue({ count: 1 });

    const results = await reconcileTransactionBatch([
      {
        txid: createdTxid,
        walletId: 'wallet-batch',
        type: 'received',
        amount: BigInt(1),
        confirmations: 0,
        rbfStatus: 'active',
      },
      {
        txid: repairedTxid,
        walletId: 'wallet-batch',
        type: 'sent',
        amount: BigInt(-2),
        fee: BigInt(1),
        confirmations: 1,
        rbfStatus: 'confirmed',
      },
    ]);

    expect(results.map(result => result.outcome)).toEqual(['created', 'repaired']);
  });

  it('does no persistence work for an empty reconciliation batch', async () => {
    await expect(reconcileTransactionBatch([])).resolves.toEqual([]);
    expect(mockPrismaClient.transaction.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('persists completeness monotonically for a same-type reconciliation', async () => {
    const txid = 'c'.repeat(64);
    mockPrismaClient.transaction.createMany.mockResolvedValue({ count: 0 });
    mockPrismaClient.transaction.updateMany.mockResolvedValueOnce({ count: 1 });

    const outcome = await reconcileAddressSyncTransaction({
      txid,
      walletId: 'wallet-completeness',
      type: 'received',
      amount: BigInt(1),
      confirmations: 1,
      rbfStatus: 'confirmed',
      classificationInputsComplete: true,
    });

    expect(outcome).toBe('unchanged');
    expect(mockPrismaClient.transaction.updateMany).toHaveBeenCalledWith({
      where: {
        txid,
        walletId: 'wallet-completeness',
        classificationInputsComplete: false,
      },
      data: { classificationInputsComplete: true },
    });
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
    expect(statement.values).toEqual(['wallet-incomplete-attempt', txid]);
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

  it('skips an empty repair-attempt batch and avoids a reconciliation double-touch', async () => {
    await markClassificationRepairAttempts('wallet-incomplete-attempt', []);
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
    })).resolves.toBe('unchanged');
    expect(mockPrismaClient.$executeRaw).not.toHaveBeenCalled();
  });

  it('repairs owned and external output roles when promoting a transaction to sent', async () => {
    mockPrismaClient.transaction.createMany.mockResolvedValue({ count: 0 });
    mockPrismaClient.transaction.updateMany.mockResolvedValue({ count: 1 });

    const outcome = await reconcileAddressSyncTransaction({
      txid: '7'.repeat(64),
      walletId: 'wallet-sent',
      type: 'sent',
      amount: BigInt(-200),
      fee: BigInt(100),
      confirmations: 1,
      rbfStatus: 'confirmed',
    });

    expect(outcome).toBe('repaired');
    expect(mockPrismaClient.transaction.updateMany).toHaveBeenCalledWith({
      where: {
        txid: '7'.repeat(64),
        walletId: 'wallet-sent',
        type: { in: ['received', 'consolidation'] },
      },
      data: expect.objectContaining({ rbfStatus: 'confirmed' }),
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
    ], []);

    expect(mockPrismaClient.transactionInput.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ transactionId: 'inputs-only' })],
      skipDuplicates: true,
    });
    expect(mockPrismaClient.transactionOutput.createMany).not.toHaveBeenCalled();
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
      mockElectrumClient,
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
      mockElectrumClient,
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
      mockElectrumClient,
      'wallet-live-partial',
      [{ tx_hash: txid, height: 1 }],
      new Set(['wallet-output'])
    );

    expect(mockPrismaClient.transactionOutput.createMany).toHaveBeenCalled();
    expect(mockPrismaClient.$executeRaw).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'resolves a live txid/vout-only input from its previous transaction',
      prevout: undefined,
    },
    {
      name: 'falls through from an addressless inline script to its previous transaction',
      prevout: { value: 0.1, scriptPubKey: { hex: '0014-addressless' } },
    },
  ])('$name and completes the backfill', async ({ prevout }) => {
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
      mockElectrumClient,
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
        amount: BigInt(100000000),
      }],
      skipDuplicates: true,
    });
    const completion = mockPrismaClient.$executeRaw.mock.calls[0][0] as { strings: string[] };
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
        vin: [{ txid: previousTxid, vout: 0 }],
        vout: [],
      }],
      [previousTxid, {
        txid: previousTxid,
        vin: [],
        vout: [{ value: 0.5, n: 0, scriptPubKey: { address: 'cached-wallet-input' } }],
      }],
    ]);

    await storeTransactionIO(
      mockElectrumClient,
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
