/**
 * Insight Service
 *
 * CRUD operations for AI insights via the intelligence repository.
 */

import { intelligenceRepository } from '../../repositories/intelligenceRepository';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import type { InsightType, InsightSeverity, InsightStatus } from './types';
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

export async function dismissInsight(id: string) {
  return intelligenceRepository.updateInsightStatus(id, 'dismissed');
}

export async function markActedOn(id: string) {
  return intelligenceRepository.updateInsightStatus(id, 'acted_on');
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
    // First expire active insights past their expiry
    const expired = await intelligenceRepository.findExpiredInsights();
    for (const insight of expired) {
      await intelligenceRepository.updateInsightStatus(insight.id, 'expired');
    }

    // Then delete old non-active insights
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const deleted = await intelligenceRepository.deleteExpiredInsights(cutoff);

    // Also clean up old conversations
    const convCutoff = new Date();
    convCutoff.setDate(convCutoff.getDate() - retentionDays);
    const deletedConvs = await intelligenceRepository.deleteOldConversations(convCutoff);

    if (expired.length > 0 || deleted > 0 || deletedConvs > 0) {
      log.info('Cleaned up intelligence data', {
        expiredInsights: expired.length,
        deletedInsights: deleted,
        deletedConversations: deletedConvs,
      });
    }

    return expired.length + deleted;
  } catch (error) {
    log.error('Failed to cleanup expired insights', { error: getErrorMessage(error) });
    return 0;
  }
}
