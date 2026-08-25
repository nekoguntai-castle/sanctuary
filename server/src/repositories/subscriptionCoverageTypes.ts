import type { BitcoinNetwork } from "../constants/bitcoinNetworks";

export interface RecordSubscriptionComparisonFailureInput {
  addressId: string;
  network: BitcoinNetwork;
  enrollmentGeneration: number;
  failedAt: Date;
}

export type RecordSubscriptionComparisonFailureResult =
  { status: "recorded"; historicalCount: number } | { status: "not_applied" };

export type SubscriptionCoverageReason =
  | "ready"
  | "header_unknown"
  | "header_gap"
  | "comparison_failure"
  | "subscription_unknown"
  | "subscription_pending";

export interface NetworkSubscriptionCoverageSnapshot {
  network: BitcoinNetwork;
  evaluatedAt: Date;
  /** All durable addresses owned by wallets on this network. */
  persisted: number;
  /** Exact checkpoints whose requested generation has been processed. */
  subscribed: number;
  /** Known checkpoints with a requested generation still outstanding. */
  pending: number;
  /** Missing checkpoints or checkpoints whose status is not yet known. */
  unknown: number;
  /** Current exact address+generation failures; these block readiness. */
  unresolvedComparisonFailures: number;
  /** Monotonic lifetime attempt count; recovery never decrements it. */
  historicalComparisonFailureCount: number;
  firstComparisonFailureAt: Date | null;
  lastComparisonFailureAt: Date | null;
  oldestOpenGapStartedAt: Date | null;
  oldestOpenGapAgeMs: number | null;
  headerCheckpointKnown: boolean;
  headerReconciliationPending: boolean;
  headerHeight: number | null;
  headerObservedAt: Date | null;
  ready: boolean;
  reason: SubscriptionCoverageReason;
}

export type SubscriptionCoverageReadResult =
  | {
      status: "available";
      evaluatedAt: Date;
      ready: boolean;
      networks: NetworkSubscriptionCoverageSnapshot[];
    }
  | {
      status: "unavailable";
      evaluatedAt: Date;
      ready: false;
      reason: "invalid_data" | "storage_unavailable";
    };
