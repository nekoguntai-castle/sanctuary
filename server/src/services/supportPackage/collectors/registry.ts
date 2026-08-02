/**
 * Support Package Collector Registry
 *
 * Registry pattern for support package data collectors.
 * Separated from index.ts to avoid circular initialization issues.
 */

import type {
  Collector,
  SupportPackageAuthority,
  SupportPackageSourceKind,
  SupportPackageSourceProcess,
} from '../types';
import type { z } from 'zod';

const collectors = new Map<string, Collector>();
const shareableCollectors = new Map<string, ShareableCollectorDefinition>();

export interface ShareableCollectorDefinition {
  collect: Collector;
  /** Dispose or fence collector-owned resources after cancellation. */
  cleanup?: (signal: AbortSignal) => Promise<void>;
  schema: z.ZodType;
  sourceProcess: SupportPackageSourceProcess;
  sourceKind: SupportPackageSourceKind;
  authoritativeFor: SupportPackageAuthority[];
  notAuthoritativeFor: SupportPackageAuthority[];
}

/**
 * Register a collector function by name
 */
export function registerCollector(name: string, fn: Collector): void {
  if (collectors.has(name)) {
    throw new Error(`Support package collector '${name}' already registered`);
  }
  collectors.set(name, fn);
}

/**
 * Get all registered collectors
 */
export function getCollectors(): Map<string, Collector> {
  return collectors;
}

/**
 * Explicitly admit a collector to the downloadable aggregate profile.
 * Legacy registration alone never makes collector output shareable.
 */
export function registerShareableCollector(
  name: string,
  definition: ShareableCollectorDefinition
): void {
  registerCollector(name, definition.collect);
  shareableCollectors.set(name, definition);
}

/** Return only collectors admitted through the strict shareable registry. */
export function getShareableCollectors(): Map<string, ShareableCollectorDefinition> {
  return shareableCollectors;
}
