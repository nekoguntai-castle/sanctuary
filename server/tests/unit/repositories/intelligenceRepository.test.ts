/**
 * Intelligence Repository Tests
 *
 * Tests for Treasury Intelligence data access layer operations
 * including insights, conversations, messages, and analytics helpers.
 */

import { vi, Mock } from 'vitest';

// Mock Prisma before importing repository
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    aIInsight: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    aIConversation: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    aIMessage: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    transaction: {
      groupBy: vi.fn(),
    },
    uTXO: {
      aggregate: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import prisma from '../../../src/models/prisma';
import { intelligenceRepository } from '../../../src/repositories/intelligenceRepository';

describe('Intelligence Repository', () => {
  const now = new Date();

  const mockInsight = {
    id: 'insight-1',
    walletId: 'wallet-1',
    type: 'utxo_health',
    severity: 'warning',
    status: 'active',
    title: 'UTXO Consolidation Recommended',
    summary: 'You have many small UTXOs',
    analysis: 'Detailed analysis here',
    data: null,
    expiresAt: null,
    notifiedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const mockConversation = {
    id: 'conv-1',
    userId: 'user-1',
    walletId: 'wallet-1',
    title: 'Treasury Q&A',
    createdAt: now,
    updatedAt: now,
  };

  const mockMessage = {
    id: 'msg-1',
    conversationId: 'conv-1',
    role: 'user',
    content: 'What is my UTXO health?',
    metadata: null,
    createdAt: now,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================
  // Insights
  // ========================================

  describe('createInsight', () => {
    it('should create an insight with required fields', async () => {
      (prisma.aIInsight.create as Mock).mockResolvedValue(mockInsight);

      const result = await intelligenceRepository.createInsight({
        walletId: 'wallet-1',
        type: 'utxo_health',
        severity: 'warning',
        title: 'UTXO Consolidation Recommended',
        summary: 'You have many small UTXOs',
        analysis: 'Detailed analysis here',
      });

      expect(result).toEqual(mockInsight);
      expect(prisma.aIInsight.create).toHaveBeenCalledWith({
        data: {
          walletId: 'wallet-1',
          type: 'utxo_health',
          severity: 'warning',
          title: 'UTXO Consolidation Recommended',
          summary: 'You have many small UTXOs',
          analysis: 'Detailed analysis here',
          data: undefined,
          expiresAt: null,
        },
      });
    });

    it('should create an insight with optional data and expiresAt', async () => {
      const expiresAt = new Date(Date.now() + 86400000);
      const insightWithData = { ...mockInsight, data: { key: 'value' }, expiresAt };
      (prisma.aIInsight.create as Mock).mockResolvedValue(insightWithData);

      const result = await intelligenceRepository.createInsight({
        walletId: 'wallet-1',
        type: 'fee_timing',
        severity: 'info',
        title: 'Good fee window',
        summary: 'Fees are low',
        analysis: 'Analysis',
        data: { key: 'value' },
        expiresAt,
      });

      expect(result).toEqual(insightWithData);
      expect(prisma.aIInsight.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          data: { key: 'value' },
          expiresAt,
        }),
      });
    });
  });

  describe('findInsightById', () => {
    it('should return insight when found', async () => {
      (prisma.aIInsight.findUnique as Mock).mockResolvedValue(mockInsight);

      const result = await intelligenceRepository.findInsightById('insight-1');

      expect(result).toEqual(mockInsight);
      expect(prisma.aIInsight.findUnique).toHaveBeenCalledWith({ where: { id: 'insight-1' } });
    });

    it('should return null when insight not found', async () => {
      (prisma.aIInsight.findUnique as Mock).mockResolvedValue(null);

      const result = await intelligenceRepository.findInsightById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findInsightsByWallet', () => {
    it('should return insights for wallet without filters', async () => {
      (prisma.aIInsight.findMany as Mock).mockResolvedValue([mockInsight]);

      const result = await intelligenceRepository.findInsightsByWallet('wallet-1');

      expect(result).toEqual([mockInsight]);
      expect(prisma.aIInsight.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-1' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('should apply type filter', async () => {
      (prisma.aIInsight.findMany as Mock).mockResolvedValue([]);

      await intelligenceRepository.findInsightsByWallet('wallet-1', { type: 'fee_timing' });

      expect(prisma.aIInsight.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-1', type: 'fee_timing' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('should apply severity filter', async () => {
      (prisma.aIInsight.findMany as Mock).mockResolvedValue([]);

      await intelligenceRepository.findInsightsByWallet('wallet-1', { severity: 'critical' });

      expect(prisma.aIInsight.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-1', severity: 'critical' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('should apply status filter', async () => {
      (prisma.aIInsight.findMany as Mock).mockResolvedValue([]);

      await intelligenceRepository.findInsightsByWallet('wallet-1', { status: 'dismissed' });

      expect(prisma.aIInsight.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-1', status: 'dismissed' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('should apply all filters and custom limit/offset', async () => {
      (prisma.aIInsight.findMany as Mock).mockResolvedValue([]);

      await intelligenceRepository.findInsightsByWallet(
        'wallet-1',
        { type: 'anomaly', severity: 'warning', status: 'active' },
        10,
        20
      );

      expect(prisma.aIInsight.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-1', type: 'anomaly', severity: 'warning', status: 'active' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        skip: 20,
      });
    });
  });

  describe('findActiveInsights', () => {
    it('should return only active insights for wallet', async () => {
      (prisma.aIInsight.findMany as Mock).mockResolvedValue([mockInsight]);

      const result = await intelligenceRepository.findActiveInsights('wallet-1');

      expect(result).toEqual([mockInsight]);
      expect(prisma.aIInsight.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-1', status: 'active' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('countActiveInsights', () => {
    it('should return count of active insights', async () => {
      (prisma.aIInsight.count as Mock).mockResolvedValue(5);

      const result = await intelligenceRepository.countActiveInsights('wallet-1');

      expect(result).toBe(5);
      expect(prisma.aIInsight.count).toHaveBeenCalledWith({
        where: { walletId: 'wallet-1', status: 'active' },
      });
    });
  });

  describe('updateInsightStatus', () => {
    it('should update insight status', async () => {
      const updated = { ...mockInsight, status: 'dismissed' };
      (prisma.aIInsight.update as Mock).mockResolvedValue(updated);

      const result = await intelligenceRepository.updateInsightStatus('insight-1', 'dismissed');

      expect(result).toEqual(updated);
      expect(prisma.aIInsight.update).toHaveBeenCalledWith({
        where: { id: 'insight-1' },
        data: { status: 'dismissed' },
      });
    });
  });

  describe('markInsightNotified', () => {
    it('should set notifiedAt timestamp', async () => {
      (prisma.aIInsight.update as Mock).mockResolvedValue({ ...mockInsight, notifiedAt: now });

      await intelligenceRepository.markInsightNotified('insight-1');

      expect(prisma.aIInsight.update).toHaveBeenCalledWith({
        where: { id: 'insight-1' },
        data: { notifiedAt: expect.any(Date) },
      });
    });
  });

  describe('findExpiredInsights', () => {
    it('should return active insights with expired dates', async () => {
      const expired = { ...mockInsight, expiresAt: new Date(Date.now() - 10000) };
      (prisma.aIInsight.findMany as Mock).mockResolvedValue([expired]);

      const result = await intelligenceRepository.findExpiredInsights();

      expect(result).toEqual([expired]);
      expect(prisma.aIInsight.findMany).toHaveBeenCalledWith({
        where: {
          status: 'active',
          expiresAt: { lte: expect.any(Date) },
        },
      });
    });
  });

  describe('expireActiveInsights', () => {
    it('should expire active insights with expired dates and return count', async () => {
      (prisma.aIInsight.updateMany as Mock).mockResolvedValue({ count: 4 });

      const result = await intelligenceRepository.expireActiveInsights();

      expect(result).toBe(4);
      expect(prisma.aIInsight.updateMany).toHaveBeenCalledWith({
        where: { status: 'active', expiresAt: { lte: expect.any(Date) } },
        data: { status: 'expired' },
      });
    });
  });

  describe('deleteExpiredInsights', () => {
    it('should delete old dismissed/expired insights and return count', async () => {
      (prisma.aIInsight.deleteMany as Mock).mockResolvedValue({ count: 3 });
      const cutoff = new Date(Date.now() - 86400000 * 90);

      const result = await intelligenceRepository.deleteExpiredInsights(cutoff);

      expect(result).toBe(3);
      expect(prisma.aIInsight.deleteMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { status: { in: ['dismissed', 'acted_on', 'expired'] }, updatedAt: { lt: cutoff } },
            { expiresAt: { lte: expect.any(Date) }, status: 'active' },
          ],
        },
      });
    });
  });

  describe('deleteInsightsByWallet', () => {
    it('should delete all insights for a wallet and return count', async () => {
      (prisma.aIInsight.deleteMany as Mock).mockResolvedValue({ count: 7 });

      const result = await intelligenceRepository.deleteInsightsByWallet('wallet-1');

      expect(result).toBe(7);
      expect(prisma.aIInsight.deleteMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-1' },
      });
    });
  });

  // ========================================
  // Conversations
  // ========================================

  describe('createConversation', () => {
    it('should create a conversation with userId and walletId', async () => {
      (prisma.aIConversation.create as Mock).mockResolvedValue(mockConversation);

      const result = await intelligenceRepository.createConversation({
        userId: 'user-1',
        walletId: 'wallet-1',
      });

      expect(result).toEqual(mockConversation);
      expect(prisma.aIConversation.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          walletId: 'wallet-1',
          title: null,
        },
      });
    });

    it('should create a conversation with null walletId and title', async () => {
      const conv = { ...mockConversation, walletId: null, title: null };
      (prisma.aIConversation.create as Mock).mockResolvedValue(conv);

      const result = await intelligenceRepository.createConversation({
        userId: 'user-1',
      });

      expect(result).toEqual(conv);
      expect(prisma.aIConversation.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          walletId: null,
          title: null,
        },
      });
    });
  });

  describe('findConversationById', () => {
    it('should return conversation when found', async () => {
      (prisma.aIConversation.findUnique as Mock).mockResolvedValue(mockConversation);

      const result = await intelligenceRepository.findConversationById('conv-1');

      expect(result).toEqual(mockConversation);
      expect(prisma.aIConversation.findUnique).toHaveBeenCalledWith({ where: { id: 'conv-1' } });
    });

    it('should return null when conversation not found', async () => {
      (prisma.aIConversation.findUnique as Mock).mockResolvedValue(null);

      const result = await intelligenceRepository.findConversationById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findConversationsByUser', () => {
    it('should return conversations ordered by updatedAt desc with defaults', async () => {
      (prisma.aIConversation.findMany as Mock).mockResolvedValue([mockConversation]);

      const result = await intelligenceRepository.findConversationsByUser('user-1');

      expect(result).toEqual([mockConversation]);
      expect(prisma.aIConversation.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { updatedAt: 'desc' },
        take: 20,
        skip: 0,
      });
    });

    it('should accept custom limit and offset', async () => {
      (prisma.aIConversation.findMany as Mock).mockResolvedValue([]);

      await intelligenceRepository.findConversationsByUser('user-1', 5, 10);

      expect(prisma.aIConversation.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        skip: 10,
      });
    });
  });

  describe('updateConversationTitle', () => {
    it('should update the conversation title', async () => {
      const updated = { ...mockConversation, title: 'New Title' };
      (prisma.aIConversation.update as Mock).mockResolvedValue(updated);

      const result = await intelligenceRepository.updateConversationTitle('conv-1', 'New Title');

      expect(result).toEqual(updated);
      expect(prisma.aIConversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: { title: 'New Title' },
      });
    });
  });

  describe('deleteConversation', () => {
    it('should delete the conversation', async () => {
      (prisma.aIConversation.delete as Mock).mockResolvedValue(mockConversation);

      await intelligenceRepository.deleteConversation('conv-1');

      expect(prisma.aIConversation.delete).toHaveBeenCalledWith({ where: { id: 'conv-1' } });
    });
  });

  describe('deleteOldConversations', () => {
    it('should delete conversations older than cutoff and return count', async () => {
      (prisma.aIConversation.deleteMany as Mock).mockResolvedValue({ count: 2 });
      const cutoff = new Date(Date.now() - 86400000 * 90);

      const result = await intelligenceRepository.deleteOldConversations(cutoff);

      expect(result).toBe(2);
      expect(prisma.aIConversation.deleteMany).toHaveBeenCalledWith({
        where: { updatedAt: { lt: cutoff } },
      });
    });
  });

  // ========================================
  // Messages
  // ========================================

  describe('addMessage', () => {
    it('should create message within a transaction and touch conversation updatedAt', async () => {
      (prisma.$transaction as Mock).mockResolvedValue([mockMessage, mockConversation]);

      const result = await intelligenceRepository.addMessage({
        conversationId: 'conv-1',
        role: 'user',
        content: 'What is my UTXO health?',
      });

      expect(result).toEqual(mockMessage);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // The source passes an array of two Prisma promises to $transaction.
      // Because the mocked create/update return promises (vi.fn() returns undefined),
      // the array will contain the results of calling the mocked functions.
      expect(prisma.aIMessage.create).toHaveBeenCalledWith({
        data: {
          conversationId: 'conv-1',
          role: 'user',
          content: 'What is my UTXO health?',
          metadata: undefined,
        },
      });
      expect(prisma.aIConversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: { updatedAt: expect.any(Date) },
      });
    });

    it('should include metadata when provided', async () => {
      const msgWithMeta = { ...mockMessage, metadata: { tokens: 42 } };
      (prisma.$transaction as Mock).mockResolvedValue([msgWithMeta, mockConversation]);

      const result = await intelligenceRepository.addMessage({
        conversationId: 'conv-1',
        role: 'assistant',
        content: 'Your UTXO health is good',
        metadata: { tokens: 42 },
      });

      expect(result).toEqual(msgWithMeta);
      expect(prisma.aIMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: { tokens: 42 },
        }),
      });
    });
  });

  describe('getMessages', () => {
    it('should return messages ordered by createdAt asc with default limit', async () => {
      (prisma.aIMessage.findMany as Mock).mockResolvedValue([mockMessage]);

      const result = await intelligenceRepository.getMessages('conv-1');

      expect(result).toEqual([mockMessage]);
      expect(prisma.aIMessage.findMany).toHaveBeenCalledWith({
        where: { conversationId: 'conv-1' },
        orderBy: { createdAt: 'asc' },
        take: 100,
      });
    });

    it('should accept custom limit', async () => {
      (prisma.aIMessage.findMany as Mock).mockResolvedValue([]);

      await intelligenceRepository.getMessages('conv-1', 20);

      expect(prisma.aIMessage.findMany).toHaveBeenCalledWith({
        where: { conversationId: 'conv-1' },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });
    });
  });

  // ========================================
  // Analytics helpers
  // ========================================

  describe('getTransactionVelocity', () => {
    it('should return transaction velocity grouped by type', async () => {
      (prisma.transaction.groupBy as Mock).mockResolvedValue([
        { type: 'sent', _count: { _all: 15 }, _sum: { amount: BigInt(500000) } },
      ]);

      const result = await intelligenceRepository.getTransactionVelocity('wallet-1', 30);

      expect(result).toEqual([
        { period: '30d', count: 15, totalSats: BigInt(500000) },
      ]);
      expect(prisma.transaction.groupBy).toHaveBeenCalledWith({
        by: ['type'],
        where: {
          walletId: 'wallet-1',
          blockTime: { gte: expect.any(Date) },
          type: 'sent',
        },
        _count: { _all: true },
        _sum: { amount: true },
      });
    });

    it('should return zero totalSats when _sum.amount is null', async () => {
      (prisma.transaction.groupBy as Mock).mockResolvedValue([
        { type: 'sent', _count: { _all: 0 }, _sum: { amount: null } },
      ]);

      const result = await intelligenceRepository.getTransactionVelocity('wallet-1', 7);

      expect(result).toEqual([
        { period: '7d', count: 0, totalSats: BigInt(0) },
      ]);
    });

    it('should return empty array when no transactions', async () => {
      (prisma.transaction.groupBy as Mock).mockResolvedValue([]);

      const result = await intelligenceRepository.getTransactionVelocity('wallet-1', 1);

      expect(result).toEqual([]);
    });
  });

  describe('getUtxoAgeDistribution', () => {
    it('should return short-term and long-term UTXO distribution', async () => {
      (prisma.uTXO.aggregate as Mock)
        .mockResolvedValueOnce({ _count: { id: 10 }, _sum: { amount: BigInt(300000) } })
        .mockResolvedValueOnce({ _count: { id: 5 }, _sum: { amount: BigInt(700000) } });

      const result = await intelligenceRepository.getUtxoAgeDistribution('wallet-1');

      expect(result).toEqual({
        shortTerm: { label: '< 365 days', count: 10, totalSats: BigInt(300000) },
        longTerm: { label: '>= 365 days', count: 5, totalSats: BigInt(700000) },
      });
      expect(prisma.uTXO.aggregate).toHaveBeenCalledTimes(2);
    });

    it('should use custom threshold days', async () => {
      (prisma.uTXO.aggregate as Mock)
        .mockResolvedValueOnce({ _count: { id: 3 }, _sum: { amount: BigInt(100000) } })
        .mockResolvedValueOnce({ _count: { id: 8 }, _sum: { amount: BigInt(900000) } });

      const result = await intelligenceRepository.getUtxoAgeDistribution('wallet-1', 180);

      expect(result).toEqual({
        shortTerm: { label: '< 180 days', count: 3, totalSats: BigInt(100000) },
        longTerm: { label: '>= 180 days', count: 8, totalSats: BigInt(900000) },
      });
    });

    it('should return zero totalSats when _sum.amount is null', async () => {
      (prisma.uTXO.aggregate as Mock)
        .mockResolvedValueOnce({ _count: { id: 0 }, _sum: { amount: null } })
        .mockResolvedValueOnce({ _count: { id: 0 }, _sum: { amount: null } });

      const result = await intelligenceRepository.getUtxoAgeDistribution('wallet-1');

      expect(result).toEqual({
        shortTerm: { label: '< 365 days', count: 0, totalSats: BigInt(0) },
        longTerm: { label: '>= 365 days', count: 0, totalSats: BigInt(0) },
      });
    });
  });
});
