/**
 * WalletDetail Shared Types
 *
 * Types and interfaces shared across WalletDetail tab components.
 */

// Tab types
export { WALLET_DETAIL_TAB_IDS } from './tabDefinitions';
export type { WalletDetailTabId as TabType } from './tabDefinitions';
export type AddressSubTab = 'receive' | 'change';
export type AccessSubTab = 'ownership' | 'sharing' | 'transfers';
export type SettingsSubTab = 'general' | 'devices' | 'notifications' | 'webhooks' | 'advanced' | 'autopilot';

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
