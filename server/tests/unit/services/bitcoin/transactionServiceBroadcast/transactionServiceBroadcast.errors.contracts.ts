import './transactionServiceBroadcastTestHarness';
import { beforeEach, describe, expect, it, type Mock } from 'vitest';
import { broadcastTransaction, DefiniteBroadcastRejectionError, recalculateWalletBalances } from '../../../../../src/services/bitcoin/blockchain';
import { mockPrismaClient } from '../../../../mocks/prisma';
import { sampleUtxos, testnetAddresses } from '../../../../fixtures/bitcoin';
import { broadcastAndSave, withBroadcastNetwork } from './transactionServiceBroadcast.broadcastAndSave.shared';
import {
  mockClaimSigningIntentBroadcast,
  mockMarkSigningIntentBroadcastComplete,
  mockMarkSigningIntentBroadcastUnknown,
  mockReleaseRejectedSigningIntentBroadcast,
  createRawTxHex,
} from './transactionServiceBroadcastTestHarness';

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
      mockPrismaClient.transaction.createMany.mockResolvedValue({ count: 1 });
      mockPrismaClient.transaction.create.mockResolvedValue({
        id: 'tx-1',
        txid: 'new-txid-from-broadcast',
        walletId,
        type: 'sent',
      });
      mockPrismaClient.address.findFirst.mockResolvedValue(null);
      mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'testnet4' });
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

      await expect(
        broadcastAndSave(walletId, undefined, withBroadcastNetwork(metadata))
      ).resolves.toMatchObject({
        broadcasted: true,
        persistenceStatus: 'pending_reconciliation',
      });
    });

    it('should handle database error during transaction create', async () => {
      mockPrismaClient.transaction.createMany.mockRejectedValueOnce(new Error('Constraint violation'));

      const metadata = {
        recipient,
        amount: 50000,
        fee: 1000,
        utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
        rawTxHex: '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000',
      };

      await expect(
        broadcastAndSave(walletId, undefined, withBroadcastNetwork(metadata))
      ).resolves.toMatchObject({ persistenceStatus: 'pending_reconciliation' });
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
      const result = await broadcastAndSave(walletId, undefined, withBroadcastNetwork(metadata));
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
        broadcastAndSave(walletId, undefined, withBroadcastNetwork(metadata))
      ).rejects.toThrow('Network timeout');
    });

    const retryMetadata = () => withBroadcastNetwork({
      recipient,
      amount: 50000,
      fee: 1000,
      utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
      rawTxHex: createRawTxHex([{ address: recipient, value: 50000 }]),
    });

    it.each([
      ['complete', 'complete'],
      ['accepted', 'pending_reconciliation'],
    ] as const)('returns an idempotent %s claim without rebroadcasting', async (status, persistenceStatus) => {
      mockClaimSigningIntentBroadcast.mockResolvedValueOnce({ status });
      await expect(broadcastAndSave(walletId, undefined, retryMetadata()))
        .resolves.toMatchObject({ persistenceStatus });
      expect(broadcastTransaction).not.toHaveBeenCalled();
    });

    it('retains a durable lease when persisting either failure outcome also fails', async () => {
      (broadcastTransaction as Mock).mockRejectedValueOnce(new DefiniteBroadcastRejectionError('rejected'));
      mockReleaseRejectedSigningIntentBroadcast.mockRejectedValueOnce(new Error('database offline'));
      await expect(broadcastAndSave(walletId, undefined, retryMetadata())).rejects.toThrow('rejected');

      (broadcastTransaction as Mock).mockRejectedValueOnce(new Error('connection lost'));
      mockMarkSigningIntentBroadcastUnknown.mockRejectedValueOnce(new Error('database offline'));
      await expect(broadcastAndSave(walletId, undefined, retryMetadata())).rejects.toThrow('connection lost');
    });

    it('marks a non-accepted node response unknown', async () => {
      (broadcastTransaction as Mock).mockResolvedValueOnce({ txid: 'x', broadcasted: false });
      await expect(broadcastAndSave(walletId, undefined, retryMetadata()))
        .rejects.toThrow('Failed to broadcast transaction');
      expect(mockMarkSigningIntentBroadcastUnknown).toHaveBeenCalled();
    });

    it('returns reconciliation state when completion CAS fails or throws', async () => {
      mockMarkSigningIntentBroadcastComplete.mockResolvedValueOnce(false);
      await expect(broadcastAndSave(walletId, undefined, retryMetadata()))
        .resolves.toMatchObject({ persistenceStatus: 'pending_reconciliation' });
      mockMarkSigningIntentBroadcastComplete.mockRejectedValueOnce(new Error('database offline'));
      await expect(broadcastAndSave(walletId, undefined, retryMetadata()))
        .resolves.toMatchObject({ persistenceStatus: 'pending_reconciliation' });
    });

  });
};
