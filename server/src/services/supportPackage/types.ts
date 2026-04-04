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
  collectors: Record<string, CollectorResult['data'] | { error: string }>;
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
}
