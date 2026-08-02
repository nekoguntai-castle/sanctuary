import { z } from 'zod';

export const aggregateCountBucketSchema = z.enum([
  'zero',
  'one',
  'two_to_five',
  'six_to_twenty',
  'over_twenty',
]);

const eligibilityBucketsSchema = z.object({
  received: aggregateCountBucketSchema,
  sent: aggregateCountBucketSchema,
  draft: aggregateCountBucketSchema,
  consolidation: aggregateCountBucketSchema,
}).strict();

const telegramUserBucketsSchema = z.object({
  configured: aggregateCountBucketSchema,
  enabled: aggregateCountBucketSchema,
}).strict();

export const notificationEligibilitySchema = z.discriminatedUnion('observation', [
  z.object({
    observation: z.literal('observed'),
    unit: z.literal('distinct_accessible_wallets_with_eligible_recipient'),
    telegramUsers: telegramUserBucketsSchema,
    eligibleWallets: eligibilityBucketsSchema,
    disabledDirectionWallets: eligibilityBucketsSchema,
    enabledUsersWithoutWalletSettings: aggregateCountBucketSchema,
    missingCredentialUsers: aggregateCountBucketSchema,
    orphanedWalletSettings: aggregateCountBucketSchema,
  }).strict(),
  z.object({ observation: z.literal('unavailable') }).strict(),
]);

export type AggregateCountBucket = z.infer<typeof aggregateCountBucketSchema>;
