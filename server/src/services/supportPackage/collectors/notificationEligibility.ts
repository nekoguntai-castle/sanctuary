/** Privacy-safe database-backed notification eligibility collector. */
import {
  getNotificationEligibilityCounts,
} from '../../../repositories/supportNotificationDiagnosticsRepository';
import { registerShareableCollector } from './registry';
import {
  notificationEligibilitySchema,
  type AggregateCountBucket,
} from './notificationEligibilitySchema';

export function toAggregateCountBucket(value: number): AggregateCountBucket {
  if (value <= 0) return 'zero';
  if (value === 1) return 'one';
  if (value <= 5) return 'two_to_five';
  if (value <= 20) return 'six_to_twenty';
  return 'over_twenty';
}

async function collectNotificationEligibility() {
  return Promise.resolve()
    .then(() => getNotificationEligibilityCounts())
    .then((counts) => notificationEligibilitySchema.parse({
      observation: 'observed',
      unit: 'distinct_accessible_wallets_with_eligible_recipient',
      telegramUsers: {
        configured: toAggregateCountBucket(counts.configuredTelegramUsers),
        enabled: toAggregateCountBucket(counts.enabledTelegramUsers),
      },
      eligibleWallets: {
        received: toAggregateCountBucket(counts.eligibleReceivedWallets),
        sent: toAggregateCountBucket(counts.eligibleSentWallets),
        draft: toAggregateCountBucket(counts.eligibleDraftWallets),
        consolidation: toAggregateCountBucket(counts.eligibleConsolidationWallets),
      },
      disabledDirectionWallets: {
        received: toAggregateCountBucket(counts.disabledReceivedWallets),
        sent: toAggregateCountBucket(counts.disabledSentWallets),
        draft: toAggregateCountBucket(counts.disabledDraftWallets),
        consolidation: toAggregateCountBucket(counts.disabledConsolidationWallets),
      },
      enabledUsersWithoutWalletSettings: toAggregateCountBucket(
        counts.enabledUsersWithoutWalletSettings,
      ),
      missingCredentialUsers: toAggregateCountBucket(counts.missingCredentialUsers),
      orphanedWalletSettings: toAggregateCountBucket(counts.orphanedWalletSettings),
    }))
    .catch(() => ({ observation: 'unavailable' as const }));
}

registerShareableCollector('notificationEligibility', {
  collect: collectNotificationEligibility,
  schema: notificationEligibilitySchema,
  sourceProcess: 'database_shared',
  sourceKind: 'aggregate_query',
  authoritativeFor: ['effective_notification_configuration'],
  notAuthoritativeFor: ['worker_delivery'],
});
