/**
 * Intelligence Repository
 *
 * Abstracts database operations for Treasury Intelligence
 * (AI insights, conversations, and messages).
 */

import prisma from '../models/prisma';
import type { AIInsight, AIConversation, AIMessage, Prisma } from '../generated/prisma/client';
import type { InsightType, InsightSeverity, InsightStatus } from '../services/intelligence/types';

// Re-export for consumers that import from this module
export type { InsightType, InsightSeverity, InsightStatus };

export interface CreateInsightInput {
  walletId: string;
  type: InsightType;
  severity: InsightSeverity;
  title: string;
  summary: string;
  analysis: string;
  data?: Prisma.JsonValue;
  expiresAt?: Date;
}

export interface InsightFilter {
  walletId?: string;
  type?: InsightType;
  severity?: InsightSeverity;
  status?: InsightStatus;
}

export interface CreateConversationInput {
  userId: string;
  walletId?: string | null;
  title?: string | null;
}

export interface CreateMessageInput {
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: Prisma.JsonValue;
}

export interface TransactionVelocity {
  period: string;
  count: number;
  totalSats: bigint;
}

export interface UtxoAgeGroup {
  label: string;
  count: number;
  totalSats: bigint;
}

// ========================================
// Insights
// ========================================

async function createInsight(input: CreateInsightInput): Promise<AIInsight> {
  return prisma.aIInsight.create({
    data: {
      walletId: input.walletId,
      type: input.type,
      severity: input.severity,
      title: input.title,
      summary: input.summary,
      analysis: input.analysis,
      data: input.data ?? undefined,
      expiresAt: input.expiresAt ?? null,
    },
  });
}

async function findInsightById(id: string): Promise<AIInsight | null> {
  return prisma.aIInsight.findUnique({ where: { id } });
}

async function findInsightsByWallet(
  walletId: string,
  filters?: Omit<InsightFilter, 'walletId'>,
  limit = 50,
  offset = 0
): Promise<AIInsight[]> {
  const where: Prisma.AIInsightWhereInput = { walletId };
  if (filters?.type) where.type = filters.type;
  if (filters?.severity) where.severity = filters.severity;
  if (filters?.status) where.status = filters.status;

  return prisma.aIInsight.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });
}

async function findActiveInsights(walletId: string): Promise<AIInsight[]> {
  return prisma.aIInsight.findMany({
    where: { walletId, status: 'active' },
    orderBy: { createdAt: 'desc' },
  });
}

async function countActiveInsights(walletId: string): Promise<number> {
  return prisma.aIInsight.count({
    where: { walletId, status: 'active' },
  });
}

async function updateInsightStatus(id: string, status: InsightStatus): Promise<AIInsight> {
  return prisma.aIInsight.update({
    where: { id },
    data: { status },
  });
}

async function markInsightNotified(id: string): Promise<void> {
  await prisma.aIInsight.update({
    where: { id },
    data: { notifiedAt: new Date() },
  });
}

async function findExpiredInsights(): Promise<AIInsight[]> {
  return prisma.aIInsight.findMany({
    where: {
      status: 'active',
      expiresAt: { lte: new Date() },
    },
  });
}

async function expireActiveInsights(): Promise<number> {
  const result = await prisma.aIInsight.updateMany({
    where: { status: 'active', expiresAt: { lte: new Date() } },
    data: { status: 'expired' },
  });
  return result.count;
}

async function deleteExpiredInsights(cutoffDate: Date): Promise<number> {
  const result = await prisma.aIInsight.deleteMany({
    where: {
      OR: [
        { status: { in: ['dismissed', 'acted_on', 'expired'] }, updatedAt: { lt: cutoffDate } },
        { expiresAt: { lte: new Date() }, status: 'active' },
      ],
    },
  });
  return result.count;
}

async function deleteInsightsByWallet(walletId: string): Promise<number> {
  const result = await prisma.aIInsight.deleteMany({ where: { walletId } });
  return result.count;
}

// ========================================
// Conversations
// ========================================

async function createConversation(input: CreateConversationInput): Promise<AIConversation> {
  return prisma.aIConversation.create({
    data: {
      userId: input.userId,
      walletId: input.walletId ?? null,
      title: input.title ?? null,
    },
  });
}

async function findConversationById(id: string): Promise<AIConversation | null> {
  return prisma.aIConversation.findUnique({ where: { id } });
}

async function findConversationsByUser(
  userId: string,
  limit = 20,
  offset = 0
): Promise<AIConversation[]> {
  return prisma.aIConversation.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    skip: offset,
  });
}

async function updateConversationTitle(id: string, title: string): Promise<AIConversation> {
  return prisma.aIConversation.update({
    where: { id },
    data: { title },
  });
}

async function deleteConversation(id: string): Promise<void> {
  await prisma.aIConversation.delete({ where: { id } });
}

