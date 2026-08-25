import {
  resolvePersistedBitcoinNetwork,
  type BitcoinNetwork,
} from "../constants/bitcoinNetworks";
import { getErrorMessage } from "../utils/errors";
import type {
  NetworkSubscriptionCoverageSnapshot,
  SubscriptionCoverageReason,
} from "./subscriptionCoverageTypes";

const MAX_DATABASE_COUNTER = 2_147_483_647;

export class CoverageDataError extends Error {}

export interface SubscriptionCoverageRow {
  network: unknown;
  persisted: unknown;
  subscribed: unknown;
  pending: unknown;
  unknown: unknown;
  checkpointMismatchCount: unknown;
  unresolvedComparisonFailures: unknown;
  failureMismatchCount: unknown;
  oldestAddressGapStartedAt: unknown;
  headerRowCount: unknown;
  headerHeight: unknown;
  headerObservedAt: unknown;
  headerGapStartedAt: unknown;
  headerReconciliationRowCount: unknown;
  headerReconciliationGapStartedAt: unknown;
  coverageStateRowCount: unknown;
  historicalComparisonFailureCount: unknown;
  firstComparisonFailureAt: unknown;
  lastComparisonFailureAt: unknown;
}

function countValue(value: unknown, description: string): number {
  let count: bigint;
  try {
    count =
      typeof value === "bigint" ? value : BigInt(value as string | number);
  } catch {
    throw new Error(`${description} is not an integer`);
  }
  if (count < 0n || count > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${description} is outside the safe integer range`);
  }
  return Number(count);
}

function nullableDate(value: unknown, description: string) {
  if (value === null || value === undefined) return null;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${description} is not a valid date`);
  }
  return value;
}

function requiredDate(value: unknown, description: string): Date {
  const parsed = nullableDate(value, description);
  if (!parsed) throw new Error(`${description} is missing`);
  return parsed;
}

export function coverageEvaluationTime(value: unknown): Date {
  try {
    return requiredDate(value, "Coverage evaluation time");
  } catch (error) {
    throw new CoverageDataError(getErrorMessage(error));
  }
}

function minimumDate(...values: Array<Date | null>) {
  const present = values.filter((value): value is Date => value !== null);
  if (present.length === 0) return null;
  return new Date(Math.min(...present.map((value) => value.getTime())));
}

interface ParsedSubscriptionCoverageRow {
  network: BitcoinNetwork;
  persisted: number;
  subscribed: number;
  pending: number;
  unknown: number;
  checkpointMismatchCount: number;
  unresolvedComparisonFailures: number;
  failureMismatchCount: number;
  oldestAddressGapStartedAt: Date | null;
  headerRowCount: number;
  headerHeight: number | null;
  headerObservedAt: Date | null;
  headerGapStartedAt: Date | null;
  headerReconciliationRowCount: number;
  headerReconciliationGapStartedAt: Date | null;
  coverageStateRowCount: number;
  historicalComparisonFailureCount: number;
  firstComparisonFailureAt: Date | null;
  lastComparisonFailureAt: Date | null;
}

function parseOptionalHeight(value: unknown) {
  if (value === null || value === undefined) return null;
  const height = countValue(value, "Header checkpoint height");
  if (height > MAX_DATABASE_COUNTER)
    throw new Error("Header checkpoint height is invalid");
  return height;
}

