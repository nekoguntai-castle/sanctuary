import { z } from 'zod';
import { BITCOIN_NETWORKS } from '@sanctuary/shared/constants/bitcoin';

const boundedCount = z.number().int().min(0).max(1_000_000);
const reason = z.enum([
  'ready',
  'header_unknown',
  'header_gap',
  'comparison_failure',
  'subscription_unknown',
  'subscription_pending',
]);

const networkReadiness = z.object({
  network: z.enum(BITCOIN_NETWORKS),
  persisted: boundedCount,
  subscribed: boundedCount,
  pending: boundedCount,
  unknown: boundedCount,
  unresolvedComparisonFailures: boundedCount,
  historicalComparisonFailureCount: boundedCount,
  oldestOpenGapAgeMs: z.number().int().min(0).nullable(),
  headerCheckpointKnown: z.boolean(),
  headerReconciliationPending: z.boolean(),
  ready: z.boolean(),
  reason,
}).strict();

export const schedulerRetirementReadinessSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.enum(['ready', 'blocked']),
    evaluatedAt: z.iso.datetime({ offset: true }),
    maxAllowedOpenGapAgeMs: z.literal(0),
    networks: z.array(networkReadiness).max(BITCOIN_NETWORKS.length),
  }).strict(),
  z.object({
    status: z.literal('unavailable'),
    evaluatedAt: z.iso.datetime({ offset: true }),
    reason: z.enum(['invalid_data', 'storage_unavailable']),
  }).strict(),
]);
