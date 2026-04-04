/**
 * Insight Service Tests
 *
 * Tests for Treasury Intelligence CRUD operations on AI insights.
 */

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('../../../../src/repositories/intelligenceRepository', () => ({
  intelligenceRepository: {
    createInsight: vi.fn(),
    findInsightById: vi.fn(),
    findInsightsByWallet: vi.fn(),
    findActiveInsights: vi.fn(),
    countActiveInsights: vi.fn(),
    updateInsightStatus: vi.fn(),
    markInsightNotified: vi.fn(),
    findExpiredInsights: vi.fn(),
    expireActiveInsights: vi.fn(),
    deleteExpiredInsights: vi.fn(),
    deleteOldConversations: vi.fn(),
  },
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../../src/utils/errors', () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import { intelligenceRepository } from '../../../../src/repositories/intelligenceRepository';
import {
  createInsight,
  getInsightById,
  getInsightsByWallet,
  getActiveInsights,
  countActiveInsights,
  dismissInsight,
  markActedOn,
  markNotified,
  cleanupExpiredInsights,
} from '../../../../src/services/intelligence/insightService';

describe('Insight Service', () => {
  const now = new Date();

  const mockInsight = {
    id: 'insight-1',
    walletId: 'wallet-1',
    type: 'utxo_health',
    severity: 'warning',
    status: 'active',
    title: 'UTXO Consolidation Recommended',
    summary: 'You have many small UTXOs',
    analysis: 'Detailed analysis',
    data: null,
    expiresAt: null,
    notifiedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createInsight', () => {
    it('should create an insight and return it', async () => {
      (intelligenceRepository.createInsight as Mock).mockResolvedValue(mockInsight);

      const input = {
        walletId: 'wallet-1',
        type: 'utxo_health' as const,
        severity: 'warning' as const,
        title: 'UTXO Consolidation Recommended',
        summary: 'You have many small UTXOs',
        analysis: 'Detailed analysis',
      };

      const result = await createInsight(input);

      expect(result).toEqual(mockInsight);
      expect(intelligenceRepository.createInsight).toHaveBeenCalledWith(input);
    });
  });

  describe('getInsightById', () => {
    it('should return insight when found', async () => {
      (intelligenceRepository.findInsightById as Mock).mockResolvedValue(mockInsight);

      const result = await getInsightById('insight-1');

      expect(result).toEqual(mockInsight);
      expect(intelligenceRepository.findInsightById).toHaveBeenCalledWith('insight-1');
    });

    it('should return null when insight not found', async () => {
      (intelligenceRepository.findInsightById as Mock).mockResolvedValue(null);

      const result = await getInsightById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getInsightsByWallet', () => {
    it('should return insights for wallet', async () => {
      (intelligenceRepository.findInsightsByWallet as Mock).mockResolvedValue([mockInsight]);

      const result = await getInsightsByWallet('wallet-1');

      expect(result).toEqual([mockInsight]);
      expect(intelligenceRepository.findInsightsByWallet).toHaveBeenCalledWith(
        'wallet-1',
        undefined,
        undefined,
        undefined
      );
    });

    it('should pass filters, limit, and offset through', async () => {
      (intelligenceRepository.findInsightsByWallet as Mock).mockResolvedValue([]);

      const filters = { type: 'fee_timing' as const, severity: 'info' as const };
      await getInsightsByWallet('wallet-1', filters, 10, 5);

      expect(intelligenceRepository.findInsightsByWallet).toHaveBeenCalledWith(
        'wallet-1',
        filters,
        10,
        5
      );
    });
  });

  describe('getActiveInsights', () => {
    it('should return active insights for wallet', async () => {
      (intelligenceRepository.findActiveInsights as Mock).mockResolvedValue([mockInsight]);

      const result = await getActiveInsights('wallet-1');

      expect(result).toEqual([mockInsight]);
      expect(intelligenceRepository.findActiveInsights).toHaveBeenCalledWith('wallet-1');
    });
  });

  describe('countActiveInsights', () => {
    it('should return count of active insights', async () => {
      (intelligenceRepository.countActiveInsights as Mock).mockResolvedValue(3);

      const result = await countActiveInsights('wallet-1');

      expect(result).toBe(3);
      expect(intelligenceRepository.countActiveInsights).toHaveBeenCalledWith('wallet-1');
    });
  });

  describe('dismissInsight', () => {
    it('should update insight status to dismissed', async () => {
      const dismissed = { ...mockInsight, status: 'dismissed' };
      (intelligenceRepository.updateInsightStatus as Mock).mockResolvedValue(dismissed);

      const result = await dismissInsight('insight-1');

      expect(result).toEqual(dismissed);
      expect(intelligenceRepository.updateInsightStatus).toHaveBeenCalledWith('insight-1', 'dismissed');
    });
  });

  describe('markActedOn', () => {
    it('should update insight status to acted_on', async () => {
      const actedOn = { ...mockInsight, status: 'acted_on' };
      (intelligenceRepository.updateInsightStatus as Mock).mockResolvedValue(actedOn);

      const result = await markActedOn('insight-1');

      expect(result).toEqual(actedOn);
      expect(intelligenceRepository.updateInsightStatus).toHaveBeenCalledWith('insight-1', 'acted_on');
    });
  });

  describe('markNotified', () => {
    it('should call markInsightNotified on repository', async () => {
      (intelligenceRepository.markInsightNotified as Mock).mockResolvedValue(undefined);

      await markNotified('insight-1');

      expect(intelligenceRepository.markInsightNotified).toHaveBeenCalledWith('insight-1');
    });
  });

  describe('cleanupExpiredInsights', () => {
    it('should expire active insights, delete old ones, and clean up conversations', async () => {
      (intelligenceRepository.expireActiveInsights as Mock).mockResolvedValue(2);
      (intelligenceRepository.deleteExpiredInsights as Mock).mockResolvedValue(5);
      (intelligenceRepository.deleteOldConversations as Mock).mockResolvedValue(3);

      const result = await cleanupExpiredInsights(90);

      // 2 expired + 5 deleted = 7
      expect(result).toBe(7);
      expect(intelligenceRepository.expireActiveInsights).toHaveBeenCalled();
      expect(intelligenceRepository.deleteExpiredInsights).toHaveBeenCalledWith(expect.any(Date));
      expect(intelligenceRepository.deleteOldConversations).toHaveBeenCalledWith(expect.any(Date));
    });

    it('should return 0 when nothing to clean up', async () => {
      (intelligenceRepository.expireActiveInsights as Mock).mockResolvedValue(0);
      (intelligenceRepository.deleteExpiredInsights as Mock).mockResolvedValue(0);
      (intelligenceRepository.deleteOldConversations as Mock).mockResolvedValue(0);

      const result = await cleanupExpiredInsights();

      expect(result).toBe(0);
    });

    it('should return 0 and log error when repository throws', async () => {
      (intelligenceRepository.findExpiredInsights as Mock).mockRejectedValue(
        new Error('Database connection lost')
      );

      const result = await cleanupExpiredInsights();

      expect(result).toBe(0);
    });
  });
});