async function deleteOldConversations(cutoffDate: Date): Promise<number> {
  const result = await prisma.aIConversation.deleteMany({
    where: { updatedAt: { lt: cutoffDate } },
  });
  return result.count;
}

// ========================================
// Messages
// ========================================

async function addMessage(input: CreateMessageInput): Promise<AIMessage> {
  // Also touch the conversation's updatedAt
  const [message] = await prisma.$transaction([
    prisma.aIMessage.create({
      data: {
        conversationId: input.conversationId,
        role: input.role,
        content: input.content,
        metadata: input.metadata ?? undefined,
      },
    }),
    prisma.aIConversation.update({
      where: { id: input.conversationId },
      data: { updatedAt: new Date() },
    }),
  ]);
  return message;
}

async function getMessages(conversationId: string, limit = 100): Promise<AIMessage[]> {
  return prisma.aIMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
}

// ========================================
// Analytics helpers (sanitized — no addresses or txids)
// ========================================

async function getTransactionVelocity(
  walletId: string,
  days: number
): Promise<TransactionVelocity[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const txs = await prisma.transaction.groupBy({
    by: ['type'],
    where: {
      walletId,
      blockTime: { gte: cutoff },
      type: 'sent',
    },
    _count: { _all: true },
    _sum: { amount: true },
  });

  return txs.map((t) => ({
    period: `${days}d`,
    /* v8 ignore start -- Prisma aggregate count shape is stable in supported client versions */
    count: t._count?._all ?? 0,
    /* v8 ignore stop */
    totalSats: t._sum?.amount ?? BigInt(0),
  }));
}

async function getUtxoAgeDistribution(
  walletId: string,
  longTermThresholdDays = 365
): Promise<{ shortTerm: UtxoAgeGroup; longTerm: UtxoAgeGroup }> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - longTermThresholdDays);

  const [shortTerm, longTerm] = await Promise.all([
    prisma.uTXO.aggregate({
      where: {
        walletId,
        spent: false,
        createdAt: { gt: cutoff },
      },
      _count: { id: true },
      _sum: { amount: true },
    }),
    prisma.uTXO.aggregate({
      where: {
        walletId,
        spent: false,
        createdAt: { lte: cutoff },
      },
      _count: { id: true },
      _sum: { amount: true },
    }),
  ]);

  return {
    shortTerm: {
      label: `< ${longTermThresholdDays} days`,
      count: shortTerm._count.id,
      totalSats: shortTerm._sum.amount ?? BigInt(0),
    },
    longTerm: {
      label: `>= ${longTermThresholdDays} days`,
      count: longTerm._count.id,
      totalSats: longTerm._sum.amount ?? BigInt(0),
    },
  };
}

// ========================================
// Support Package Stats
// ========================================

export interface IntelligenceSupportStats {
  conversationCount: number;
  messageCountLast7d: number;
  insightsByTypeStatus: Array<{ type: string; status: string; count: number }>;
  insightsBySeverity: Record<string, number>;
  activeInsightCount: number;
}

async function getSupportStats(now: Date = new Date()): Promise<IntelligenceSupportStats> {
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [conversationCount, messageCount, typeStatusGroups, severityGroups, activeCount] = await Promise.all([
    prisma.aIConversation.count(),
    prisma.aIMessage.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    prisma.aIInsight.groupBy({
      by: ['type', 'status'],
      _count: { _all: true },
    }),
    prisma.aIInsight.groupBy({
      by: ['severity'],
      where: { status: 'active' },
      _count: { _all: true },
    }),
    prisma.aIInsight.count({ where: { status: 'active' } }),
  ]);

  return {
    conversationCount,
    messageCountLast7d: messageCount,
    insightsByTypeStatus: typeStatusGroups.map(r => ({
      type: r.type,
      status: r.status,
      count: r._count._all,
    })),
    insightsBySeverity: Object.fromEntries(severityGroups.map(r => [r.severity, r._count._all])),
    activeInsightCount: activeCount,
  };
}

// ========================================
// Export
// ========================================

export const intelligenceRepository = {
  // Insights
  createInsight,
  findInsightById,
  findInsightsByWallet,
  findActiveInsights,
  countActiveInsights,
  updateInsightStatus,
  markInsightNotified,
  findExpiredInsights,
  expireActiveInsights,
  deleteExpiredInsights,
  deleteInsightsByWallet,

  // Conversations
  createConversation,
  findConversationById,
  findConversationsByUser,
  updateConversationTitle,
  deleteConversation,
  deleteOldConversations,

  // Messages
  addMessage,
  getMessages,

  // Analytics
  getTransactionVelocity,
  getUtxoAgeDistribution,

  // Support package
  getSupportStats,
};

export default intelligenceRepository;
