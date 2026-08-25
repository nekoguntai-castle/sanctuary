import { Prisma } from "../generated/prisma/client";
import prisma, { type PrismaTxClient } from "../models/prisma";
import { getErrorMessage } from "../utils/errors";
import { createLogger } from "../utils/logger";
import {
  buildCoverageSnapshots,
  CoverageDataError,
  coverageEvaluationTime,
  type SubscriptionCoverageRow,
} from "./subscriptionCoverageParsing";
import type { SubscriptionCoverageReadResult } from "./subscriptionCoverageTypes";

const log = createLogger("REPO:SUBSCRIPTION_COVERAGE");

// Older durable rows may use the former `testnet` spelling while current code
// persists `testnet3`. Group both as one network; the row-count assertions then
// fail closed if both spellings exist in a supposedly singleton state table.
function canonicalNetworkSql(column: string): Prisma.Sql {
  const rawColumn = Prisma.raw(column);
  return Prisma.sql`CASE WHEN ${rawColumn} = 'testnet' THEN 'testnet3' ELSE ${rawColumn} END`;
}

const walletNetwork = canonicalNetworkSql('wallet."network"');
const checkpointNetwork = canonicalNetworkSql('checkpoint."network"');
const headerNetwork = canonicalNetworkSql('header_checkpoint."network"');
const coverageStateNetwork = canonicalNetworkSql('coverage_state."network"');
const retryWalletNetwork = canonicalNetworkSql('retry_wallet."network"');

