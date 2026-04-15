import { describe, expect, it } from 'vitest';

import { mockPrismaClient } from '../../../mocks/prisma';
import {
  ADDRESS_1,
  ADDRESS_2,
  ADDRESS_3,
  createTestUtxo,
  getRecommendedStrategy,
  selectUtxos,
  WALLET_ID,
} from './coinControlIntegrationTestHarness';

export const registerCoinControlOptimizationEdgeContracts = () => {
  describe('Fee Optimization', () => {
    it('should minimize fees with efficiency strategy in high-fee environment', async () => {
      const utxos = [
        createTestUtxo({
          id: 'large',
          amount: BigInt(500000),
          confirmations: 10,
        }),
        createTestUtxo({
          id: 'small-1',
          amount: BigInt(20000),
          confirmations: 100,
          txid: 'b'.repeat(64),
        }),
        createTestUtxo({
          id: 'small-2',
          amount: BigInt(20000),
          confirmations: 100,
          txid: 'c'.repeat(64),
        }),
        createTestUtxo({
          id: 'small-3',
          amount: BigInt(20000),
          confirmations: 100,
          txid: 'd'.repeat(64),
        }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const efficiencyResult = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 100,
        strategy: 'efficiency',
      });

      expect(efficiencyResult.inputCount).toBe(1);
      expect(efficiencyResult.selected[0].id).toBe('large');
    });

    it('should consolidate in low-fee environment', async () => {
      const utxos = Array.from({ length: 20 }, (_, i) =>
        createTestUtxo({
          id: `small-${i}`,
          amount: BigInt(10000),
          txid: `${i}`.padStart(64, '0'),
        }),
      );

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const recommendation = getRecommendedStrategy(21, 2);

      expect(recommendation.strategy).toBe('smallest_first');
      expect(recommendation.reason).toContain('consolidate');
    });
  });

  describe('Strategy Recommendations', () => {
    it('should recommend privacy strategy when explicitly requested', () => {
      const result = getRecommendedStrategy(10, 20, true);

      expect(result.strategy).toBe('privacy');
    });

    it('should recommend efficiency for high fees', () => {
      const result = getRecommendedStrategy(10, 100);

      expect(result.strategy).toBe('efficiency');
    });

    it('should recommend consolidation for low fees with many UTXOs', () => {
      const result = getRecommendedStrategy(50, 2);

      expect(result.strategy).toBe('smallest_first');
    });

    it('should default to efficiency for normal conditions', () => {
      const result = getRecommendedStrategy(5, 20);

      expect(result.strategy).toBe('efficiency');
    });
  });

  describe('Edge Cases', () => {
    describe('Confirmation Filtering', () => {
      it('should exclude unconfirmed UTXOs when required', async () => {
        const utxos = [
          createTestUtxo({
            id: 'confirmed',
            confirmations: 3,
            amount: BigInt(50000),
          }),
          createTestUtxo({
            id: 'unconfirmed',
            confirmations: 0,
            amount: BigInt(500000),
            txid: 'b'.repeat(64),
          }),
        ];

        mockPrismaClient.uTXO.findMany.mockResolvedValue(
          utxos.filter(u => u.confirmations > 0),
        );

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(40000),
          feeRate: 10,
          strategy: 'efficiency',
          excludeUnconfirmed: true,
        });

        expect(result.selected.every(u => u.id !== 'unconfirmed')).toBe(true);
      });
    });

    describe('Specific UTXO Exclusion', () => {
      it('should exclude specific UTXOs by ID', async () => {
        const utxos = [
          createTestUtxo({ id: 'exclude-me', amount: BigInt(1000000) }),
          createTestUtxo({ id: 'use-me', amount: BigInt(100000), txid: 'b'.repeat(64) }),
        ];

        mockPrismaClient.uTXO.findMany.mockResolvedValue(
          utxos.filter(u => u.id !== 'exclude-me'),
        );

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 10,
          strategy: 'efficiency',
          excludeUtxoIds: ['exclude-me'],
        });

        expect(result.selected.every(u => u.id !== 'exclude-me')).toBe(true);
      });
    });

    describe('Script Type Fee Calculation', () => {
      it('should calculate different fees for different script types', async () => {
        const utxos = [createTestUtxo({ amount: BigInt(100000) })];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const segwitResult = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 10,
          strategy: 'efficiency',
          scriptType: 'native_segwit',
        });

        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const legacyResult = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 10,
          strategy: 'efficiency',
          scriptType: 'legacy',
        });

        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const taprootResult = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 10,
          strategy: 'efficiency',
          scriptType: 'taproot',
        });

        expect(Number(legacyResult.estimatedFee)).toBeGreaterThan(Number(segwitResult.estimatedFee));
        expect(Number(segwitResult.estimatedFee)).toBeGreaterThanOrEqual(Number(taprootResult.estimatedFee));
      });
    });

    describe('Change Output Handling', () => {
      it('should include change when above dust threshold', async () => {
        const utxos = [createTestUtxo({ amount: BigInt(100000) })];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 10,
          strategy: 'efficiency',
        });

        expect(Number(result.changeAmount)).toBeGreaterThan(546);
      });

      it('should handle near-exact amount (minimal/no change)', async () => {
        const utxos = [createTestUtxo({ amount: BigInt(50500) })];
        mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

        const result = await selectUtxos({
          walletId: WALLET_ID,
          targetAmount: BigInt(50000),
          feeRate: 1,
          strategy: 'efficiency',
        });

        expect(Number(result.changeAmount)).toBeLessThan(1000);
      });
    });
  });

  describe('Real-World Scenarios', () => {
    it('should handle typical payment scenario', async () => {
      const utxos = [
        createTestUtxo({
          id: 'change-1',
          address: ADDRESS_1,
          amount: BigInt(45000),
          confirmations: 50,
          txid: 'a'.repeat(64),
        }),
        createTestUtxo({
          id: 'exchange',
          address: ADDRESS_2,
          amount: BigInt(50_000_000),
          confirmations: 100,
          txid: 'b'.repeat(64),
        }),
        createTestUtxo({
          id: 'change-2',
          address: ADDRESS_3,
          amount: BigInt(32000),
          confirmations: 30,
          txid: 'c'.repeat(64),
        }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(100000),
        feeRate: 20,
        strategy: 'efficiency',
      });

      expect(result.selected.length).toBeGreaterThan(0);
      expect(Number(result.totalAmount)).toBeGreaterThanOrEqual(100000);
    });

    it('should handle consolidation scenario', async () => {
      const utxos = Array.from({ length: 15 }, (_, i) =>
        createTestUtxo({
          id: `small-${i}`,
          address: `tb1q${'x'.repeat(38)}${i.toString().padStart(2, '0')}`,
          amount: BigInt(10000 + i * 1000),
          confirmations: 100 - i,
          txid: `${i}`.padEnd(64, '0'),
        }),
      );

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(100000),
        feeRate: 1,
        strategy: 'smallest_first',
      });

      expect(result.inputCount).toBeGreaterThan(1);
    });

    it('should handle privacy-focused send', async () => {
      const sharedTxid = 'shared'.padEnd(64, '0');
      const utxos = [
        createTestUtxo({
          id: 'linked-1',
          txid: sharedTxid,
          vout: 0,
          address: ADDRESS_1,
          amount: BigInt(80000),
        }),
        createTestUtxo({
          id: 'linked-2',
          txid: sharedTxid,
          vout: 1,
          address: ADDRESS_2,
          amount: BigInt(70000),
        }),
        createTestUtxo({
          id: 'separate',
          txid: 'other'.padEnd(64, '0'),
          vout: 0,
          address: ADDRESS_3,
          amount: BigInt(200000),
        }),
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(100000),
        feeRate: 10,
        strategy: 'privacy',
      });

      expect(result.privacyImpact).toBeDefined();
      expect(result.privacyImpact!.score).toBeGreaterThan(0);
    });
  });
};