function parseSubscriptionCoverageRow(
  row: SubscriptionCoverageRow,
) {
  const network = resolvePersistedBitcoinNetwork(row.network);
  const persisted = countValue(row.persisted, "Persisted address count");
  const subscribed = countValue(row.subscribed, "Subscribed address count");
  const pending = countValue(row.pending, "Pending address count");
  const unknown = countValue(row.unknown, "Unknown address count");
  const checkpointMismatchCount = countValue(
    row.checkpointMismatchCount,
    "Checkpoint mismatch count",
  );
  const unresolvedComparisonFailures = countValue(
    row.unresolvedComparisonFailures,
    "Unresolved comparison failure count",
  );
  const failureMismatchCount = countValue(
    row.failureMismatchCount,
    "Failure mismatch count",
  );
  const oldestAddressGapStartedAt = nullableDate(
    row.oldestAddressGapStartedAt,
    "Oldest address coverage gap start",
  );
  const headerRowCount = countValue(
    row.headerRowCount,
    "Header checkpoint row count",
  );
  const headerHeight = parseOptionalHeight(row.headerHeight);
  const headerObservedAt = nullableDate(
    row.headerObservedAt,
    "Header observation time",
  );
  const headerGapStartedAt = nullableDate(
    row.headerGapStartedAt,
    "Header coverage gap start",
  );
  const headerReconciliationRowCount = countValue(
    row.headerReconciliationRowCount,
    "Header reconciliation row count",
  );
  const headerReconciliationGapStartedAt = nullableDate(
    row.headerReconciliationGapStartedAt,
    "Header reconciliation gap start",
  );
  const coverageStateRowCount = countValue(
    row.coverageStateRowCount,
    "Coverage history row count",
  );
  const historicalComparisonFailureCount = countValue(
    row.historicalComparisonFailureCount,
    "Historical comparison failure count",
  );
  const firstComparisonFailureAt = nullableDate(
    row.firstComparisonFailureAt,
    "First comparison failure time",
  );
  const lastComparisonFailureAt = nullableDate(
    row.lastComparisonFailureAt,
    "Last comparison failure time",
  );
  return {
    network,
    persisted,
    subscribed,
    pending,
    unknown,
    checkpointMismatchCount,
    unresolvedComparisonFailures,
    failureMismatchCount,
    oldestAddressGapStartedAt,
    headerRowCount,
    headerHeight,
    headerObservedAt,
    headerGapStartedAt,
    headerReconciliationRowCount,
    headerReconciliationGapStartedAt,
    coverageStateRowCount,
    historicalComparisonFailureCount,
    firstComparisonFailureAt,
    lastComparisonFailureAt,
  };
}

// These assertions convert drift, partial rows, and canonical-network
// collisions into invalid_data. None may degrade to an optimistic snapshot.
function assertCoveragePartition(row: ParsedSubscriptionCoverageRow) {
  const partition = row.subscribed + row.pending + row.unknown;
  if (partition !== row.persisted)
    throw new Error("Subscription coverage partition is incomplete");
  if (row.checkpointMismatchCount !== 0 || row.failureMismatchCount !== 0) {
    throw new Error("Subscription coverage contains mismatched durable state");
  }
  if (
    row.headerRowCount > 1
    || row.headerReconciliationRowCount > 1
    || row.coverageStateRowCount > 1
  ) {
    throw new Error(
      "Subscription coverage contains duplicate canonical network state",
    );
  }
  if (row.unresolvedComparisonFailures > row.pending + row.unknown) {
    throw new Error(
      "Subscription coverage has more failures than blocking addresses",
    );
  }
}

function assertAddressGapState(row: ParsedSubscriptionCoverageRow) {
  const addressGapCount = row.pending + row.unknown;
  if ((addressGapCount === 0) !== (row.oldestAddressGapStartedAt === null)) {
    throw new Error("Subscription coverage gap timestamp is incoherent");
  }
}

function assertCoverageHistory(row: ParsedSubscriptionCoverageRow) {
  const historyEmpty = row.historicalComparisonFailureCount === 0;
  const historyTimesEmpty =
    row.firstComparisonFailureAt === null &&
    row.lastComparisonFailureAt === null;
  const historyTimesComplete =
    row.firstComparisonFailureAt !== null &&
    row.lastComparisonFailureAt !== null;
  if (
    (historyEmpty && !historyTimesEmpty) ||
    (!historyEmpty && !historyTimesComplete)
  ) {
    throw new Error("Subscription coverage history is incoherent");
  }
  if ((row.coverageStateRowCount === 0) !== historyEmpty) {
    throw new Error("Subscription coverage history row is incoherent");
  }
  if (
    row.firstComparisonFailureAt &&
    row.lastComparisonFailureAt &&
    row.lastComparisonFailureAt < row.firstComparisonFailureAt
  ) {
    throw new Error("Subscription coverage history timestamps are reversed");
  }
}

