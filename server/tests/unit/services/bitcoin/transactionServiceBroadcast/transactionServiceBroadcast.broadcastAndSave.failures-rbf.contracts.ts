import {
  broadcastAndSave,
  broadcastRecipient as recipient,
  broadcastWalletId as walletId,
  withBroadcastNetwork,
} from './transactionServiceBroadcast.broadcastAndSave.shared';
import { describe, expect, it, type Mock } from 'vitest';
import { broadcastTransaction, recalculateWalletBalances } from '../../../../../src/services/bitcoin/blockchain';
import { mockPrismaClient } from '../../../../mocks/prisma';
import { sampleUtxos } from '../../../../fixtures/bitcoin';
import {
  mockClaimSigningIntentBroadcast,
  mockReleaseRejectedSigningIntentBroadcast,
} from './transactionServiceBroadcastTestHarness';

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
      await broadcastAndSave(walletId, undefined, withBroadcastNetwork(metadata));
    } catch {
      // Expected to fail
    }

    // Verify recalculateWalletBalances was NOT called when broadcast fails
    expect(recalculateWalletBalances).not.toHaveBeenCalled();
  });

  it('should handle recalculateWalletBalances error gracefully', async () => {
    (recalculateWalletBalances as Mock).mockRejectedValueOnce(new Error('Balance calculation failed'));

    const metadata = {
      recipient,
      amount: 50000,
      fee: 1000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
    };

    const result = await broadcastAndSave(walletId, undefined, withBroadcastNetwork(metadata));

    expect(result).toMatchObject({ broadcasted: true, persistenceStatus: 'complete' });
    expect(recalculateWalletBalances).toHaveBeenCalledWith(walletId);
  });

  describe('RBF Transaction Tracking', () => {
    const sharedOutpoint = { txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout };

    it('should link a replacement from a structural replacesTxid and mark original as replaced', async () => {
      const originalTxid = 'original-tx-12345678901234567890123456789012345678901234567890123456';

      // Mock finding the original transaction: unconfirmed, on the same wallet.
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
        confirmations: 0,
        blockHeight: null,
      });
      // Original transaction's own spent input — the new transaction must share it.
      mockPrismaClient.transactionInput.findMany.mockResolvedValue([sharedOutpoint]);

      const metadata = {
        recipient,
        amount: 45000,
        fee: 2000, // Higher fee for RBF
        label: undefined, // No label provided - should copy from original
        memo: `Replacing transaction ${originalTxid}`, // Display text only - has no effect on linkage.
        replacesTxid: originalTxid,
        utxos: [sharedOutpoint],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      await broadcastAndSave(walletId, undefined, withBroadcastNetwork(metadata));

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
      expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({
            replacementForTxid: originalTxid,
            rbfStatus: 'active',
            label: 'Original payment label', // Preserved from original
          })],
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
        confirmations: 0,
        blockHeight: null,
      });
      mockPrismaClient.transactionInput.findMany.mockResolvedValue([sharedOutpoint]);

      const metadata = {
        recipient,
        amount: 50000,
        fee: 3000,
        label: undefined, // No new label
        replacesTxid: originalTxid,
        utxos: [sharedOutpoint],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      await broadcastAndSave(walletId, undefined, withBroadcastNetwork(metadata));

      expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({
            label: 'Important payment',
          })],
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
        confirmations: 0,
        blockHeight: null,
      });
      mockPrismaClient.transactionInput.findMany.mockResolvedValue([sharedOutpoint]);

      const metadata = {
        recipient,
        amount: 50000,
        fee: 3000,
        label: 'New explicit label', // Explicitly provided
        replacesTxid: originalTxid,
        utxos: [sharedOutpoint],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      await broadcastAndSave(walletId, undefined, withBroadcastNetwork(metadata));

      expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({
            label: 'New explicit label',
          })],
        })
      );
    });

    it('should not treat a memo prefix alone as a replacement (memo has no effect on linkage)', async () => {
      const originalTxid = 'memo-only-tx-1234567890123456789012345678901234567890123456789012';

      // The original transaction exists, is unconfirmed, and even shares an
      // input — but replacesTxid was never sent, only the descriptive memo.
      mockPrismaClient.transaction.findFirst.mockResolvedValue({
        id: 'memo-only-db-id',
        txid: originalTxid,
        walletId,
        label: 'Should not be inherited',
        rbfStatus: 'active',
        confirmations: 0,
        blockHeight: null,
      });
      mockPrismaClient.transactionInput.findMany.mockResolvedValue([sharedOutpoint]);

      const metadata = {
        recipient,
        amount: 50000,
        fee: 3000,
        label: 'Regular payment',
        memo: `Replacing transaction ${originalTxid}`,
        utxos: [sharedOutpoint],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      await broadcastAndSave(walletId, undefined, withBroadcastNetwork(metadata));

      expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
      expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({
            replacementForTxid: undefined,
            label: 'Regular payment',
            memo: `Replacing transaction ${originalTxid}`,
          })],
        })
      );
    });

    it('should reject a replacesTxid that cannot be verified BEFORE anything reaches the network', async () => {
      const nonExistentTxid = 'nonexistent-tx-123456789012345678901234567890123456789012345';

      // Original not found - replacesTxid cannot be verified.
      mockPrismaClient.transaction.findFirst.mockResolvedValue(null);

      const metadata = {
        recipient,
        amount: 50000,
        fee: 3000,
        replacesTxid: nonExistentTxid,
        utxos: [sharedOutpoint],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      // Rejects outright: nothing has been broadcast yet, so this must not
      // degrade to reconciliation the way a post-broadcast persistence
      // failure would - it is a plain validation error.
      await expect(broadcastAndSave(walletId, undefined, withBroadcastNetwork(metadata)))
        .rejects.toThrow('replacesTxid does not match an unconfirmed transaction sharing an input');

      // Nothing reached the network and nothing was committed.
      expect(broadcastTransaction).not.toHaveBeenCalled();
      expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
      expect(mockPrismaClient.transaction.createMany).not.toHaveBeenCalled();
    });

    it('should reject a replacesTxid that exists and is unconfirmed but shares no input, BEFORE anything reaches the network', async () => {
      const originalTxid = 'original-no-overlap-1234567890123456789012345678901234567890123456';
      const unrelatedOutpoint = { txid: 'e'.repeat(64), vout: 9 };

      // The named original exists and is unconfirmed, but its own recorded
      // input does not overlap the new transaction's inputs at all.
      mockPrismaClient.transaction.findFirst.mockResolvedValue({
        id: 'original-no-overlap-id',
        txid: originalTxid,
        walletId,
        confirmations: 0,
        blockHeight: null,
        label: null,
      });
      mockPrismaClient.transactionInput.findMany.mockResolvedValue([unrelatedOutpoint]);

      const metadata = {
        recipient,
        amount: 50000,
        fee: 3000,
        replacesTxid: originalTxid,
        utxos: [sharedOutpoint],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      await expect(broadcastAndSave(walletId, undefined, withBroadcastNetwork(metadata)))
        .rejects.toThrow('replacesTxid does not match an unconfirmed transaction sharing an input');

      expect(broadcastTransaction).not.toHaveBeenCalled();
      expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
      expect(mockPrismaClient.transaction.createMany).not.toHaveBeenCalled();
    });

    it('should not re-validate replacesTxid on an idempotent replay of an already-complete broadcast', async () => {
      // A stale replacesTxid (original since confirmed) would reject a first
      // attempt, but a replay of a broadcast the intent lease already marked
      // complete must short-circuit before validation ever runs, or a
      // harmless retry would fail with a 400 instead of replaying cleanly.
      const originalTxid = 'original-replay-idempotent-12345678901234567890123456789012345678';
      mockClaimSigningIntentBroadcast.mockResolvedValueOnce({ status: 'complete' });
      mockPrismaClient.transaction.findFirst.mockResolvedValue(null);

      const metadata = {
        recipient,
        amount: 50000,
        fee: 3000,
        replacesTxid: originalTxid,
        utxos: [sharedOutpoint],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      await expect(broadcastAndSave(walletId, undefined, withBroadcastNetwork(metadata)))
        .resolves.toMatchObject({ persistenceStatus: 'complete' });

      expect(mockPrismaClient.transaction.findFirst).not.toHaveBeenCalled();
      expect(broadcastTransaction).not.toHaveBeenCalled();
    });

    it('should release the claimed lease when a replacesTxid rejection happens after claiming', async () => {
      const originalTxid = 'original-lease-release-1234567890123456789012345678901234567890123';
      mockPrismaClient.transaction.findFirst.mockResolvedValue(null);

      const metadata = {
        recipient,
        amount: 50000,
        fee: 3000,
        replacesTxid: originalTxid,
        utxos: [sharedOutpoint],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      await expect(broadcastAndSave(walletId, undefined, withBroadcastNetwork(metadata))).rejects.toThrow();

      expect(mockReleaseRejectedSigningIntentBroadcast).toHaveBeenCalledWith(
        'intent-broadcast-persistence-test',
        'lease-1',
        expect.any(String),
      );
    });

    it('still surfaces the original replacesTxid rejection when releasing the claimed lease also fails', async () => {
      const originalTxid = 'original-lease-release-failure-123456789012345678901234567890123456';
      mockPrismaClient.transaction.findFirst.mockResolvedValue(null);
      mockReleaseRejectedSigningIntentBroadcast.mockRejectedValueOnce(new Error('lease store unavailable'));

      const metadata = {
        recipient,
        amount: 50000,
        fee: 3000,
        replacesTxid: originalTxid,
        utxos: [sharedOutpoint],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      // The lease-store failure is swallowed (logged for reconciliation); the
      // caller still sees the original replacesTxid validation error, not
      // the lease-release error.
      await expect(broadcastAndSave(walletId, undefined, withBroadcastNetwork(metadata)))
        .rejects.toThrow('replacesTxid does not match an unconfirmed transaction sharing an input');

      expect(broadcastTransaction).not.toHaveBeenCalled();
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

      await broadcastAndSave(walletId, undefined, withBroadcastNetwork(metadata));

      // Should create transaction without RBF fields
      expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [expect.objectContaining({
            replacementForTxid: undefined,
            rbfStatus: 'active',
          })],
        })
      );

      // Should not try to find or update an original transaction
      expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
    });

    it('should release UTXO locks when broadcasting from a draft', async () => {
      const draftId = 'draft-to-broadcast';
      mockPrismaClient.draftUtxoLock.deleteMany.mockResolvedValue({ count: 2 });
      mockPrismaClient.draftTransaction.updateMany.mockResolvedValue({ count: 1 });

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

      await broadcastAndSave(walletId, undefined, withBroadcastNetwork(metadata));

      expect(mockPrismaClient.draftUtxoLock.deleteMany).toHaveBeenCalledWith({
        where: { draftId },
      });
      expect(mockPrismaClient.draftTransaction.updateMany).toHaveBeenCalledWith({
        where: { id: draftId },
        data: {
          status: 'broadcasted',
          updatedAt: expect.any(Date),
        },
      });
    });
  });
};
