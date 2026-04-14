import { describe, expect, it, beforeEach } from 'vitest';

import { mockPrismaClient } from '../../../../mocks/prisma';
import { mockElectrumClient, createMockTransaction } from '../../../../mocks/electrum';
import { sampleUtxos, testnetAddresses, sampleTransactions } from '../../../../fixtures/bitcoin';
import './advancedTxTestHarness';
import {
  calculateCPFPFee,
  createCPFPTransaction,
} from '../../../../../src/services/bitcoin/advancedTx';

export function registerCpfpContracts() {
  describe('CPFP Fee Calculation', () => {
    it('should calculate correct child fee for target package rate', () => {
      const parentTxSize = 200; // vBytes
      const parentFeeRate = 5; // sat/vB
      const childTxSize = 140; // vBytes (1 in, 1 out native segwit)
      const targetFeeRate = 20; // sat/vB

      const result = calculateCPFPFee(
        parentTxSize,
        parentFeeRate,
        childTxSize,
        targetFeeRate
      );

      // Parent fee = 200 * 5 = 1000 sats
      // Total needed = (200 + 140) * 20 = 6800 sats
      // Child fee = 6800 - 1000 = 5800 sats
      expect(result.childFee).toBe(5800);
      expect(result.totalFee).toBe(6800);
      expect(result.totalSize).toBe(340);
      expect(result.effectiveFeeRate).toBe(20);
    });

    it('should calculate correct child fee rate', () => {
      const parentTxSize = 150;
      const parentFeeRate = 2;
      const childTxSize = 100;
      const targetFeeRate = 10;

      const result = calculateCPFPFee(
        parentTxSize,
        parentFeeRate,
        childTxSize,
        targetFeeRate
      );

      // Child fee rate should be higher than target to bring package average up
      expect(result.childFeeRate).toBeGreaterThan(targetFeeRate);
    });
  });

  describe('CPFP Transaction Creation', () => {
    // Use valid hex txid (not 'p' which is invalid hex)
    const parentTxid = 'c'.repeat(64);
    const parentVout = 0;
    const walletId = 'test-wallet-id';
    const recipientAddress = testnetAddresses.nativeSegwit[0];

    beforeEach(() => {
      // Mock parent UTXO
      mockPrismaClient.uTXO.findUnique.mockResolvedValue({
        ...sampleUtxos[0],
        txid: parentTxid,
        vout: parentVout,
        walletId,
        spent: false,
      });
    });

    it('should throw error if UTXO not found', async () => {
      mockPrismaClient.uTXO.findUnique.mockResolvedValue(null);

      await expect(
        createCPFPTransaction(parentTxid, parentVout, 30, recipientAddress, walletId, 'testnet')
      ).rejects.toThrow('UTXO not found');
    });

    it('should throw error if UTXO already spent', async () => {
      // Mock UTXO that is already spent
      mockPrismaClient.uTXO.findUnique.mockResolvedValue({
        txid: parentTxid,
        vout: parentVout,
        amount: BigInt(50000),
        scriptPubKey: '0014' + 'a'.repeat(40),
        walletId,
        spent: true, // Already spent!
      });

      await expect(
        createCPFPTransaction(parentTxid, parentVout, 30, recipientAddress, walletId, 'testnet')
      ).rejects.toThrow('already spent');
    });

    it('should throw error if UTXO value insufficient for fee', async () => {
      // UTXO with very small value
      mockPrismaClient.uTXO.findUnique.mockResolvedValue({
        txid: parentTxid,
        vout: parentVout,
        amount: BigInt(100), // Only 100 sats
        scriptPubKey: '0014' + 'a'.repeat(40),
        walletId,
        spent: false,
      });

      const parentTx = createMockTransaction({ txid: parentTxid });
      parentTx.hex = sampleTransactions.rbfEnabled;

      mockElectrumClient.getTransaction
        .mockResolvedValueOnce(parentTx)
        .mockResolvedValueOnce({ vout: [{ value: 0.0001, scriptPubKey: { hex: '0014cc' } }] });

      await expect(
        createCPFPTransaction(parentTxid, parentVout, 100, recipientAddress, walletId, 'testnet')
      ).rejects.toThrow('insufficient');
    });

    it('should create CPFP PSBT for a spendable parent output', async () => {
      mockPrismaClient.uTXO.findUnique.mockResolvedValue({
        txid: parentTxid,
        vout: parentVout,
        amount: BigInt(50000),
        scriptPubKey: '0014' + 'a'.repeat(40),
        walletId,
        spent: false,
      });

      const parentTx = createMockTransaction({ txid: parentTxid });
      parentTx.hex = sampleTransactions.rbfEnabled;

      mockElectrumClient.getTransaction
        .mockResolvedValueOnce(parentTx)
        .mockResolvedValueOnce({ vout: [{ value: 0.000001, scriptPubKey: { hex: '0014cc' } }] });

      const result = await createCPFPTransaction(
        parentTxid,
        parentVout,
        5,
        recipientAddress,
        walletId,
        'testnet'
      );

      expect(result.psbt).toBeDefined();
      expect(result.childFee).toBeGreaterThan(0);
      expect(result.effectiveFeeRate).toBeGreaterThanOrEqual(5);
    });

    it('should throw when resulting child output would be dust', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValueOnce({
        key: 'dustThreshold',
        value: '1000000000',
      });
      mockPrismaClient.uTXO.findUnique.mockResolvedValueOnce({
        txid: parentTxid,
        vout: parentVout,
        amount: BigInt(50000),
        scriptPubKey: '0014' + 'a'.repeat(40),
        walletId,
        spent: false,
      });

      const parentTx = createMockTransaction({ txid: parentTxid });
      parentTx.hex = sampleTransactions.rbfEnabled;

      mockElectrumClient.getTransaction
        .mockResolvedValueOnce(parentTx)
        .mockResolvedValueOnce({ vout: [{ value: 0.001, scriptPubKey: { hex: '0014cc' } }] });

      await expect(
        createCPFPTransaction(parentTxid, parentVout, 5, recipientAddress, walletId, 'testnet')
      ).rejects.toThrow('Output would be dust');
    });
  });
}
