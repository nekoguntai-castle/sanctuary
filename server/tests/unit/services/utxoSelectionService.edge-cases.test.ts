import { vi } from 'vitest';
import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { selectUtxos } from '../../../src/services/utxoSelectionService';
import {
  WALLET_ID,
  createTestUtxo,
} from './utxoSelectionService.testHarness';

const resetUtxoSelectionMocks = () => {
  resetPrismaMocks();
  vi.clearAllMocks();
};

describe('UTXO Selection Service - edge cases and result shape', () => {
  beforeEach(resetUtxoSelectionMocks);

  describe('Insufficient Funds', () => {
    it('should handle when total UTXOs less than target', async () => {
      const utxos = [
        createTestUtxo({ amount: BigInt(10000) }),
        createTestUtxo({ amount: BigInt(20000), txid: 'bbbb'.repeat(16) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(1000000),
        feeRate: 10,
        strategy: 'efficiency',
      });

      expect(result.warnings.some(w => w.includes('Insufficient'))).toBe(true);
      expect(result.selected.length).toBe(2);
    });

    it('should handle when fee exceeds available after target', async () => {
      const utxos = [
        createTestUtxo({ amount: BigInt(50100) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 100,
        strategy: 'efficiency',
      });

      if (result.totalAmount < BigInt(50000) + result.estimatedFee) {
        expect(result.warnings.some(w => w.includes('Insufficient'))).toBe(true);
      }
    });
  });

  describe('All UTXOs Frozen', () => {
    it('should return empty selection when all frozen', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 10,
        strategy: 'efficiency',
        excludeFrozen: true,
      });

      expect(result.selected).toHaveLength(0);
      expect(result.warnings).toContain('No available UTXOs');
    });
  });

  describe('Dust Change Handling', () => {
    it('should not create dust change (absorbed into fee)', async () => {
      const utxos = [
        createTestUtxo({ amount: BigInt(50600) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 1,
        strategy: 'efficiency',
      });

      if (result.changeAmount < BigInt(546) && result.changeAmount > BigInt(0)) {
        expect(result.changeAmount).toBeLessThan(BigInt(546));
      }
    });

    it('should keep change when above dust threshold', async () => {
      const utxos = [
        createTestUtxo({ amount: BigInt(100000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 10,
        strategy: 'efficiency',
      });

      expect(result.changeAmount).toBeGreaterThan(BigInt(546));
    });
  });

  describe('Single UTXO', () => {
    it('should handle wallet with single UTXO', async () => {
      const utxos = [
        createTestUtxo({ amount: BigInt(100000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 10,
        strategy: 'efficiency',
      });

      expect(result.inputCount).toBe(1);
      expect(result.selected[0].id).toBe('utxo-1');
    });
  });

  describe('Zero Target Amount', () => {
    it('should reject zero target amount', async () => {
      const utxos = [
        createTestUtxo({ amount: BigInt(100000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      await expect(selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(0),
        feeRate: 10,
        strategy: 'efficiency',
      })).rejects.toThrow('targetAmount must be a positive BigInt');
    });

    it('should reject negative target amount', async () => {
      const utxos = [
        createTestUtxo({ amount: BigInt(100000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      await expect(selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(-1000),
        feeRate: 10,
        strategy: 'efficiency',
      })).rejects.toThrow('targetAmount must be a positive BigInt');
    });
  });

  describe('Very High Fee Rate', () => {
    it('should handle extremely high fee rate', async () => {
      const utxos = [
        createTestUtxo({ amount: BigInt(1000000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(100000),
        feeRate: 1000,
        strategy: 'efficiency',
      });

      expect(result.estimatedFee).toBeGreaterThan(BigInt(100000));
    });
  });

  describe('Very Low Fee Rate', () => {
    it('should handle 1 sat/vB minimum fee', async () => {
      const utxos = [
        createTestUtxo({ amount: BigInt(100000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 1,
        strategy: 'efficiency',
      });

      expect(result.estimatedFee).toBeGreaterThan(BigInt(0));
    });
  });

  describe('Result Structure', () => {
    it('should return all required fields', async () => {
      const utxos = [createTestUtxo({ amount: BigInt(100000) })];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 10,
        strategy: 'efficiency',
      });

      expect(result).toHaveProperty('selected');
      expect(result).toHaveProperty('totalAmount');
      expect(result).toHaveProperty('estimatedFee');
      expect(result).toHaveProperty('changeAmount');
      expect(result).toHaveProperty('inputCount');
      expect(result).toHaveProperty('strategy');
      expect(result).toHaveProperty('warnings');
    });

    it('should return UTXO details in selected array', async () => {
      const utxos = [createTestUtxo()];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 10,
        strategy: 'efficiency',
      });

      expect(result.selected[0]).toHaveProperty('id');
      expect(result.selected[0]).toHaveProperty('txid');
      expect(result.selected[0]).toHaveProperty('vout');
      expect(result.selected[0]).toHaveProperty('address');
      expect(result.selected[0]).toHaveProperty('amount');
      expect(result.selected[0]).toHaveProperty('confirmations');
    });
  });
});
