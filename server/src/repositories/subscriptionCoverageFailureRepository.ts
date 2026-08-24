import { Prisma } from "../generated/prisma/client";
import prisma, { type PrismaTxClient } from "../models/prisma";
import { resolvePersistedBitcoinNetwork } from "../constants/bitcoinNetworks";
import type {
  RecordSubscriptionComparisonFailureInput,
  RecordSubscriptionComparisonFailureResult,
} from "./subscriptionCoverageTypes";

const MAX_DATABASE_COUNTER = 2_147_483_647;

interface FailureTargetRow {
  addressId: string;
  gapStartedAt: Date;
}

interface HistoricalCountRow {
  historicalCount: number;
}

function requireFailureInput(
  input: RecordSubscriptionComparisonFailureInput,
): void {
  if (!input.addressId.trim()) {
    throw new Error(
      "Subscription comparison failure address ID must be non-empty",
    );
  }
  resolvePersistedBitcoinNetwork(input.network);
  if (
    !Number.isInteger(input.enrollmentGeneration) ||
    input.enrollmentGeneration < 1 ||
    input.enrollmentGeneration > MAX_DATABASE_COUNTER
  ) {
    throw new Error(
      "Subscription comparison failure generation is outside the supported range",
    );
  }
  if (
    !(input.failedAt instanceof Date) ||
    !Number.isFinite(input.failedAt.getTime())
  ) {
    throw new Error(
      "Subscription comparison failure time must be a valid date",
    );
  }
}

async function lockFailureAddress(
  tx: PrismaTxClient,
  input: RecordSubscriptionComparisonFailureInput,
): Promise<FailureTargetRow | null> {
  const rows = await tx.$queryRaw<FailureTargetRow[]>(Prisma.sql`
    SELECT address."id" AS "addressId", address."createdAt" AS "gapStartedAt"
    FROM "addresses" AS address
    INNER JOIN "wallets" AS wallet ON wallet."id" = address."walletId"
    WHERE address."id" = ${input.addressId}
      AND wallet."network" = ${input.network}
    FOR UPDATE OF address
  `);
  return rows[0] ?? null;
}

async function ensurePendingFailureTarget(
  tx: PrismaTxClient,
  input: RecordSubscriptionComparisonFailureInput,
): Promise<boolean> {
  const address = await lockFailureAddress(tx, input);
  if (!address) return false;
  if (input.enrollmentGeneration === 1) {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "address_subscription_checkpoints" (
        "addressId", "network", "coverageGapStartedAt"
      ) VALUES (${input.addressId}, ${input.network}, ${address.gapStartedAt})
      ON CONFLICT ("addressId") DO NOTHING
    `);
  }
  const rows = await tx.$queryRaw<FailureTargetRow[]>(Prisma.sql`
    SELECT checkpoint."addressId", checkpoint."coverageGapStartedAt" AS "gapStartedAt"
    FROM "address_subscription_checkpoints" AS checkpoint
    WHERE checkpoint."addressId" = ${input.addressId}
      AND checkpoint."network" = ${input.network}
      AND checkpoint."requestedEnrollmentGeneration" = ${input.enrollmentGeneration}
      AND checkpoint."processedEnrollmentGeneration" < ${input.enrollmentGeneration}
    FOR UPDATE OF checkpoint
  `);
  return rows.length === 1;
}

async function writeUnresolvedFailure(
  tx: PrismaTxClient,
  input: RecordSubscriptionComparisonFailureInput,
): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "address_subscription_comparison_failures" AS failure (
      "addressId", "enrollmentGeneration", "firstFailedAt", "lastFailedAt"
    ) VALUES (
      ${input.addressId}, ${input.enrollmentGeneration}, ${input.failedAt}, ${input.failedAt}
    )
    ON CONFLICT ("addressId") DO UPDATE
    SET "enrollmentGeneration" = EXCLUDED."enrollmentGeneration",
        "firstFailedAt" = CASE
          WHEN failure."enrollmentGeneration" = EXCLUDED."enrollmentGeneration"
          THEN LEAST(failure."firstFailedAt", EXCLUDED."firstFailedAt")
          ELSE EXCLUDED."firstFailedAt"
        END,
        "lastFailedAt" = CASE
          WHEN failure."enrollmentGeneration" = EXCLUDED."enrollmentGeneration"
          THEN GREATEST(failure."lastFailedAt", EXCLUDED."lastFailedAt")
          ELSE EXCLUDED."lastFailedAt"
        END,
        "attemptCount" = CASE
          WHEN failure."enrollmentGeneration" <> EXCLUDED."enrollmentGeneration" THEN 1
          WHEN failure."attemptCount" < ${MAX_DATABASE_COUNTER} THEN failure."attemptCount" + 1
          ELSE failure."attemptCount"
        END,
        "updatedAt" = CURRENT_TIMESTAMP
  `);
}

async function incrementNetworkFailureHistory(
  tx: PrismaTxClient,
  input: RecordSubscriptionComparisonFailureInput,
): Promise<number> {
  const rows = await tx.$queryRaw<HistoricalCountRow[]>(Prisma.sql`
    INSERT INTO "network_subscription_coverage_state" AS coverage (
      "network", "historicalComparisonFailureCount",
      "firstComparisonFailureAt", "lastComparisonFailureAt"
    ) VALUES (${input.network}, 1, ${input.failedAt}, ${input.failedAt})
    ON CONFLICT ("network") DO UPDATE
    SET "historicalComparisonFailureCount" = CASE
          WHEN coverage."historicalComparisonFailureCount" < ${MAX_DATABASE_COUNTER}
          THEN coverage."historicalComparisonFailureCount" + 1
          ELSE coverage."historicalComparisonFailureCount"
        END,
        "firstComparisonFailureAt" = LEAST(
          coverage."firstComparisonFailureAt", EXCLUDED."firstComparisonFailureAt"
        ),
        "lastComparisonFailureAt" = GREATEST(
          coverage."lastComparisonFailureAt", EXCLUDED."lastComparisonFailureAt"
        ),
        "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "historicalComparisonFailureCount" AS "historicalCount"
  `);
  const count = rows[0]?.historicalCount;
  if (!Number.isInteger(count) || count < 1 || count > MAX_DATABASE_COUNTER) {
    throw new Error(
      "Subscription comparison failure counter returned invalid data",
    );
  }
  return count;
}

/**
 * Atomically retain exact unresolved evidence and increment network history.
 * A stale or already-settled generation returns `not_applied`; storage failures
 * still throw so callers can preserve the primary failure and remain pending.
 */
export async function recordSubscriptionComparisonFailure(
  input: RecordSubscriptionComparisonFailureInput,
): Promise<RecordSubscriptionComparisonFailureResult> {
  requireFailureInput(input);
  return prisma.$transaction(
    async (tx) => {
      if (!(await ensurePendingFailureTarget(tx, input)))
        return { status: "not_applied" };
      await writeUnresolvedFailure(tx, input);
      const historicalCount = await incrementNetworkFailureHistory(tx, input);
      return { status: "recorded", historicalCount };
    },
    { maxWait: 5_000, timeout: 15_000 },
  );
}
