import './transactionServiceBroadcastTestHarness';
import { beforeEach, describe, expect, it, type Mock } from 'vitest';
import { broadcastAndSave } from '../../../../../src/services/bitcoin/transactionService';
import { broadcastTransaction, recalculateWalletBalances } from '../../../../../src/services/bitcoin/blockchain';
import { mockPrismaClient } from '../../../../mocks/prisma';
import { sampleUtxos, testnetAddresses } from '../../../../fixtures/bitcoin';

export const registerBroadcastEdgeCaseTests = () => {
  describe('Error Handling - Broadcast Edge Cases', () => {
    const walletId = 'broadcast-error-wallet';
    const recipient = testnetAddresses.nativeSegwit[0];

    beforeEach(() => {
      (broadcastTransaction as Mock).mockResolvedValue({
        txid: 'new-txid-from-broadcast',
        broadcasted: true,
      });
      (recalculateWalletBalances as Mock).mockResolvedValue(undefined);
      mockPrismaClient.uTXO.update.mockResolvedValue({});
      mockPrismaClient.transaction.create.mockResolvedValue({
        id: 'tx-1',
        txid: 'new-txid-from-broadcast',
        walletId,
        type: 'sent',
      });
      mockPrismaClient.address.findFirst.mockResolvedValue(null);
    });

    it('should handle database error during UTXO update', async () => {
      mockPrismaClient.uTXO.update.mockRejectedValueOnce(new Error('DB connection lost'));

      const metadata = {
        recipient,
        amount: 50000,
        fee: 1000,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      // Should throw when database update fails
      await expect(
        broadcastAndSave(walletId, undefined, metadata)
      ).rejects.toThrow('DB connection lost');
    });

    it('should handle database error during transaction create', async () => {
      mockPrismaClient.transaction.create.mockRejectedValueOnce(new Error('Constraint violation'));

      const metadata = {
        recipient,
        amount: 50000,
        fee: 1000,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      await expect(
        broadcastAndSave(walletId, undefined, metadata)
      ).rejects.toThrow('Constraint violation');
    });

    it('should handle empty UTXO array in metadata', async () => {
      const metadata = {
        recipient,
        amount: 50000,
        fee: 1000,
        utxos: [], // Empty UTXOs
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      // Should still broadcast (UTXOs from rawTxHex)
      const result = await broadcastAndSave(walletId, undefined, metadata);
      expect(result.broadcasted).toBe(true);
    });

    it('should handle broadcast timeout/network error', async () => {
      (broadcastTransaction as Mock).mockRejectedValueOnce(new Error('Network timeout'));

      const metadata = {
        recipient,
        amount: 50000,
        fee: 1000,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      await expect(
        broadcastAndSave(walletId, undefined, metadata)
      ).rejects.toThrow('Network timeout');
    });

    it('should handle invalid rawTxHex format', async () => {
      const metadata = {
        recipient,
        amount: 50000,
        fee: 1000,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        rawTxHex: 'not-a-valid-hex-string',
      };

      await expect(
        broadcastAndSave(walletId, undefined, metadata)
      ).rejects.toThrow();
    });

    it('should handle missing required metadata fields', async () => {
      const incompleteMetadata = {
        recipient,
        // Missing: amount, fee, utxos
      };

      await expect(
        broadcastAndSave(walletId, undefined, incompleteMetadata as any)
      ).rejects.toThrow();
    });
  });
};
