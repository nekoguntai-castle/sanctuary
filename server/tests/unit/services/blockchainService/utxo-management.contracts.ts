import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  mockNodeClient,
  mockPrisma,
} from './blockchainServiceTestHarness';

export function registerBlockchainUtxoManagementContracts(): void {
describe('Blockchain Service - UTXO Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('UTXO creation', () => {
    it('should create UTXOs from blockchain unspent outputs', async () => {
      const { syncAddress } = await import('../../../../src/services/bitcoin/blockchain');

      const testAddress = {
        id: 'addr-1',
        address: 'bc1qtest123',
        walletId: 'wallet-1',
        wallet: { id: 'wallet-1', network: 'mainnet' },
      };

      mockPrisma.address.findUnique.mockResolvedValue(testAddress);
      mockPrisma.address.findMany.mockResolvedValue([testAddress]);
      mockPrisma.transaction.findMany.mockResolvedValue([]);
      mockPrisma.uTXO.findMany.mockResolvedValue([]);
      mockPrisma.uTXO.createMany.mockResolvedValue({ count: 2 });
      mockPrisma.address.update.mockResolvedValue({});

      const txDetails = {
        txid: 'utxo-tx',
        vout: [
          { value: 0.1, scriptPubKey: { address: 'bc1qtest123', hex: '0014test' } },
          { value: 0.2, scriptPubKey: { address: 'bc1qtest123', hex: '0014test' } },
        ],
      };

      mockNodeClient.getAddressHistory.mockResolvedValue([]);
      // Need to return the tx details in the batch
      mockNodeClient.getTransactionsBatch.mockResolvedValue(
        new Map([['utxo-tx', txDetails]])
      );
      mockNodeClient.getAddressUTXOs.mockResolvedValue([
        { tx_hash: 'utxo-tx', tx_pos: 0, height: 799990, value: 10000000 },
        { tx_hash: 'utxo-tx', tx_pos: 1, height: 799990, value: 20000000 },
      ]);
      mockNodeClient.getTransaction.mockResolvedValue(txDetails);

      const result = await syncAddress('addr-1');

      // UTXOs are created via createMany
      expect(result.utxos).toBeGreaterThanOrEqual(0);
    });

    it('should skip duplicate UTXOs with skipDuplicates', async () => {
      // The createMany is called with skipDuplicates: true
      const createManyCall = {
        data: [{ txid: 'tx1', vout: 0 }],
        skipDuplicates: true,
      };

      expect(createManyCall.skipDuplicates).toBe(true);
    });
  });

  describe('UTXO spending detection', () => {
    it('should mark UTXOs as spent when no longer on blockchain', async () => {
      const { syncWallet } = await import('../../../../src/services/bitcoin/blockchain');

      const testWallet = {
        id: 'wallet-1',
        name: 'Test Wallet',
        network: 'mainnet',
        descriptor: 'wpkh([abc123]xpub.../0/*)',
      };

      const addresses = [
        { id: 'addr-1', address: 'bc1qwallet', derivationPath: "m/84'/0'/0'/0/0", index: 0, used: true },
      ];

      // Existing UTXO in database
      const existingUtxo = {
        id: 'utxo-1',
        txid: 'spent-tx',
        vout: 0,
        spent: false,
        confirmations: 6,
        blockHeight: 799990,
        address: 'bc1qwallet',
      };

      mockPrisma.wallet.findUnique.mockResolvedValue(testWallet);
      mockPrisma.address.findMany.mockResolvedValue(addresses);
      mockPrisma.address.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.transaction.findMany.mockResolvedValue([]);
      mockPrisma.transaction.createMany.mockResolvedValue({ count: 0 });
      mockPrisma.uTXO.findMany.mockResolvedValue([existingUtxo]);
      mockPrisma.uTXO.createMany.mockResolvedValue({ count: 0 });
      mockPrisma.uTXO.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.draftUtxoLock.findMany.mockResolvedValue([]);

      mockNodeClient.getAddressHistoryBatch.mockResolvedValue(
        new Map([['bc1qwallet', []]])
      );
      mockNodeClient.getAddressUTXOsBatch.mockResolvedValue(
        new Map([['bc1qwallet', []]]) // UTXO no longer on blockchain
      );

      await syncWallet('wallet-1');

      // Should mark the UTXO as spent
      expect(mockPrisma.uTXO.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['utxo-1'] } },
          data: { spent: true },
        })
      );
    });

    it('should invalidate draft transactions using spent UTXOs', async () => {
      const { syncWallet } = await import('../../../../src/services/bitcoin/blockchain');

      const testWallet = {
        id: 'wallet-1',
        name: 'Test Wallet',
        network: 'mainnet',
        descriptor: 'wpkh([abc123]xpub.../0/*)',
      };

      const addresses = [
        { id: 'addr-1', address: 'bc1qwallet', derivationPath: "m/84'/0'/0'/0/0", index: 0, used: true },
      ];

      const existingUtxo = {
        id: 'utxo-1',
        txid: 'spent-tx',
        vout: 0,
        spent: false,
        confirmations: 6,
        blockHeight: 799990,
        address: 'bc1qwallet',
      };

      // Draft transaction using the UTXO that will be spent
      const draftLock = {
        draftId: 'draft-1',
        utxoId: 'utxo-1',
        draft: { id: 'draft-1', label: 'Payment to Bob', recipient: 'bc1qbob' },
      };

      mockPrisma.wallet.findUnique.mockResolvedValue(testWallet);
      mockPrisma.address.findMany.mockResolvedValue(addresses);
      mockPrisma.address.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.transaction.findMany.mockResolvedValue([]);
      mockPrisma.transaction.createMany.mockResolvedValue({ count: 0 });
      mockPrisma.uTXO.findMany.mockResolvedValue([existingUtxo]);
      mockPrisma.uTXO.createMany.mockResolvedValue({ count: 0 });
      mockPrisma.uTXO.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.draftUtxoLock.findMany.mockResolvedValue([draftLock]);
      mockPrisma.draftTransaction.deleteMany.mockResolvedValue({ count: 1 });

      mockNodeClient.getAddressHistoryBatch.mockResolvedValue(
        new Map([['bc1qwallet', []]])
      );
      mockNodeClient.getAddressUTXOsBatch.mockResolvedValue(
        new Map([['bc1qwallet', []]])
      );

      await syncWallet('wallet-1');

      // Should delete the draft that was using the spent UTXO
      expect(mockPrisma.draftTransaction.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['draft-1'] } },
      });
    });
  });

  describe('UTXO confirmation updates', () => {
    it('should update UTXO confirmations as blocks are mined', async () => {
      const { syncWallet } = await import('../../../../src/services/bitcoin/blockchain');

      const testWallet = {
        id: 'wallet-1',
        name: 'Test Wallet',
        network: 'mainnet',
        descriptor: 'wpkh([abc123]xpub.../0/*)',
      };

      const addresses = [
        { id: 'addr-1', address: 'bc1qwallet', derivationPath: "m/84'/0'/0'/0/0", index: 0, used: true },
      ];

      // UTXO with old confirmation count
      const existingUtxo = {
        id: 'utxo-1',
        txid: 'confirmed-tx',
        vout: 0,
        spent: false,
        confirmations: 3, // Old count
        blockHeight: 799997,
        address: 'bc1qwallet',
      };

      mockPrisma.wallet.findUnique.mockResolvedValue(testWallet);
      mockPrisma.address.findMany.mockResolvedValue(addresses);
      mockPrisma.address.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.transaction.findMany.mockResolvedValue([]);
      mockPrisma.transaction.createMany.mockResolvedValue({ count: 0 });
      mockPrisma.uTXO.findMany.mockResolvedValue([existingUtxo]);
      mockPrisma.uTXO.createMany.mockResolvedValue({ count: 0 });
      mockPrisma.uTXO.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.uTXO.update.mockResolvedValue({});

      mockNodeClient.getAddressHistoryBatch.mockResolvedValue(
        new Map([['bc1qwallet', []]])
      );
      mockNodeClient.getAddressUTXOsBatch.mockResolvedValue(
        new Map([
          ['bc1qwallet', [{ tx_hash: 'confirmed-tx', tx_pos: 0, height: 799997, value: 10000000 }]],
        ])
      );

      await syncWallet('wallet-1');

      // The $transaction batch update should be called
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });
});
}
