/**
 * WalletDetail Shared Types
 *
 * Types and interfaces shared across WalletDetail tab components.
 */

// Tab types
export type TabType = 'tx' | 'utxo' | 'addresses' | 'drafts' | 'stats' | 'access' | 'settings' | 'log';
export type AddressSubTab = 'receive' | 'change';
export type AccessSubTab = 'ownership' | 'sharing' | 'transfers';
export type SettingsSubTab = 'general' | 'devices' | 'notifications' | 'advanced' | 'autopilot';

// Device share prompt state (used by useWalletSharing hook and DeviceSharePromptModal)
export interface DeviceSharePromptState {
  show: boolean;
  targetUserId: string;
  targetUsername: string;
  devices: Array<{ id: string; label: string; fingerprint: string }>;
}

// Sync retry state (used by useWalletSync hook)
export interface SyncRetryInfo {
  retryCount: number;
  maxRetries: number;
  error?: string;
}
