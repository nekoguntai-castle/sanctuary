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
  ADDRESS_1,
  ADDRESS_2,
  ADDRESS_3,
  WALLET_ID,
  createTestUtxo,
} from './utxoSelectionService.testHarness';

const resetUtxoSelectionMocks = () => {
  resetPrismaMocks();
  vi.clearAllMocks();
};

describe('UTXO Selection Service - selectUtxos', () => {
  beforeEach(resetUtxoSelectionMocks);

  describe('Basic Selection', () => {
    it('should select UTXOs to cover target amount', async () => {
      const utxos = [
        createTestUtxo({ id: 'utxo-1', amount: BigInt(50000) }),
        createTestUtxo({ id: 'utxo-2', amount: BigInt(100000) }),
        createTestUtxo({ id: 'utxo-3', amount: BigInt(200000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(80000),
        feeRate: 10,
        strategy: 'efficiency',
      });

      expect(result.selected.length).toBeGreaterThan(0);
      expect(result.totalAmount).toBeGreaterThanOrEqual(BigInt(80000));
      expect(result.estimatedFee).toBeGreaterThan(BigInt(0));
    });

    it('should return empty selection when no UTXOs available', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 10,
        strategy: 'efficiency',
      });

      expect(result.selected).toHaveLength(0);
      expect(result.totalAmount).toBe(BigInt(0));
      expect(result.warnings).toContain('No available UTXOs');
    });

    it('should warn when insufficient funds', async () => {
      const utxos = [
        createTestUtxo({ id: 'utxo-1', amount: BigInt(10000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(1000000),
        feeRate: 10,
        strategy: 'efficiency',
      });

      expect(result.warnings.some(w => w.includes('Insufficient'))).toBe(true);
    });

    it('should calculate change amount correctly', async () => {
      const utxos = [
        createTestUtxo({ id: 'utxo-1', amount: BigInt(100000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 10,
        strategy: 'efficiency',
      });

      expect(result.changeAmount).toBe(
        result.totalAmount - BigInt(50000) - result.estimatedFee
      );
    });

    it('should not return negative change', async () => {
      const utxos = [
        createTestUtxo({ id: 'utxo-1', amount: BigInt(50100) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 10,
        strategy: 'efficiency',
      });

      expect(result.changeAmount).toBeGreaterThanOrEqual(BigInt(0));
    });

    it('maps null blockHeight to undefined in selected results', async () => {
      const utxos = [
        createTestUtxo({ id: 'utxo-null-height', blockHeight: null, amount: BigInt(100000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 10,
        strategy: 'efficiency',
      });

      expect(result.selected[0].id).toBe('utxo-null-height');
      expect(result.selected[0].blockHeight).toBeUndefined();
    });
  });

  describe('Filter Options', () => {
    it('should exclude frozen UTXOs by default', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

      await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 10,
        strategy: 'efficiency',
      });

      expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            frozen: false,
          }),
        })
      );
    });

    it('should include frozen UTXOs when excludeFrozen is false', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

      await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 10,
        strategy: 'efficiency',
        excludeFrozen: false,
      });

      expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({
            frozen: false,
          }),
        })
      );
    });

    it('should exclude unconfirmed UTXOs when specified', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

      await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 10,
        strategy: 'efficiency',
        excludeUnconfirmed: true,
      });

      expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            confirmations: { gt: 0 },
          }),
        })
      );
    });

    it('should exclude specific UTXO IDs', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

      await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 10,
        strategy: 'efficiency',
        excludeUtxoIds: ['utxo-1', 'utxo-2'],
      });

      expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { notIn: ['utxo-1', 'utxo-2'] },
          }),
        })
      );
    });

    it('should exclude draft-locked UTXOs', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

      await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 10,
        strategy: 'efficiency',
      });

      expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            draftLock: null,
          }),
        })
      );
    });
  });

  describe('Efficiency Strategy (Largest First)', () => {
    it('should select largest UTXOs first', async () => {
      const utxos = [
        createTestUtxo({ id: 'small', amount: BigInt(10000) }),
        createTestUtxo({ id: 'medium', amount: BigInt(50000) }),
        createTestUtxo({ id: 'large', amount: BigInt(200000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(
        [...utxos].sort((a, b) => Number(b.amount - a.amount))
      );

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(100000),
        feeRate: 10,
        strategy: 'efficiency',
      });

      expect(result.selected[0].id).toBe('large');
    });

    it('should minimize input count', async () => {
      const utxos = [
        createTestUtxo({ id: 'large', amount: BigInt(200000) }),
        createTestUtxo({ id: 'small-1', amount: BigInt(10000) }),
        createTestUtxo({ id: 'small-2', amount: BigInt(10000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(
        [...utxos].sort((a, b) => Number(b.amount - a.amount))
      );

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(20000),
        feeRate: 10,
        strategy: 'efficiency',
      });

      expect(result.inputCount).toBe(1);
    });
  });

  describe('Privacy Strategy', () => {
    it('should prefer UTXOs from same transaction', async () => {
      const sameTxid = 'aaaa'.repeat(16);
      const utxos = [
        createTestUtxo({ id: 'tx1-0', txid: sameTxid, vout: 0, amount: BigInt(50000), address: ADDRESS_1 }),
        createTestUtxo({ id: 'tx1-1', txid: sameTxid, vout: 1, amount: BigInt(50000), address: ADDRESS_2 }),
        createTestUtxo({ id: 'tx2-0', txid: 'bbbb'.repeat(16), vout: 0, amount: BigInt(200000), address: ADDRESS_3 }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(80000),
        feeRate: 10,
        strategy: 'privacy',
      });

      expect(result.selected.length).toBeGreaterThan(0);
      expect(result.strategy).toBe('privacy');
    });

    it('should prefer UTXOs with same address', async () => {
      const utxos = [
        createTestUtxo({ id: 'addr1-1', address: ADDRESS_1, amount: BigInt(50000) }),
        createTestUtxo({ id: 'addr1-2', address: ADDRESS_1, amount: BigInt(60000) }),
        createTestUtxo({ id: 'addr2-1', address: ADDRESS_2, amount: BigInt(200000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(80000),
        feeRate: 10,
        strategy: 'privacy',
      });

      expect(result.privacyImpact).toBeDefined();
      expect(result.privacyImpact!.linkedAddresses).toBeGreaterThanOrEqual(1);
    });

    it('should warn about multi-address spending', async () => {
      const utxos = [
        createTestUtxo({ id: 'addr1', address: ADDRESS_1, amount: BigInt(30000) }),
        createTestUtxo({ id: 'addr2', address: ADDRESS_2, amount: BigInt(30000) }),
        createTestUtxo({ id: 'addr3', address: ADDRESS_3, amount: BigInt(30000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(80000),
        feeRate: 10,
        strategy: 'privacy',
      });

      if (result.privacyImpact && result.privacyImpact.linkedAddresses > 1) {
        expect(result.warnings.some(w => w.includes('address'))).toBe(true);
      }
    });

    it('should calculate privacy score', async () => {
      const utxos = [
        createTestUtxo({ id: 'utxo-1', amount: BigInt(100000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 10,
        strategy: 'privacy',
      });

      expect(result.privacyImpact).toBeDefined();
      expect(result.privacyImpact!.score).toBeGreaterThanOrEqual(0);
      expect(result.privacyImpact!.score).toBeLessThanOrEqual(100);
    });

    it('should warn when privacy strategy has insufficient funds', async () => {
      const utxos = [
        createTestUtxo({ id: 'tiny-1', amount: BigInt(1000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(100000),
        feeRate: 10,
        strategy: 'privacy',
      });

      expect(result.warnings).toContain('Insufficient funds for this amount');
    });

    it('stops adding remaining privacy UTXOs once target plus fee is met', async () => {
      const utxos = [
        createTestUtxo({ id: 'u-40k', txid: 'aaaa'.repeat(16), amount: BigInt(40000), address: ADDRESS_1 }),
        createTestUtxo({ id: 'u-20k', txid: 'bbbb'.repeat(16), amount: BigInt(20000), address: ADDRESS_2 }),
        createTestUtxo({ id: 'u-15k', txid: 'cccc'.repeat(16), amount: BigInt(15000), address: ADDRESS_3 }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 10,
        strategy: 'privacy',
      });

      expect(result.selected.map(u => u.id)).toEqual(['u-40k', 'u-20k']);
    });

    it('handles equal-amount privacy sorting ties', async () => {
      const utxos = [
        createTestUtxo({ id: 'tie-1', txid: 'aaaa'.repeat(16), amount: BigInt(30000), address: ADDRESS_1 }),
        createTestUtxo({ id: 'tie-2', txid: 'bbbb'.repeat(16), amount: BigInt(30000), address: ADDRESS_2 }),
        createTestUtxo({ id: 'tie-3', txid: 'cccc'.repeat(16), amount: BigInt(30000), address: ADDRESS_3 }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 10,
        strategy: 'privacy',
      });

      expect(result.selected.length).toBeGreaterThan(0);
    });
  });

  describe('Oldest First Strategy', () => {
    it('should select UTXOs with most confirmations first', async () => {
      const utxos = [
        createTestUtxo({ id: 'new', confirmations: 2 }),
        createTestUtxo({ id: 'old', confirmations: 1000 }),
        createTestUtxo({ id: 'medium', confirmations: 50 }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 10,
        strategy: 'oldest_first',
      });

      expect(result.selected[0].confirmations).toBe(1000);
      expect(result.strategy).toBe('oldest_first');
    });

    it('should warn when oldest-first strategy has insufficient funds', async () => {
      const utxos = [
        createTestUtxo({ id: 'old-tiny', confirmations: 999, amount: BigInt(1000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(100000),
        feeRate: 10,
        strategy: 'oldest_first',
      });

      expect(result.warnings).toContain('Insufficient funds for this amount');
    });
  });

  describe('Largest First Strategy', () => {
    it('should behave same as efficiency', async () => {
      const utxos = [
        createTestUtxo({ id: 'small', amount: BigInt(10000) }),
        createTestUtxo({ id: 'large', amount: BigInt(200000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(
        [...utxos].sort((a, b) => Number(b.amount - a.amount))
      );

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 10,
        strategy: 'largest_first',
      });

      expect(result.selected[0].id).toBe('large');
      expect(result.strategy).toBe('largest_first');
    });
  });

  describe('Smallest First Strategy (Consolidation)', () => {
    it('should select smallest UTXOs first', async () => {
      const utxos = [
        createTestUtxo({ id: 'large', amount: BigInt(200000) }),
        createTestUtxo({ id: 'small', amount: BigInt(10000) }),
        createTestUtxo({ id: 'medium', amount: BigInt(50000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 1,
        strategy: 'smallest_first',
      });

      expect(result.selected[0].id).toBe('small');
      expect(result.strategy).toBe('smallest_first');
    });

    it('should warn about many small UTXOs', async () => {
      const utxos = Array.from({ length: 10 }, (_, i) =>
        createTestUtxo({
          id: `small-${i}`,
          amount: BigInt(10000),
          txid: `${'a'.repeat(60)}${i.toString().padStart(4, '0')}`,
        })
      );
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(80000),
        feeRate: 1,
        strategy: 'smallest_first',
      });

      if (result.inputCount > 5) {
        expect(result.warnings.some(w => w.includes('small UTXOs'))).toBe(true);
      }
    });

    it('should warn when smallest-first strategy has insufficient funds', async () => {
      const utxos = [
        createTestUtxo({ id: 'small-insufficient', amount: BigInt(1000) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(100000),
        feeRate: 10,
        strategy: 'smallest_first',
      });

      expect(result.warnings).toContain('Insufficient funds for this amount');
    });
  });

  describe('Fee Calculation', () => {
    it('should estimate fee based on script type', async () => {
      const utxos = [createTestUtxo({ amount: BigInt(100000) })];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const resultSegwit = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 10,
        strategy: 'efficiency',
        scriptType: 'native_segwit',
      });

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const resultLegacy = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 10,
        strategy: 'efficiency',
        scriptType: 'legacy',
      });

      expect(resultLegacy.estimatedFee).toBeGreaterThan(resultSegwit.estimatedFee);
    });

    it('should use native_segwit as default script type', async () => {
      const utxos = [createTestUtxo({ amount: BigInt(100000) })];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 10,
        strategy: 'efficiency',
      });

      expect(result.estimatedFee).toBeGreaterThan(BigInt(0));
    });

    it('should fall back to default input size for unknown script type', async () => {
      const utxos = [createTestUtxo({ amount: BigInt(100000) })];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const resultUnknown = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 10,
        strategy: 'efficiency',
        scriptType: 'unknown_script_type',
      });

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const resultDefault = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(50000),
        feeRate: 10,
        strategy: 'efficiency',
        scriptType: 'native_segwit',
      });

      expect(resultUnknown.estimatedFee).toBe(resultDefault.estimatedFee);
    });

    it('should scale fee with input count', async () => {
      const utxos = [
        createTestUtxo({ id: 'utxo-1', amount: BigInt(50000) }),
        createTestUtxo({ id: 'utxo-2', amount: BigInt(50000), txid: 'bbbb'.repeat(16) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result1 = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(40000),
        feeRate: 10,
        strategy: 'efficiency',
      });

      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const result2 = await selectUtxos({
        walletId: WALLET_ID,
        targetAmount: BigInt(80000),
        feeRate: 10,
        strategy: 'efficiency',
      });

      if (result2.inputCount > result1.inputCount) {
        expect(result2.estimatedFee).toBeGreaterThan(result1.estimatedFee);
      }
    });
  });
});
