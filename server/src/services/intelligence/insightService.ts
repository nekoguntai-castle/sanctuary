/**
 * Insight Service
 *
 * CRUD operations for AI insights via the intelligence repository.
 */

import { intelligenceRepository } from '../../repositories/intelligenceRepository';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { ConflictError } from '../../errors';
import type { CreateInsightInput, InsightFilter } from '../../repositories/intelligenceRepository';

const log = createLogger('INTELLIGENCE:SVC_INSIGHT');

export async function createInsight(input: CreateInsightInput) {
  const insight = await intelligenceRepository.createInsight(input);
  log.info('Created insight', { id: insight.id, walletId: input.walletId, type: input.type, severity: input.severity });
  return insight;
}

export async function getInsightById(id: string) {
  return intelligenceRepository.findInsightById(id);
}

export async function getInsightsByWallet(
  walletId: string,
  filters?: Omit<InsightFilter, 'walletId'>,
  limit?: number,
  offset?: number
) {
  return intelligenceRepository.findInsightsByWallet(walletId, filters, limit, offset);
}

export async function getActiveInsights(walletId: string) {
  return intelligenceRepository.findActiveInsights(walletId);
}

export async function countActiveInsights(walletId: string) {
  return intelligenceRepository.countActiveInsights(walletId);
}

async function resolveInsight(id: string, status: 'dismissed' | 'acted_on') {
  const updated = await intelligenceRepository.updateInsightStatus(id, status);
  if (!updated) {
    throw new ConflictError('Insight is no longer active');
  }
  return updated;
}

export async function dismissInsight(id: string) {
  return resolveInsight(id, 'dismissed');
}

export async function markActedOn(id: string) {
  return resolveInsight(id, 'acted_on');
}

export async function markNotified(id: string) {
  return intelligenceRepository.markInsightNotified(id);
}

/**
 * Expire active insights that have passed their expiresAt date.
 * Then delete old dismissed/expired insights past the retention period.
 */
export async function cleanupExpiredInsights(retentionDays = 90): Promise<number> {
  try {
    // Bulk-expire active insights past their expiresAt (single UPDATE query)
    const expiredCount = await intelligenceRepository.expireActiveInsights();

    // Delete old non-active insights and conversations
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const [deleted, deletedConvs] = await Promise.all([
      intelligenceRepository.deleteExpiredInsights(cutoff),
      intelligenceRepository.deleteOldConversations(cutoff),
    ]);

    if (expiredCount > 0 || deleted > 0 || deletedConvs > 0) {
      log.info('Cleaned up intelligence data', {
        expiredInsights: expiredCount,
        deletedInsights: deleted,
        deletedConversations: deletedConvs,
      });
    }

    return expiredCount + deleted;
  } catch (error) {
    log.error('Failed to cleanup expired insights', { error: getErrorMessage(error) });
    return 0;
  }
}
