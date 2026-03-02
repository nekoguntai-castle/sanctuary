/**
 * Electrum Client Configuration
 *
 * Configuration helpers for the Electrum client, loading timeout and
 * connection settings from centralized config.
 */

import { getConfig } from '../../../config';

/**
 * Get electrum client configuration from centralized config.
 */
export function getElectrumClientConfig() {
  const cfg = getConfig();
  return cfg.electrumClient;
}

/**
 * Get default timeout values from config (cached for performance).
 */
export function getDefaultTimeouts() {
  const cfg = getElectrumClientConfig();
  return {
    requestTimeoutMs: cfg.requestTimeoutMs,
    batchRequestTimeoutMs: cfg.batchRequestTimeoutMs,
    connectionTimeoutMs: cfg.connectionTimeoutMs,
    torTimeoutMultiplier: cfg.torTimeoutMultiplier,
  };
}
