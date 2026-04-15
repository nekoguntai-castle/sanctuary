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

import {
  compareStrategies,
  getRecommendedStrategy,
} from '../../../src/services/utxoSelectionService';
import {
  WALLET_ID,
  createTestUtxo,
} from './utxoSelectionService.testHarness';

const resetUtxoSelectionMocks = () => {
  resetPrismaMocks();
  vi.clearAllMocks();
};

describe('UTXO Selection Service - strategy comparison and recommendation', () => {
  beforeEach(resetUtxoSelectionMocks);

  describe('compareStrategies', () => {
    it('should return results for all 5 strategies', async () => {
      const utxos = [
        createTestUtxo({ id: 'utxo-1', amount: BigInt(100000), confirmations: 10 }),
        createTestUtxo({ id: 'utxo-2', amount: BigInt(50000), confirmations: 5, txid: 'bbbb'.repeat(16) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const results = await compareStrategies(
        WALLET_ID,
        BigInt(80000),
        10
      );

      expect(results.privacy).toBeDefined();
      expect(results.efficiency).toBeDefined();
      expect(results.oldest_first).toBeDefined();
      expect(results.largest_first).toBeDefined();
      expect(results.smallest_first).toBeDefined();
    });

    it('should show different results for different strategies', async () => {
      const utxos = [
        createTestUtxo({ id: 'new-large', amount: BigInt(200000), confirmations: 1 }),
        createTestUtxo({ id: 'old-small', amount: BigInt(10000), confirmations: 1000, txid: 'bbbb'.repeat(16) }),
        createTestUtxo({ id: 'medium', amount: BigInt(50000), confirmations: 50, txid: 'cccc'.repeat(16) }),
      ];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const results = await compareStrategies(
        WALLET_ID,
        BigInt(30000),
        10
      );

      expect(results.largest_first.selected[0].id).toBe('new-large');
      expect(results.oldest_first.selected[0].id).toBe('old-small');
    });

    it('should use default script type', async () => {
      const utxos = [createTestUtxo({ amount: BigInt(100000) })];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(utxos);

      const results = await compareStrategies(
        WALLET_ID,
        BigInt(50000),
        10
      );

      Object.values(results).forEach(result => {
        expect(result.estimatedFee).toBeGreaterThan(BigInt(0));
      });
    });
  });

  describe('getRecommendedStrategy', () => {
    it('should recommend privacy when prioritizePrivacy is true', () => {
      const recommendation = getRecommendedStrategy(10, 20, true);

      expect(recommendation.strategy).toBe('privacy');
      expect(recommendation.reason).toContain('privacy');
    });

    it('should recommend efficiency for high fee environment', () => {
      const recommendation = getRecommendedStrategy(10, 100);

      expect(recommendation.strategy).toBe('efficiency');
      expect(recommendation.reason).toContain('fee');
    });

    it('should recommend smallest_first for low fee with many UTXOs', () => {
      const recommendation = getRecommendedStrategy(25, 2);

      expect(recommendation.strategy).toBe('smallest_first');
      expect(recommendation.reason).toContain('consolidate');
    });

    it('should default to efficiency for normal conditions', () => {
      const recommendation = getRecommendedStrategy(5, 20);

      expect(recommendation.strategy).toBe('efficiency');
    });
  });
});
