/**
 * Operational Environment Readers
 *
 * Centralizes operational environment variables outside the static AppConfig
 * snapshot so runtime callers never read process.env directly while preserving
 * dynamic per-call evaluation and invariant clamping.
 */

import { parseStringEnv } from './envSections';

const DEFAULT_BACKUP_DIR = '/data/backups';
const DEFAULT_CONSOLE_GATEWAY_TIMEOUT_MS = 125_000;
const DEFAULT_ELECTRUM_LOCK_TTL_MS = 2 * 60 * 1000;
const DEFAULT_ELECTRUM_LOCK_REFRESH_MS = 60 * 1000;
const DEFAULT_ELECTRUM_LOCK_RETRY_MS = 15_000;
const MIN_ELECTRUM_LOCK_TTL_MS = 5_000;
const MIN_ELECTRUM_LOCK_REFRESH_MS = 1_000;
const MIN_ELECTRUM_LOCK_RETRY_MS = 1_000;

export interface ElectrumSubscriptionLockConfig {
  ttlMs: number;
  refreshMs: number;
  retryMs: number;
}

function readPositiveMsEnv(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    return fallback;
  }

  return Math.floor(parsed);
}

/**
 * Load Electrum subscription ownership lock timings, enforcing refreshMs < ttlMs
 * so the owner always renews before its lease expires.
 */
export function loadElectrumSubscriptionLockConfig(): ElectrumSubscriptionLockConfig {
  const ttlMs = readPositiveMsEnv(
    'ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS',
    DEFAULT_ELECTRUM_LOCK_TTL_MS,
    MIN_ELECTRUM_LOCK_TTL_MS,
  );
  const requestedRefreshMs = readPositiveMsEnv(
    'ELECTRUM_SUBSCRIPTION_LOCK_REFRESH_MS',
    DEFAULT_ELECTRUM_LOCK_REFRESH_MS,
    MIN_ELECTRUM_LOCK_REFRESH_MS,
  );
  const maxSafeRefreshMs = Math.max(MIN_ELECTRUM_LOCK_REFRESH_MS, Math.floor(ttlMs / 2));
  const refreshMs = requestedRefreshMs < ttlMs
    ? requestedRefreshMs
    : maxSafeRefreshMs;
  const retryMs = readPositiveMsEnv(
    'ELECTRUM_SUBSCRIPTION_LOCK_RETRY_MS',
    DEFAULT_ELECTRUM_LOCK_RETRY_MS,
    MIN_ELECTRUM_LOCK_RETRY_MS,
  );

  return { ttlMs, refreshMs, retryMs };
}

export function getBackupDir(): string {
  return parseStringEnv('BACKUP_DIR', DEFAULT_BACKUP_DIR);
}

export function isWorkerHealthMonitorEnabled(): boolean {
  return process.env.WORKER_HEALTH_MONITOR_ENABLED !== 'false';
}

export function getConsoleGatewayTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.CONSOLE_GATEWAY_TIMEOUT_MS || '', 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_CONSOLE_GATEWAY_TIMEOUT_MS;
}

export function getWorkerReplicaId(): string | undefined {
  const configured = process.env.WORKER_REPLICA_ID?.trim();
  return configured ? configured : undefined;
}

export function getGrafanaPassword(): string | null {
  return process.env.GRAFANA_PASSWORD || null;
}

export function getEncryptionKeyMaterial(): {
  encryptionKey: string;
  encryptionSalt: string;
} {
  return {
    encryptionKey: parseStringEnv('ENCRYPTION_KEY'),
    encryptionSalt: parseStringEnv('ENCRYPTION_SALT'),
  };
}
