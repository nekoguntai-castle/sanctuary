/**
 * Business Metrics
 *
 * Prometheus metrics for wallet, transaction, and user activity tracking.
 */

import { Counter, Gauge, Histogram } from 'prom-client';
import { registry } from './registry';

/**
 * Wallet sync operations counter
 */
export const walletSyncsTotal = new Counter({
  name: 'sanctuary_wallet_syncs_total',
  help: 'Total wallet synchronization operations',
  labelNames: ['status'], // 'success', 'failure'
  registers: [registry],
});

/**
 * Wallet sync duration histogram
 */
export const walletSyncDuration = new Histogram({
  name: 'sanctuary_wallet_sync_duration_seconds',
  help: 'Duration of wallet sync operations in seconds',
  labelNames: ['walletType'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [registry],
});

/**
 * Transaction broadcast counter
 */
export const transactionBroadcastsTotal = new Counter({
  name: 'sanctuary_transaction_broadcasts_total',
  help: 'Total transaction broadcast attempts',
  labelNames: ['status'], // 'success', 'failure'
  registers: [registry],
});

/**
 * Active wallets gauge
 */
export const activeWallets = new Gauge({
  name: 'sanctuary_active_wallets',
  help: 'Number of active wallets in the system',
  registers: [registry],
});

/**
 * Active users gauge
 */
export const activeUsers = new Gauge({
  name: 'sanctuary_active_users',
  help: 'Number of active user sessions',
  registers: [registry],
});

/**
 * Sync polling mode transition counter
 */
export const syncPollingModeTransitions = new Counter({
  name: 'sanctuary_sync_polling_mode_transitions_total',
  help: 'Polling mode transitions between in-process and worker-delegated',
  labelNames: ['from', 'to'],
  registers: [registry],
});

/** Stale browser access/CSRF pairs cleared or destructively recovered. */
export const authCsrfSessionStaleTotal = new Counter({
  name: 'sanctuary_auth_csrf_session_stale_total',
  help: 'Total stale browser access and CSRF cookie pairs classified by the auth boundary',
  registers: [registry],
});
