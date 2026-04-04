/**
 * Support Package Collector Registry
 *
 * Registry pattern for support package data collectors.
 * Separated from index.ts to avoid circular initialization issues.
 */

import type { Collector } from '../types';

const collectors = new Map<string, Collector>();

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
