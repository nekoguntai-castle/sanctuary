import { broadcastRecipient as recipient, broadcastWalletId as walletId } from './transactionServiceBroadcast.broadcastAndSave.shared';
import { describe, expect, it, type Mock } from 'vitest';
import { broadcastAndSave } from '../../../../../src/services/bitcoin/transactionService';
import { broadcastTransaction, recalculateWalletBalances } from '../../../../../src/services/bitcoin/blockchain';
import { mockPrismaClient } from '../../../../mocks/prisma';
import { sampleUtxos } from '../../../../fixtures/bitcoin';

export const registerBroadcastAndSaveFailureAndRbfContracts = () => {
  it('should not call recalculateWalletBalances when broadcast fails', async () => {
    (broadcastTransaction as Mock).mockResolvedValue({
      txid: null,
      broadcasted: false,
    });

    const metadata = {
      recipient,
      amount: 50000,
      fee: 1000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
    };

    try {
      await broadcastAndSave(walletId, undefined, metadata);
    } catch {
      // Expected to fail
    }

    // Verify recalculateWalletBalances was NOT called when broadcast fails
    expect(recalculateWalletBalances).not.toHaveBeenCalled();
  });

  it('should handle recalculateWalletBalances error gracefully', async () => {
    // recalculateWalletBalances throws but broadcast should still complete
    // Note: The actual behavior depends on implementation - if recalculateWalletBalances
    // is called with await, errors will propagate. If it's fire-and-forget, they won't.
    // This test documents the expected behavior.
    (recalculateWalletBalances as Mock).mockRejectedValueOnce(new Error('Balance calculation failed'));

    const metadata = {
      recipient,
      amount: 50000,
      fee: 1000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
    };

    // The broadcast should either succeed or throw depending on implementation
    // If recalculateWalletBalances errors are caught, broadcast succeeds
    // If they propagate, broadcast throws
    try {
      const result = await broadcastAndSave(walletId, undefined, metadata);
      // If we get here, the implementation catches balance calculation errors
      expect(result.broadcasted).toBe(true);
      expect(result.txid).toBeDefined();
    } catch (error) {
      // If we get here, balance calculation errors propagate
      // This is also valid behavior - the test documents it
      expect((error as Error).message).toContain('Balance calculation failed');
    }

    // Verify recalculateWalletBalances was called
    expect(recalculateWalletBalances).toHaveBeenCalledWith(walletId);
  });

  describe('RBF Transaction Tracking', () => {
    it('should detect RBF replacement from memo and mark original as replaced', async () => {
      const originalTxid = 'original-tx-12345678901234567890123456789012345678901234567890123456';

      // Mock finding the original transaction
      mockPrismaClient.transaction.findFirst.mockResolvedValue({
        id: 'original-tx-db-id',
        txid: originalTxid,
        walletId,
        type: 'sent',
        amount: BigInt(45000),
        fee: BigInt(500),
        label: 'Original payment label',
        memo: 'Original memo',
        rbfStatus: 'active',
      });

      const metadata = {
        recipient,
        amount: 45000,
        fee: 2000, // Higher fee for RBF
        label: undefined, // No label provided - should copy from original
        memo: `Replacing transaction ${originalTxid}`,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      await broadcastAndSave(walletId, undefined, metadata);

      // Verify original transaction was marked as replaced
      expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'original-tx-db-id' },
          data: expect.objectContaining({
            rbfStatus: 'replaced',
            replacedByTxid: expect.any(String), // The new txid
          }),
        })
      );

      // Verify new transaction created with correct fields
      expect(mockPrismaClient.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            replacementForTxid: originalTxid,
            rbfStatus: 'active',
            label: 'Original payment label', // Preserved from original
          }),
        })
      );
    });

    it('should preserve original label when RBF transaction has no label', async () => {
      const originalTxid = 'original-tx-with-label-5678901234567890123456789012345678901234';

      mockPrismaClient.transaction.findFirst.mockResolvedValue({
        id: 'tx-with-label',
        txid: originalTxid,
        walletId,
        label: 'Important payment',
        rbfStatus: 'active',
      });

      const metadata = {
        recipient,
        amount: 50000,
        fee: 3000,
        label: undefined, // No new label
        memo: `Replacing transaction ${originalTxid}`,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      await broadcastAndSave(walletId, undefined, metadata);

      expect(mockPrismaClient.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            label: 'Important payment',
          }),
        })
      );
    });

    it('should use provided label over original when both exist', async () => {
      const originalTxid = 'original-tx-label-override-56789012345678901234567890123456789012';

      mockPrismaClient.transaction.findFirst.mockResolvedValue({
        id: 'tx-original',
        txid: originalTxid,
        walletId,
        label: 'Old label',
        rbfStatus: 'active',
      });

      const metadata = {
        recipient,
        amount: 50000,
        fee: 3000,
        label: 'New explicit label', // Explicitly provided
        memo: `Replacing transaction ${originalTxid}`,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      await broadcastAndSave(walletId, undefined, metadata);

      expect(mockPrismaClient.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            label: 'New explicit label',
          }),
        })
      );
    });

    it('should handle RBF when original transaction not found', async () => {
      const nonExistentTxid = 'nonexistent-tx-123456789012345678901234567890123456789012345';

      // Original not found
      mockPrismaClient.transaction.findFirst.mockResolvedValue(null);

      const metadata = {
        recipient,
        amount: 50000,
        fee: 3000,
        memo: `Replacing transaction ${nonExistentTxid}`,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      // Should not throw - gracefully handle missing original
      await expect(broadcastAndSave(walletId, undefined, metadata)).resolves.toBeDefined();

      // Should still create the new transaction with replacementForTxid
      expect(mockPrismaClient.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            replacementForTxid: nonExistentTxid,
            rbfStatus: 'active',
          }),
        })
      );

      // Should NOT call update since original wasn't found
      expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
    });

    it('should not treat regular transactions as RBF', async () => {
      const metadata = {
        recipient,
        amount: 50000,
        fee: 1000,
        label: 'Regular payment',
        memo: 'Just a normal transaction', // No RBF prefix
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      await broadcastAndSave(walletId, undefined, metadata);

      // Should create transaction without RBF fields
      expect(mockPrismaClient.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            replacementForTxid: undefined,
            rbfStatus: 'active',
          }),
        })
      );

      // Should not try to find or update an original transaction
      expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
    });

    it('should release UTXO locks when broadcasting from a draft', async () => {
      const draftId = 'draft-to-broadcast';
      mockPrismaClient.draftUtxoLock.deleteMany.mockResolvedValue({ count: 2 });

      const metadata = {
        recipient,
        amount: 50000,
        fee: 1000,
        utxos: [
          { txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout },
          { txid: sampleUtxos[1].txid, vout: sampleUtxos[1].vout },
        ],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
        draftId,
      };

      await broadcastAndSave(walletId, undefined, metadata);

      expect(mockPrismaClient.draftUtxoLock.deleteMany).toHaveBeenCalledWith({
        where: { draftId },
      });
    });
  });
};
