import { Prisma } from '../generated/prisma/client';
import {
  isNetworkType,
  type NetworkType,
} from '@sanctuary/shared/constants/bitcoin';
import prisma from '../models/prisma';
import type {
  SubscriptionCheckpointState,
  SubscriptionEnrollmentCompletionInput,
  SubscriptionEnrollmentCompletionResult,
  SubscriptionEnrollmentCandidate,
  SubscriptionEnrollmentRequestResult,
} from './types';

const MAX_ENROLLMENT_BATCH_SIZE = 200;
const MAX_ENROLLMENT_GENERATION = 2_147_483_647;
const ELECTRUM_HASH_PATTERN = /^[0-9a-f]{64}$/;

interface EnrollmentRequestRow extends SubscriptionCheckpointState {
  inserted: boolean;
  previousRequestedGeneration: number | null;
}

function requireNonEmpty(value: string, description: string): void {
  const valid = [typeof value === 'string', /\S/.test(value)].every(Boolean);
  if (!valid) {
    throw new Error(`${description} must be non-empty`);
  }
}

function requireAddressIdentity(addressId: string, address?: string): void {
  requireNonEmpty(addressId, 'Subscription enrollment address ID');
  if (address !== undefined) {
    requireNonEmpty(address, 'Subscription enrollment address');
  }
}

function requireNetwork(network: unknown): void {
  if (!isNetworkType(network)) {
    throw new Error('Subscription enrollment network is invalid');
  }
}

function requireGeneration(generation: number): void {
  if (
    !Number.isInteger(generation)
    || generation < 1
    || generation > MAX_ENROLLMENT_GENERATION
  ) {
    throw new Error('Subscription enrollment generation is outside the supported range');
  }
}

function requireCompletionInput(input: SubscriptionEnrollmentCompletionInput): void {
  requireAddressIdentity(input.addressId, input.address);
  requireNetwork(input.network);
  requireGeneration(input.generation);
  if (!ELECTRUM_HASH_PATTERN.test(input.scriptHash)) {
    throw new Error('Subscription enrollment script hash must be 64 lowercase hexadecimal characters');
  }
  if (input.observedStatus !== null && !ELECTRUM_HASH_PATTERN.test(input.observedStatus)) {
    throw new Error('Subscription enrollment observed status must be null or a lowercase Electrum hash');
  }
  if (!(input.observedAt instanceof Date) || !Number.isFinite(input.observedAt.getTime())) {
    throw new Error('Subscription enrollment observation time must be a valid date');
  }
}

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

/** Request one durable enrollment slot, coalescing while a slot is already pending. */
export async function requestSubscriptionEnrollment(
  addressId: string,
  network: NetworkType,
): Promise<SubscriptionEnrollmentRequestResult> {
  requireAddressIdentity(addressId);
  requireNetwork(network);
  const rows = await prisma.$queryRaw<EnrollmentRequestRow[]>(Prisma.sql`
    WITH "target" AS MATERIALIZED (
      SELECT "addresses"."id" AS "addressId", "wallets"."network"
      FROM "addresses"
      INNER JOIN "wallets" ON "wallets"."id" = "addresses"."walletId"
      WHERE "addresses"."id" = ${addressId}
        AND "wallets"."network" = ${network}
    ),
    "existing" AS MATERIALIZED (
      SELECT
        "checkpoints"."addressId",
        "checkpoints"."requestedEnrollmentGeneration" AS "previousRequestedGeneration"
      FROM "address_subscription_checkpoints" AS "checkpoints"
      INNER JOIN "target" ON "target"."addressId" = "checkpoints"."addressId"
      WHERE "checkpoints"."network" = ${network}
      FOR UPDATE
    ),
    "source" AS MATERIALIZED (
      SELECT
        "target"."addressId",
        "target"."network",
        "existing"."previousRequestedGeneration"
      FROM "target"
      LEFT JOIN "existing" ON "existing"."addressId" = "target"."addressId"
    ),
    "written" AS (
      INSERT INTO "address_subscription_checkpoints" AS "checkpoints" (
        "addressId",
        "network"
      )
      SELECT "source"."addressId", "source"."network"
      FROM "source"
      ON CONFLICT ("addressId") DO UPDATE
      SET "requestedEnrollmentGeneration" = GREATEST(
            "checkpoints"."requestedEnrollmentGeneration",
            "checkpoints"."processedEnrollmentGeneration" + 1
          ),
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "checkpoints"."network" = EXCLUDED."network"
        AND (
          "checkpoints"."requestedEnrollmentGeneration"
            > "checkpoints"."processedEnrollmentGeneration"
          OR "checkpoints"."requestedEnrollmentGeneration" < ${MAX_ENROLLMENT_GENERATION}
        )
      RETURNING
        "addressId",
        "network",
        "scriptHash",
        "statusKnown",
        "observedStatus",
        "lastObservedAt",
        "requestedEnrollmentGeneration",
        "processedEnrollmentGeneration",
        (xmax = 0) AS "inserted"
    )
    SELECT
      "written".*,
      (SELECT "previousRequestedGeneration" FROM "source")
        AS "previousRequestedGeneration"
    FROM "written"
  `);
  const row = rows[0];
  if (row) {
    const { inserted, previousRequestedGeneration, ...state } = row;
    const advancedExisting = previousRequestedGeneration !== null
      && state.requestedEnrollmentGeneration > previousRequestedGeneration;
    return {
      status: inserted || advancedExisting ? 'requested' : 'merged',
      state,
    };
  }

  const current = await findSubscriptionCheckpoint(addressId);
  if (
    current?.network === network
    && current.requestedEnrollmentGeneration === MAX_ENROLLMENT_GENERATION
    && current.processedEnrollmentGeneration === MAX_ENROLLMENT_GENERATION
  ) {
    return { status: 'generation_exhausted' };
  }
  return { status: 'not_applied' };
}

