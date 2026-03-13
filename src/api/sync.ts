/**
 * Sync API
 *
 * API calls for wallet synchronization management
 */

import apiClient from './client';
import type { WalletLogEntry } from '../../hooks/websocket';

export interface SyncStatus {
  lastSyncedAt: string | null;
  syncStatus: string | null;
  syncInProgress: boolean;
  isStale: boolean;
  queuePosition: number | null;
}

export interface SyncResult {
  success: boolean;
  syncedAddresses: number;
  newTransactions: number;
  newUtxos: number;
  error?: string;
}

export interface QueueResult {
  queued: boolean;
  queuePosition: number | null;
  syncInProgress: boolean;
}

/**
 * Trigger immediate sync for a wallet
 */
export async function syncWallet(walletId: string): Promise<SyncResult> {
  return apiClient.post<SyncResult>(`/sync/wallet/${walletId}`);
}

/**
 * Queue a wallet for background sync
 */
export async function queueSync(
  walletId: string,
  priority: 'high' | 'normal' | 'low' = 'normal'
): Promise<QueueResult> {
  return apiClient.post<QueueResult>(`/sync/queue/${walletId}`, { priority });
}

/**
 * Get sync status for a wallet
 */
export async function getSyncStatus(walletId: string): Promise<SyncStatus> {
  return apiClient.get<SyncStatus>(`/sync/status/${walletId}`);
}

/**
 * Queue all user's wallets for background sync
 * Call this on login or page load
 */
export async function queueUserWallets(
  priority: 'high' | 'normal' | 'low' = 'normal'
): Promise<{ success: boolean; message: string }> {
  return apiClient.post<{ success: boolean; message: string }>('/sync/user', { priority });
}

export interface ResyncResult {
  success: boolean;
  message: string;
  deletedTransactions: number;
}

/**
 * Full resync - clears all transactions and re-syncs from blockchain
 * Use this to fix missing transactions (e.g., sent transactions)
 */
export async function resyncWallet(walletId: string): Promise<ResyncResult> {
  return apiClient.post<ResyncResult>(`/sync/resync/${walletId}`);
}

// Network-based sync types
export type NetworkType = 'mainnet' | 'testnet' | 'signet';

export interface NetworkSyncResult {
  success: boolean;
  queued: number;
  walletIds: string[];
  message?: string;
}

export interface NetworkResyncResult {
  success: boolean;
  queued: number;
  walletIds: string[];
  deletedTransactions: number;
  skipped: number;
  message?: string;
}

export interface NetworkSyncStatus {
  network: NetworkType;
  total: number;
  syncing: number;
  synced: number;
  failed: number;
  pending: number;
  lastSyncAt: string | null;
}

/**
 * Queue all wallets of a specific network for sync
 */
export async function syncNetworkWallets(
  network: NetworkType,
  priority: 'high' | 'normal' | 'low' = 'normal'
): Promise<NetworkSyncResult> {
  return apiClient.post<NetworkSyncResult>(`/sync/network/${network}`, { priority });
}

/**
 * Full resync for all wallets of a specific network
 * Clears all transactions and re-syncs from blockchain
 */
export async function resyncNetworkWallets(network: NetworkType): Promise<NetworkResyncResult> {
  return apiClient.post<NetworkResyncResult>(`/sync/network/${network}/resync`, {}, {
    headers: {
      'X-Confirm-Resync': 'true',
    },
  });
}

/**
 * Get aggregate sync status for all wallets of a network
 */
export async function getNetworkSyncStatus(network: NetworkType): Promise<NetworkSyncStatus> {
  return apiClient.get<NetworkSyncStatus>(`/sync/network/${network}/status`);
}

export interface WalletLogsResult {
  logs: WalletLogEntry[];
}

/**
 * Get buffered sync logs for a wallet
 * Returns the most recent logs stored in memory (up to 200 entries)
 */
export async function getWalletLogs(walletId: string): Promise<WalletLogEntry[]> {
  const result = await apiClient.get<WalletLogsResult>(`/sync/logs/${walletId}`);
  return result.logs;
}
