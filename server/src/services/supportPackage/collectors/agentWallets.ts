/**
 * Agent Wallets Collector
 *
 * Anonymized inventory of linked agent wallets plus the alert/override/
 * funding-attempt counts that reveal whether the agent is stuck, paused,
 * or throwing rejections. No API key material — only counts.
 */

import { agentRepository } from '../../../repositories';
import { getErrorMessage } from '../../../utils/errors';
import { registerCollector } from './registry';
import type { CollectorContext } from '../types';

registerCollector('agentWallets', async (context: CollectorContext) => {
  try {
    const stats = await agentRepository.getSupportStats();

    return {
      total: stats.agents.length,
      agents: stats.agents.map(a => ({
        id: context.anonymize('agent', a.id),
        status: a.status,
        fundingWalletId: context.anonymize('wallet', a.fundingWalletId),
        operationalWalletId: context.anonymize('wallet', a.operationalWalletId),
        lastFundingDraftAt: a.lastFundingDraftAt?.toISOString() ?? null,
        createdAt: a.createdAt.toISOString(),
        revokedAt: a.revokedAt?.toISOString() ?? null,
        requireHumanApproval: a.requireHumanApproval,
        pauseOnUnexpectedSpend: a.pauseOnUnexpectedSpend,
      })),
      alertsByStatusSeverity: stats.alertsByStatusSeverity,
      apiKeys: stats.apiKeyCounts,
      overridesByStatus: stats.overridesByStatus,
      fundingAttemptsByStatusLast7d: stats.fundingAttemptsByStatusLast7d,
    };
  } catch (error) {
    return { error: getErrorMessage(error) };
  }
});
