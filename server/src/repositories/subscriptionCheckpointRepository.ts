import { Prisma } from '../generated/prisma/client';
import prisma from '../models/prisma';
import type {
  SubscriptionCheckpointState,
  SubscriptionEnrollmentCandidate,
} from './types';

const MAX_ENROLLMENT_BATCH_SIZE = 200;

function enrollmentLimit(limit: number | undefined): number {
  if (limit === undefined) return MAX_ENROLLMENT_BATCH_SIZE;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('Subscription enrollment limit must be a positive integer');
  }
  return Math.min(limit, MAX_ENROLLMENT_BATCH_SIZE);
}

export async function findSubscriptionCheckpoint(
  addressId: string,
): Promise<SubscriptionCheckpointState | null> {
  return prisma.addressSubscriptionCheckpoint.findUnique({
    where: { addressId },
    select: {
      addressId: true,
      network: true,
      scriptHash: true,
      statusKnown: true,
      observedStatus: true,
      lastObservedAt: true,
      requestedEnrollmentGeneration: true,
      processedEnrollmentGeneration: true,
    },
  });
}

/**
 * Include missing checkpoint rows during rolling upgrades because an old
 * producer can still insert an address without its additive enrollment row.
 */
export async function findPendingSubscriptionEnrollments(options: {
  network: string;
  cursor?: string;
  limit?: number;
}): Promise<SubscriptionEnrollmentCandidate[]> {
  const limit = enrollmentLimit(options.limit);
  const cursor = options.cursor ?? '';

  return prisma.$queryRaw<SubscriptionEnrollmentCandidate[]>(Prisma.sql`
    SELECT
      "addresses"."id" AS "addressId",
      "addresses"."walletId",
      "addresses"."address",
      "wallets"."network" AS "network",
      "checkpoints"."scriptHash",
      COALESCE("checkpoints"."statusKnown", FALSE) AS "statusKnown",
      "checkpoints"."observedStatus",
      "checkpoints"."lastObservedAt",
      COALESCE("checkpoints"."requestedEnrollmentGeneration", 1) AS "requestedEnrollmentGeneration",
      COALESCE("checkpoints"."processedEnrollmentGeneration", 0) AS "processedEnrollmentGeneration",
      ("checkpoints"."addressId" IS NULL) AS "checkpointMissing"
    FROM "addresses"
    INNER JOIN "wallets" ON "wallets"."id" = "addresses"."walletId"
    LEFT JOIN "address_subscription_checkpoints" AS "checkpoints"
      ON "checkpoints"."addressId" = "addresses"."id"
    WHERE "addresses"."id" > ${cursor}
      AND "wallets"."network" = ${options.network}
      AND (
        "checkpoints"."addressId" IS NULL
        OR "checkpoints"."requestedEnrollmentGeneration" > "checkpoints"."processedEnrollmentGeneration"
      )
    ORDER BY "addresses"."id" ASC
    LIMIT ${limit}
  `);
}

export const subscriptionCheckpointRepository = {
  findSubscriptionCheckpoint,
  findPendingSubscriptionEnrollments,
};

export default subscriptionCheckpointRepository;
