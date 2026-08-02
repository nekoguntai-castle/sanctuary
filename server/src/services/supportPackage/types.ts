/**
 * Support Package Types
 *
 * Type definitions for the support package diagnostic bundle system.
 */

/**
 * Context provided to each collector during package generation
 */
export interface CollectorContext {
  /** Deterministic anonymization function: anonymize('wallet', realId) → 'wallet-a3f2c1d8' */
  anonymize: (category: string, id: string) => string;
  /** Package generation timestamp */
  generatedAt: Date;
  /** Cooperative cancellation signal for all collector-owned work. */
  signal: AbortSignal;
  /** Absolute collection deadline in epoch milliseconds. */
  deadlineMs: number;
}

export const SUPPORT_PACKAGE_FAILURE_CODES = [
  'timeout',
  'unavailable',
  'privacy_policy_violation',
  'internal_error',
] as const;

export type SupportPackageFailureCode = typeof SUPPORT_PACKAGE_FAILURE_CODES[number];

export const SUPPORT_PACKAGE_SOURCE_PROCESSES = [
  'api',
  'worker',
  'redis_shared',
  'database_shared',
] as const;

export type SupportPackageSourceProcess = typeof SUPPORT_PACKAGE_SOURCE_PROCESSES[number];

export const SUPPORT_PACKAGE_SOURCE_KINDS = [
  'static_configuration',
  'effective_configuration',
  'aggregate_query',
  'direct_worker_probe',
  'queue_getters',
  'rolling_aggregate',
] as const;
export type SupportPackageSourceKind = typeof SUPPORT_PACKAGE_SOURCE_KINDS[number];

/**
 * Diagnostic claims that a collector can or cannot support. Static defaults
 * describe startup configuration; effective configuration describes current
 * runtime state; worker delivery requires evidence from the worker process.
 */
export const SUPPORT_PACKAGE_AUTHORITIES = [
  'static_notification_configuration',
  'effective_notification_configuration',
  'notification_queue',
  'worker_notification_capability',
  'worker_delivery_aggregates',
  'worker_delivery',
] as const;
export type SupportPackageAuthority = typeof SUPPORT_PACKAGE_AUTHORITIES[number];

/** Source and freshness contract attached to every collector result. */
export interface CollectorProvenance {
  collectorProcess: 'api';
  sourceProcess: SupportPackageSourceProcess;
  sourceKind: SupportPackageSourceKind;
  /** Time the API collector sampled the source. */
  sampledAt: string;
  /** Time through which the underlying source data is known to be current. */
  dataAsOf: string;
  observationWindow: 'point_in_time';
  /** Claims this section is permitted to establish. */
  authoritativeFor: SupportPackageAuthority[];
  /** Related claims this section explicitly does not establish. */
  notAuthoritativeFor: SupportPackageAuthority[];
}

/** Strict envelope for a successful or fixed-code failed collector. */
export interface CollectorSection {
  status: 'ok' | 'error';
  durationMs: number;
  /** Whether data was intentionally bounded by the collector. */
  truncated: boolean;
  /** Number of source records omitted by that bound. */
  droppedCount: number;
  provenance: CollectorProvenance;
  data?: unknown;
  error?: SupportPackageFailureCode;
}

/**
 * Result from a single collector
 */
export interface CollectorResult {
  /** Collector name (e.g., 'telegram', 'system') */
  name: string;
  /** Collected data */
  data: Record<string, unknown>;
  /** Time taken to collect in milliseconds */
  durationMs: number;
  /** Error message if collection failed */
  error?: string;
}

/**
 * Complete support package output
 */
export interface SupportPackage {
  /** Package format version */
  version: string;
  /** ISO timestamp of generation */
  generatedAt: string;
  /** Sanctuary server version */
  serverVersion: string;
  /** Results from all collectors, keyed by collector name */
  profile: 'shareable_aggregate';
  collectors: Record<string, CollectorSection>;
  /** Metadata about the generation run */
  meta: {
    /** Total generation time in milliseconds */
    totalDurationMs: number;
    /** List of collectors that succeeded */
    succeeded: string[];
    /** List of collectors that failed */
    failed: string[];
  };
}

/**
 * Collector function signature
 */
export type Collector = (context: CollectorContext) => Promise<Record<string, unknown>>;

/**
 * Options for generating a support package
 */
export interface GenerateOptions {
  /** Specific collectors to run (runs all if not specified) */
  only?: string[];
  /** Collector deadline override for tests; production uses the bounded default. */
  collectorTimeoutMs?: number;
  /** Bounded quiescence window after collector cancellation. */
  cleanupTimeoutMs?: number;
}