/** Apply only the exact pending generation derived from the unchanged address row. */
export async function completeSubscriptionEnrollment(
  input: SubscriptionEnrollmentCompletionInput,
): Promise<SubscriptionEnrollmentCompletionResult> {
  requireCompletionInput(input);
  const rows = await prisma.$queryRaw<SubscriptionCheckpointState[]>(Prisma.sql`
    WITH "target" AS MATERIALIZED (
      SELECT "addresses"."id" AS "addressId", "wallets"."network"
      FROM "addresses"
      INNER JOIN "wallets" ON "wallets"."id" = "addresses"."walletId"
      WHERE "addresses"."id" = ${input.addressId}
        AND "addresses"."address" = ${input.address}
        AND "wallets"."network" = ${input.network}
    ),
    "inserted" AS (
      INSERT INTO "address_subscription_checkpoints" (
        "addressId",
        "network",
        "scriptHash",
        "statusKnown",
        "observedStatus",
        "lastObservedAt",
        "requestedEnrollmentGeneration",
        "processedEnrollmentGeneration"
      )
      SELECT
        "target"."addressId",
        "target"."network",
        ${input.scriptHash},
        TRUE,
        ${input.observedStatus},
        ${input.observedAt},
        1,
        1
      FROM "target"
      WHERE ${input.generation} = 1
      ON CONFLICT ("addressId") DO NOTHING
      RETURNING *
    ),
    "updated" AS (
      UPDATE "address_subscription_checkpoints" AS "checkpoints"
      SET "scriptHash" = ${input.scriptHash},
          "statusKnown" = TRUE,
          "observedStatus" = ${input.observedStatus},
          "lastObservedAt" = ${input.observedAt},
          "processedEnrollmentGeneration" = ${input.generation},
          "updatedAt" = CURRENT_TIMESTAMP
      FROM "target"
      WHERE "checkpoints"."addressId" = "target"."addressId"
        AND "checkpoints"."network" = "target"."network"
        AND "checkpoints"."requestedEnrollmentGeneration" = ${input.generation}
        AND "checkpoints"."processedEnrollmentGeneration" < ${input.generation}
      RETURNING "checkpoints".*
    )
    SELECT
      "completed"."addressId",
      "completed"."network",
      "completed"."scriptHash",
      "completed"."statusKnown",
      "completed"."observedStatus",
      "completed"."lastObservedAt",
      "completed"."requestedEnrollmentGeneration",
      "completed"."processedEnrollmentGeneration"
    FROM (
      SELECT * FROM "inserted"
      UNION ALL
      SELECT * FROM "updated"
    ) AS "completed"
  `);
  const state = rows[0];
  return state ? { status: 'applied', state } : { status: 'not_applied' };
}

export const subscriptionCheckpointRepository = {
  findSubscriptionCheckpoint,
  findPendingSubscriptionEnrollments,
  requestSubscriptionEnrollment,
  completeSubscriptionEnrollment,
};

export default subscriptionCheckpointRepository;
