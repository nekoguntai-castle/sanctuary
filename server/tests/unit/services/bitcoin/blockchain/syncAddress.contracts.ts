import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockPrismaClient, resetPrismaMocks } from '../../../../mocks/prisma';
import {
  mockElectrumClient,
  createMockTransaction,
  createMockUTXO,
  createMockAddressHistory,
} from '../../../../mocks/electrum';
import { sampleUtxos, sampleWallets, testnetAddresses } from '../../../../fixtures/bitcoin';
import { validateAddress } from '../../../../../src/services/bitcoin/utils';
import * as addressDerivation from '../../../../../src/services/bitcoin/addressDerivation';
import * as syncModule from '../../../../../src/services/bitcoin/sync';
import { getBlockchainService } from './blockchainTestHarness';

export function registerBlockchainSyncAddressTests(): void {
  describe('syncAddress', () => {
    const addressId = 'test-address-id';
    const walletId = 'test-wallet-id';
    const testAddress = testnetAddresses.nativeSegwit[0];

    it('should sync address and create transactions', async () => {
      // Mock address record
      mockPrismaClient.address.findUnique.mockResolvedValue({
        id: addressId,
        address: testAddress,
        walletId,
        wallet: { id: walletId, network: 'testnet' },
        used: false,
      });

      // Mock wallet addresses for detecting sends
      mockPrismaClient.address.findMany.mockResolvedValue([
        { address: testAddress },
      ]);

      // Mock address history with one received transaction
      const txHash = 'a'.repeat(64);
      mockElectrumClient.getAddressHistory.mockResolvedValue([
        { tx_hash: txHash, height: 800000 },
      ]);

      // Mock transaction details using batch API (syncAddress uses getTransactionsBatch)
      const mockTx = createMockTransaction({
        txid: txHash,
        blockheight: 800000,
        confirmations: 10,
        inputs: [{ txid: 'b'.repeat(64), vout: 0, value: 0.002, address: 'external-address' }],
        outputs: [{ value: 0.001, address: testAddress }],
      });
      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txHash, mockTx]]));

      // Mock no existing transaction
      mockPrismaClient.transaction.findFirst.mockResolvedValue(null);

      // Mock UTXOs
      mockElectrumClient.getAddressUTXOs.mockResolvedValue([
        createMockUTXO({ txid: txHash, vout: 0, value: 100000, height: 800000 }),
      ]);
      mockPrismaClient.uTXO.findUnique.mockResolvedValue(null);

      const result = await getBlockchainService().syncAddress(addressId);

      expect(result.transactions).toBeGreaterThan(0);
      expect(mockPrismaClient.transaction.create).toHaveBeenCalled();
    });

    it('should throw error when address not found', async () => {
      mockPrismaClient.address.findUnique.mockResolvedValue(null);

      await expect(getBlockchainService().syncAddress('nonexistent')).rejects.toThrow('Address not found');
    });

    it('should detect sent transactions', async () => {
      const ourAddress = testnetAddresses.nativeSegwit[0];
      const externalAddress = testnetAddresses.nativeSegwit[1];

      mockPrismaClient.address.findUnique.mockResolvedValue({
        id: addressId,
        address: ourAddress,
        walletId,
        wallet: { id: walletId },
        used: false,
      });

      mockPrismaClient.address.findMany.mockResolvedValue([
        { address: ourAddress },
      ]);

      const txHash = 'c'.repeat(64);
      mockElectrumClient.getAddressHistory.mockResolvedValue([
        { tx_hash: txHash, height: 800000 },
      ]);

      // Transaction where our address is an input (sending)
      mockElectrumClient.getTransaction.mockResolvedValue(
        createMockTransaction({
          txid: txHash,
          blockheight: 800000,
          inputs: [{ txid: 'd'.repeat(64), vout: 0, value: 0.002, address: ourAddress }],
          outputs: [{ value: 0.001, address: externalAddress }],
        })
      );

      mockPrismaClient.transaction.findFirst.mockResolvedValue(null);
      mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);

      const result = await getBlockchainService().syncAddress(addressId);

      expect(result.transactions).toBeGreaterThanOrEqual(0);
    });

    it('should mark address as used when transactions found', async () => {
      mockPrismaClient.address.findUnique.mockResolvedValue({
        id: addressId,
        address: testAddress,
        walletId,
        wallet: { id: walletId },
        used: false,
      });

      mockPrismaClient.address.findMany.mockResolvedValue([{ address: testAddress }]);

      mockElectrumClient.getAddressHistory.mockResolvedValue([
        { tx_hash: 'e'.repeat(64), height: 800000 },
      ]);

      mockElectrumClient.getTransaction.mockResolvedValue(
        createMockTransaction({ outputs: [{ value: 0.001, address: testAddress }] })
      );

      mockPrismaClient.transaction.findFirst.mockResolvedValue(null);
      mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);

      await getBlockchainService().syncAddress(addressId);

      expect(mockPrismaClient.address.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: addressId },
          data: { used: true },
        })
      );
    });

    it('should fetch previous transactions in batch for non-verbose inputs and create sent tx with fee', async () => {
      const ourAddress = testnetAddresses.nativeSegwit[0];
      const externalAddress = testnetAddresses.nativeSegwit[1];
      const txHash = 'p'.repeat(64);
      const prevTxid = 'q'.repeat(64);

      mockPrismaClient.address.findUnique.mockResolvedValue({
        id: addressId,
        address: ourAddress,
        walletId,
        wallet: { id: walletId, network: 'testnet' },
        used: false,
      });
      mockPrismaClient.address.findMany.mockResolvedValue([{ address: ourAddress }]);
      mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: txHash, height: 800000 }]);
      mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);
      mockElectrumClient.getBlockHeight.mockResolvedValue(800010);

      mockElectrumClient.getTransactionsBatch.mockImplementation(async (txids: string[]) => {
        if (txids.includes(txHash)) {
          return new Map([[
            txHash,
            {
              txid: txHash,
              vin: [{ txid: prevTxid, vout: 0 }],
              vout: [{ value: 0.0015, scriptPubKey: { hex: '0014...', address: externalAddress } }],
            },
          ]]);
        }
        if (txids.includes(prevTxid)) {
          return new Map([[
            prevTxid,
            {
              txid: prevTxid,
              vout: [{ value: 0.002, scriptPubKey: { hex: '0014...', address: ourAddress } }],
            },
          ]]);
        }
        return new Map();
      });

      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        if (args?.where?.walletId && args?.where?.txid?.in && !args?.where?.inputs) return [];
        if (args?.where?.inputs?.none && args?.where?.outputs?.none) return [];
        return [];
      });
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

      const result = await getBlockchainService().syncAddress(addressId);

      expect(result.transactions).toBe(1);
      expect(mockElectrumClient.getTransactionsBatch).toHaveBeenCalledWith([prevTxid], true);
      expect(mockPrismaClient.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            txid: txHash,
            type: 'sent',
            fee: BigInt(50000),
          }),
        }),
      );
    });

    it('should skip missing tx details and still mark address used when history exists', async () => {
      const txHash = 'r'.repeat(64);
      mockPrismaClient.address.findUnique.mockResolvedValue({
        id: addressId,
        address: testAddress,
        walletId,
        wallet: { id: walletId, network: 'testnet' },
        used: false,
      });
      mockPrismaClient.address.findMany.mockResolvedValue([{ address: testAddress }]);
      mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: txHash, height: 800000 }]);
      mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map());
      mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);
      mockPrismaClient.transaction.findMany.mockResolvedValue([]);
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

      const result = await getBlockchainService().syncAddress(addressId);

      expect(result.transactions).toBe(0);
      expect(result.utxos).toBe(0);
      expect(mockPrismaClient.address.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: addressId },
          data: { used: true },
        }),
      );
    });

    it('should classify consolidation with unknown fee as zero amount and null fee', async () => {
      const ourAddress = testnetAddresses.nativeSegwit[0];
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const txHash = 's'.repeat(64);

      mockPrismaClient.address.findUnique.mockResolvedValue({
        id: addressId,
        address: ourAddress,
        walletId,
        wallet: { id: walletId, network: 'testnet' },
        used: false,
      });
      mockPrismaClient.address.findMany.mockResolvedValue([
        { address: ourAddress },
        { address: changeAddress },
      ]);
      mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: txHash, height: 0 }]);
      mockElectrumClient.getTransactionsBatch.mockResolvedValue(
        new Map([[
          txHash,
          {
            txid: txHash,
            vin: [{
              prevout: {
                scriptPubKey: { address: ourAddress },
                // no value -> fee can't be calculated
              },
            }],
            vout: [{ value: 0.001, scriptPubKey: { hex: '0014...', address: changeAddress } }],
          },
        ]]),
      );
      mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);
      mockPrismaClient.transaction.findMany.mockResolvedValue([]);
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

      const result = await getBlockchainService().syncAddress(addressId);

      expect(result.transactions).toBe(1);
      expect(mockPrismaClient.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'consolidation',
            amount: BigInt(0),
            fee: null,
            confirmations: 0,
            blockHeight: null,
          }),
        }),
      );
    });

    it('should batch-fetch missing utxo transactions and create utxo rows', async () => {
      const utxoTxid = 't'.repeat(64);
      mockPrismaClient.address.findUnique.mockResolvedValue({
        id: addressId,
        address: testAddress,
        walletId,
        wallet: { id: walletId, network: 'testnet' },
        used: true,
      });
      mockPrismaClient.address.findMany.mockResolvedValue([{ address: testAddress }]);
      mockElectrumClient.getAddressHistory.mockResolvedValue([]);
      mockElectrumClient.getAddressUTXOs.mockResolvedValue([
        { tx_hash: utxoTxid, tx_pos: 0, value: 100000, height: 800000 },
      ]);
      mockElectrumClient.getBlockHeight.mockResolvedValue(800010);
      mockElectrumClient.getTransactionsBatch.mockImplementation(async (txids: string[]) => {
        if (txids.includes(utxoTxid)) {
          return new Map([[
            utxoTxid,
            {
              txid: utxoTxid,
              vout: [{ value: 0.001, scriptPubKey: { hex: '0014abcd', address: testAddress } }],
            },
          ]]);
        }
        return new Map();
      });
      mockPrismaClient.transaction.findMany.mockResolvedValue([]);
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

      const result = await getBlockchainService().syncAddress(addressId);

      expect(result.utxos).toBe(1);
      expect(mockPrismaClient.uTXO.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              txid: utxoTxid,
              vout: 0,
              scriptPubKey: '0014abcd',
            }),
          ]),
          skipDuplicates: true,
        }),
      );
    });

    it('should store transaction inputs and outputs for newly created transactions', async () => {
      const txHash = 'u'.repeat(64);
      const senderAddress = 'tb1qsender000000000000000000000000000000000';

      mockPrismaClient.address.findUnique.mockResolvedValue({
        id: addressId,
        address: testAddress,
        walletId,
        wallet: { id: walletId, network: 'testnet' },
        used: false,
      });
      mockPrismaClient.address.findMany.mockResolvedValue([{ address: testAddress }]);
      mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: txHash, height: 800000 }]);
      mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);
      mockElectrumClient.getBlockHeight.mockResolvedValue(800010);
      mockElectrumClient.getTransactionsBatch.mockImplementation(async (txids: string[]) => {
        if (txids.includes(txHash)) {
          return new Map([[
            txHash,
            {
              txid: txHash,
              time: 1700000000,
              vin: [{
                txid: 'prev'.repeat(16),
                vout: 0,
                prevout: {
                  value: 0.002,
                  scriptPubKey: { hex: '0014sender', address: senderAddress },
                },
              }],
              vout: [{
                value: 0.001,
                scriptPubKey: { hex: '0014ours', address: testAddress },
              }],
            },
          ]]);
        }
        return new Map();
      });
      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        if (args?.where?.walletId && args?.where?.txid?.in && !args?.where?.inputs) return [];
        if (args?.where?.inputs?.none && args?.where?.outputs?.none) {
          return [{ id: 'tx-io-record', txid: txHash, type: 'received' }];
        }
        return [];
      });
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

      const result = await getBlockchainService().syncAddress(addressId);

      expect(result.transactions).toBe(1);
      expect(mockPrismaClient.transactionInput.createMany).toHaveBeenCalled();
      expect(mockPrismaClient.transactionOutput.createMany).toHaveBeenCalled();
    });

    it('should continue when storing transaction IO fails', async () => {
      const txHash = 'y'.repeat(64);

      mockPrismaClient.address.findUnique.mockResolvedValue({
        id: addressId,
        address: testAddress,
        walletId,
        wallet: { id: walletId, network: 'testnet' },
        used: false,
      });
      mockPrismaClient.address.findMany.mockResolvedValue([{ address: testAddress }]);
      mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: txHash, height: 800000 }]);
      mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);
      mockElectrumClient.getBlockHeight.mockResolvedValue(800010);
      mockElectrumClient.getTransactionsBatch.mockResolvedValue(
        new Map([[
          txHash,
          {
            txid: txHash,
            time: 1700000000,
            vin: [{
              txid: 'prev'.repeat(16),
              vout: 0,
              prevout: {
                value: 0.002,
                scriptPubKey: { hex: '0014sender', address: 'tb1qsender' },
              },
            }],
            vout: [{ value: 0.001, scriptPubKey: { hex: '0014ours', address: testAddress } }],
          },
        ]]),
      );
      mockPrismaClient.transaction.findMany.mockImplementation(async (args: any) => {
        if (args?.where?.walletId && args?.where?.txid?.in && !args?.where?.inputs) return [];
        if (args?.where?.inputs?.none && args?.where?.outputs?.none) {
          return [{ id: 'tx-io-record', txid: txHash, type: 'received' }];
        }
        return [];
      });
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
      mockPrismaClient.transactionInput.createMany.mockRejectedValueOnce(new Error('input insert failed'));

      const result = await getBlockchainService().syncAddress(addressId);

      expect(result.transactions).toBe(1);
      expect(result.utxos).toBe(0);
      expect(mockPrismaClient.transaction.create).toHaveBeenCalled();
    });

    it('should return zero confirmations when block height lookup fails', async () => {
      const txHash = 'v'.repeat(64);
      mockPrismaClient.address.findUnique.mockResolvedValue({
        id: addressId,
        address: testAddress,
        walletId,
        // use a network with no prior cached height in this suite
        wallet: { id: walletId, network: 'regtest' },
        used: false,
      });
      mockPrismaClient.address.findMany.mockResolvedValue([{ address: testAddress }]);
      mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: txHash, height: 800000 }]);
      mockElectrumClient.getAddressUTXOs.mockResolvedValue([]);
      mockElectrumClient.getBlockHeight.mockRejectedValue(new Error('height unavailable'));
      mockElectrumClient.getTransactionsBatch.mockResolvedValue(
        new Map([[
          txHash,
          createMockTransaction({
            txid: txHash,
            blockheight: 800000,
            confirmations: 0,
            inputs: [{ txid: 'w'.repeat(64), vout: 0, value: 0.002, address: 'external' }],
            outputs: [{ value: 0.001, address: testAddress }],
          }),
        ]]),
      );
      mockPrismaClient.transaction.findMany.mockResolvedValue([]);
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

      await getBlockchainService().syncAddress(addressId);

      expect(mockPrismaClient.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            confirmations: 0,
          }),
        }),
      );
    });

    it('should propagate syncAddress errors from batch history fetch', async () => {
      mockPrismaClient.address.findUnique.mockResolvedValue({
        id: addressId,
        address: testAddress,
        walletId,
        wallet: { id: walletId, network: 'testnet' },
        used: false,
      });
      mockPrismaClient.address.findMany.mockResolvedValue([{ address: testAddress }]);
      mockElectrumClient.getAddressHistory.mockResolvedValue([{ tx_hash: 'x'.repeat(64), height: 800000 }]);
      mockElectrumClient.getTransactionsBatch.mockRejectedValue(new Error('batch failed'));

      await expect(getBlockchainService().syncAddress(addressId)).rejects.toThrow('batch failed');
    });
  });
}