function assertHeaderState(row: ParsedSubscriptionCoverageRow) {
  const headerFieldsEmpty =
    row.headerHeight === null && row.headerObservedAt === null;
  const headerFieldsComplete =
    row.headerHeight !== null && row.headerObservedAt !== null;
  if (
    (row.headerRowCount === 0 && !headerFieldsEmpty) ||
    (row.headerRowCount === 1 && !headerFieldsComplete)
  ) {
    throw new Error("Header checkpoint state is incoherent");
  }
  if (
    (row.headerReconciliationRowCount === 0
      && row.headerReconciliationGapStartedAt !== null)
    || (row.headerReconciliationRowCount === 1
      && row.headerReconciliationGapStartedAt === null)
  ) {
    throw new Error("Header reconciliation gap state is incoherent");
  }
}

function assertSubscriptionCoverageRow(row: ParsedSubscriptionCoverageRow) {
  assertCoveragePartition(row);
  assertAddressGapState(row);
  assertCoverageHistory(row);
  assertHeaderState(row);
}

function coverageReason(
  row: ParsedSubscriptionCoverageRow,
): SubscriptionCoverageReason {
  // Report the earliest proof obligation: header coverage gates address state,
  // then exact failures outrank the derived unknown/pending buckets.
  if (row.headerRowCount === 0) return "header_unknown";
  if (row.headerGapStartedAt || row.headerReconciliationRowCount > 0) return "header_gap";
  if (row.unresolvedComparisonFailures > 0) return "comparison_failure";
  if (row.unknown > 0) return "subscription_unknown";
  if (row.pending > 0) return "subscription_pending";
  return "ready";
}

function toCoverageSnapshot(
  row: ParsedSubscriptionCoverageRow,
  evaluatedAt: Date,
): NetworkSubscriptionCoverageSnapshot {
  assertSubscriptionCoverageRow(row);
  const reason = coverageReason(row);
  const headerKnown = row.headerRowCount === 1;
  const gapStart = minimumDate(
    row.oldestAddressGapStartedAt,
    row.headerGapStartedAt,
    row.headerReconciliationGapStartedAt,
  );
  const gapAge = gapStart ? evaluatedAt.getTime() - gapStart.getTime() : null;
  if (gapAge !== null && gapAge < 0)
    throw new Error("Coverage gap starts after evaluation time");
  return {
    network: row.network,
    evaluatedAt,
    persisted: row.persisted,
    subscribed: row.subscribed,
    pending: row.pending,
    unknown: row.unknown,
    unresolvedComparisonFailures: row.unresolvedComparisonFailures,
    historicalComparisonFailureCount: row.historicalComparisonFailureCount,
    firstComparisonFailureAt: row.firstComparisonFailureAt,
    lastComparisonFailureAt: row.lastComparisonFailureAt,
    oldestOpenGapStartedAt: gapStart,
    oldestOpenGapAgeMs: gapAge,
    headerCheckpointKnown: headerKnown,
    headerReconciliationPending: row.headerReconciliationRowCount === 1,
    headerHeight: row.headerHeight,
    headerObservedAt: row.headerObservedAt,
    ready: reason === "ready",
    reason,
  };
}

export function buildCoverageSnapshots(
  rows: SubscriptionCoverageRow[],
  evaluatedAt: Date,
): NetworkSubscriptionCoverageSnapshot[] {
  try {
    return rows
      .map(parseSubscriptionCoverageRow)
      .map((row) => toCoverageSnapshot(row, evaluatedAt));
  } catch (error) {
    throw new CoverageDataError(getErrorMessage(error));
  }
}