export async function readSubscriptionCoverageRows(
  tx: PrismaTxClient,
): Promise<SubscriptionCoverageRow[]> {
  return tx.$queryRaw<SubscriptionCoverageRow[]>(Prisma.sql`
    WITH represented AS (
      SELECT DISTINCT ${walletNetwork} AS network
      FROM "wallets" AS wallet
      UNION
      SELECT DISTINCT ${headerNetwork} AS network
      FROM "network_header_checkpoints" AS header_checkpoint
      UNION
      SELECT DISTINCT ${coverageStateNetwork} AS network
      FROM "network_subscription_coverage_state" AS coverage_state
      UNION
      SELECT DISTINCT CASE
        WHEN reconciliation."network" = 'testnet' THEN 'testnet3'
        ELSE reconciliation."network"
      END AS network
      FROM "network_header_reconciliations" AS reconciliation
    ),
    address_coverage AS (
      SELECT
        ${walletNetwork} AS network,
        COUNT(address."id") AS persisted,
        COUNT(address."id") FILTER (WHERE
          checkpoint."addressId" IS NOT NULL
          AND ${checkpointNetwork} = ${walletNetwork}
          AND checkpoint."statusKnown" = TRUE
          AND checkpoint."processedEnrollmentGeneration"
            = checkpoint."requestedEnrollmentGeneration"
        ) AS subscribed,
        COUNT(address."id") FILTER (WHERE
          checkpoint."addressId" IS NOT NULL
          AND ${checkpointNetwork} = ${walletNetwork}
          AND checkpoint."statusKnown" = TRUE
          AND checkpoint."processedEnrollmentGeneration"
            < checkpoint."requestedEnrollmentGeneration"
        ) AS pending,
        COUNT(address."id") FILTER (WHERE
          checkpoint."addressId" IS NULL
          OR ${checkpointNetwork} <> ${walletNetwork}
          OR checkpoint."statusKnown" = FALSE
        ) AS unknown,
        COUNT(address."id") FILTER (WHERE
          checkpoint."addressId" IS NOT NULL
          AND ${checkpointNetwork} <> ${walletNetwork}
        ) AS "checkpointMismatchCount",
        MIN(CASE WHEN
          checkpoint."addressId" IS NULL
          OR ${checkpointNetwork} <> ${walletNetwork}
          OR checkpoint."statusKnown" = FALSE
          OR checkpoint."processedEnrollmentGeneration"
            < checkpoint."requestedEnrollmentGeneration"
          THEN COALESCE(checkpoint."coverageGapStartedAt", address."createdAt")
          ELSE NULL
        END) AS "oldestAddressGapStartedAt"
      FROM "addresses" AS address
      INNER JOIN "wallets" AS wallet ON wallet."id" = address."walletId"
      LEFT JOIN "address_subscription_checkpoints" AS checkpoint
        ON checkpoint."addressId" = address."id"
      GROUP BY ${walletNetwork}
    ),
    unresolved_failures AS (
      SELECT
        ${walletNetwork} AS network,
        COUNT(failure."addressId") AS "unresolvedComparisonFailures",
        COUNT(failure."addressId") FILTER (WHERE
          checkpoint."addressId" IS NULL
          OR ${checkpointNetwork} <> ${walletNetwork}
          OR failure."enrollmentGeneration"
            <> checkpoint."requestedEnrollmentGeneration"
          OR checkpoint."processedEnrollmentGeneration"
            >= failure."enrollmentGeneration"
        ) AS "failureMismatchCount"
      FROM "address_subscription_comparison_failures" AS failure
      INNER JOIN "addresses" AS address ON address."id" = failure."addressId"
      INNER JOIN "wallets" AS wallet ON wallet."id" = address."walletId"
      LEFT JOIN "address_subscription_checkpoints" AS checkpoint
        ON checkpoint."addressId" = failure."addressId"
      GROUP BY ${walletNetwork}
    ),
    header_state AS (
      SELECT
        ${headerNetwork} AS network,
        COUNT(*) AS "headerRowCount",
        MIN(header_checkpoint."lastProcessedHeight") AS "headerHeight",
        MIN(header_checkpoint."observedAt") AS "headerObservedAt",
        MIN(header_checkpoint."coverageGapStartedAt") AS "headerGapStartedAt"
      FROM "network_header_checkpoints" AS header_checkpoint
      GROUP BY ${headerNetwork}
    ),
    coverage_history AS (
      SELECT
        ${coverageStateNetwork} AS network,
        COUNT(*) AS "coverageStateRowCount",
        MIN(coverage_state."historicalComparisonFailureCount")
          AS "historicalComparisonFailureCount",
        MIN(coverage_state."firstComparisonFailureAt") AS "firstComparisonFailureAt",
        MAX(coverage_state."lastComparisonFailureAt") AS "lastComparisonFailureAt"
      FROM "network_subscription_coverage_state" AS coverage_state
      GROUP BY ${coverageStateNetwork}
    ),
    header_reconciliation AS (
      SELECT
        CASE
          WHEN reconciliation."network" = 'testnet' THEN 'testnet3'
          ELSE reconciliation."network"
        END AS network,
        COUNT(DISTINCT reconciliation."network") AS "headerReconciliationRowCount",
        MIN(reconciliation."gapStartedAt") AS "headerReconciliationGapStartedAt",
        COUNT(retry."walletId") FILTER (WHERE
          retry_wallet."id" IS NULL
          OR ${retryWalletNetwork} <> CASE
              WHEN reconciliation."network" = 'testnet' THEN 'testnet3'
              ELSE reconciliation."network"
            END
        ) AS "confirmationRetryMismatchCount"
      FROM "network_header_reconciliations" AS reconciliation
      LEFT JOIN "network_header_confirmation_retries" AS retry
        ON retry."network" = reconciliation."network"
      LEFT JOIN "wallets" AS retry_wallet ON retry_wallet."id" = retry."walletId"
      GROUP BY CASE
        WHEN reconciliation."network" = 'testnet' THEN 'testnet3'
        ELSE reconciliation."network"
      END
    )
    SELECT
      represented.network,
      COALESCE(address_coverage.persisted, 0) AS persisted,
      COALESCE(address_coverage.subscribed, 0) AS subscribed,
      COALESCE(address_coverage.pending, 0) AS pending,
      COALESCE(address_coverage.unknown, 0) AS unknown,
      COALESCE(address_coverage."checkpointMismatchCount", 0)
        AS "checkpointMismatchCount",
      COALESCE(unresolved_failures."unresolvedComparisonFailures", 0)
        AS "unresolvedComparisonFailures",
      COALESCE(unresolved_failures."failureMismatchCount", 0)
        AS "failureMismatchCount",
      address_coverage."oldestAddressGapStartedAt",
      COALESCE(header_state."headerRowCount", 0) AS "headerRowCount",
      header_state."headerHeight",
      header_state."headerObservedAt",
      header_state."headerGapStartedAt",
      COALESCE(header_reconciliation."headerReconciliationRowCount", 0)
        AS "headerReconciliationRowCount",
      header_reconciliation."headerReconciliationGapStartedAt",
      COALESCE(header_reconciliation."confirmationRetryMismatchCount", 0)
        AS "confirmationRetryMismatchCount",
      COALESCE(coverage_history."coverageStateRowCount", 0) AS "coverageStateRowCount",
      COALESCE(coverage_history."historicalComparisonFailureCount", 0)
        AS "historicalComparisonFailureCount",
      coverage_history."firstComparisonFailureAt",
      coverage_history."lastComparisonFailureAt"
    FROM represented
    LEFT JOIN address_coverage ON address_coverage.network = represented.network
    LEFT JOIN unresolved_failures ON unresolved_failures.network = represented.network
    LEFT JOIN header_state ON header_state.network = represented.network
    LEFT JOIN header_reconciliation ON header_reconciliation.network = represented.network
    LEFT JOIN coverage_history ON coverage_history.network = represented.network
    ORDER BY represented.network ASC
  `);
}

export async function readSubscriptionCoverageWithClient(
  tx: PrismaTxClient,
): Promise<Extract<SubscriptionCoverageReadResult, { status: "available" }>> {
  const timestamps = await tx.$queryRaw<Array<{ evaluatedAt: Date }>>(Prisma.sql`
    SELECT statement_timestamp() AS "evaluatedAt"
  `);
  const evaluatedAt = coverageEvaluationTime(timestamps[0]?.evaluatedAt);
  const networks = buildCoverageSnapshots(
    await readSubscriptionCoverageRows(tx),
    evaluatedAt,
  );
  return {
    status: "available",
    evaluatedAt,
    ready: networks.every((network) => network.ready),
    networks,
  };
}

export async function readSubscriptionCoverage(): Promise<SubscriptionCoverageReadResult> {
  const fallbackEvaluationTime = new Date();
  try {
    return await prisma.$transaction(
      readSubscriptionCoverageWithClient,
      {
        maxWait: 5_000,
        timeout: 15_000,
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      },
    );
  } catch (error) {
    log.error("Subscription coverage is unavailable", {
      error: getErrorMessage(error),
    });
    return {
      status: "unavailable",
      evaluatedAt: fallbackEvaluationTime,
      ready: false,
      reason:
        error instanceof CoverageDataError
          ? "invalid_data"
          : "storage_unavailable",
    };
  }
}
