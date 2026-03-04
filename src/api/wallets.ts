/**
 * Wallets API
 *
 * API calls for wallet management
 */

import apiClient from './client';
import type { Wallet, WalletRole } from '../types';

// Re-export types for backward compatibility
export type { Wallet, WalletRole } from '../types';

export interface CreateWalletRequest {
  name: string;
  type: 'single_sig' | 'multi_sig';
  scriptType: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
  network?: 'mainnet' | 'testnet' | 'regtest' | 'signet';
  quorum?: number;
  totalSigners?: number;
  descriptor?: string;
  fingerprint?: string;
  groupId?: string;
  deviceIds?: string[];
}

export interface UpdateWalletRequest {
  name?: string;
  descriptor?: string;
}

export interface WalletStats {
  balance: number;
  received: number;
  sent: number;
  transactionCount: number;
  utxoCount: number;
  addressCount: number;
}

export interface GenerateAddressResponse {
  address: string;
}

export interface AddDeviceToWalletRequest {
  deviceId: string;
  signerIndex?: number;
}

// Import-related types
export interface DeviceResolution {
  fingerprint: string;
  xpub: string;
  derivationPath: string;
  existingDeviceId: string | null;
  existingDeviceLabel: string | null;
  willCreate: boolean;
  suggestedLabel?: string;
  originalType?: string;
}

export interface ImportValidationResult {
  valid: boolean;
  error?: string;
  format: 'descriptor' | 'json' | 'wallet_export' | 'bluewallet_text';
  walletType: 'single_sig' | 'multi_sig';
  scriptType: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
  network: 'mainnet' | 'testnet' | 'regtest' | 'signet';
  quorum?: number;
  totalSigners?: number;
  devices: DeviceResolution[];
  suggestedName?: string;
}

export interface ImportWalletRequest {
  data: string; // Descriptor or JSON
  name: string;
  network?: 'mainnet' | 'testnet' | 'regtest' | 'signet';
  deviceLabels?: Record<string, string>;
}

export interface ImportWalletResult {
  wallet: {
    id: string;
    name: string;
    type: string;
    scriptType: string;
    network: string;
    quorum?: number | null;
    totalSigners?: number | null;
    descriptor?: string | null;
  };
  devicesCreated: number;
  devicesReused: number;
  createdDeviceIds: string[];
  reusedDeviceIds: string[];
}

/**
 * Get all wallets for current user
 */
export async function getWallets(): Promise<Wallet[]> {
  return apiClient.get<Wallet[]>('/wallets');
}

/**
 * Get a specific wallet by ID
 */
export async function getWallet(walletId: string): Promise<Wallet> {
  return apiClient.get<Wallet>(`/wallets/${walletId}`);
}

/**
 * Create a new wallet
 */
export async function createWallet(data: CreateWalletRequest): Promise<Wallet> {
  return apiClient.post<Wallet>('/wallets', data);
}

/**
 * Update a wallet
 */
export async function updateWallet(walletId: string, data: UpdateWalletRequest): Promise<Wallet> {
  return apiClient.patch<Wallet>(`/wallets/${walletId}`, data);
}

/**
 * Delete a wallet
 */
export async function deleteWallet(walletId: string): Promise<void> {
  return apiClient.delete<void>(`/wallets/${walletId}`);
}

export interface RepairWalletResult {
  success: boolean;
  message: string;
}

/**
 * Repair wallet descriptor
 * Regenerates descriptor from attached devices for wallets missing a descriptor
 */
export async function repairWallet(walletId: string): Promise<RepairWalletResult> {
  return apiClient.post<RepairWalletResult>(`/wallets/${walletId}/repair`);
}

/**
 * Get wallet statistics
 */
export async function getWalletStats(walletId: string): Promise<WalletStats> {
  return apiClient.get<WalletStats>(`/wallets/${walletId}/stats`);
}

/**
 * Generate a new receiving address
 */
export async function generateAddress(walletId: string): Promise<GenerateAddressResponse> {
  return apiClient.post<GenerateAddressResponse>(`/wallets/${walletId}/addresses`);
}

/**
 * Add a device to a wallet
 */
export async function addDeviceToWallet(
  walletId: string,
  data: AddDeviceToWalletRequest
): Promise<{ message: string }> {
  return apiClient.post<{ message: string }>(`/wallets/${walletId}/devices`, data);
}

/**
 * Validate import data and preview what will happen
 */
export async function validateImport(input: {
  descriptor?: string;
  json?: string;
}): Promise<ImportValidationResult> {
  return apiClient.post<ImportValidationResult>('/wallets/import/validate', input);
}

/**
 * Import a wallet from descriptor or JSON
 */
export async function importWallet(data: ImportWalletRequest): Promise<ImportWalletResult> {
  return apiClient.post<ImportWalletResult>('/wallets/import', data);
}

// Wallet sharing types
export interface ShareWithGroupRequest {
  groupId: string | null;
  role?: 'viewer' | 'signer';
}

export interface ShareWithUserRequest {
  targetUserId: string;
  role?: 'viewer' | 'signer';
}

export interface WalletShareInfo {
  group: {
    id: string;
    name: string;
    role: string;
  } | null;
  users: Array<{
    id: string;
    username: string;
    role: string;
  }>;
}

/**
 * Share wallet with a group
 */
export async function shareWalletWithGroup(walletId: string, data: ShareWithGroupRequest): Promise<{ success: boolean; groupId: string | null; groupName: string | null }> {
  return apiClient.post(`/wallets/${walletId}/share/group`, data);
}

export interface ShareWithUserResponse {
  success: boolean;
  message: string;
  devicesToShare?: Array<{
    id: string;
    label: string;
    fingerprint: string;
  }>;
}

/**
 * Share wallet with a specific user
 */
export async function shareWalletWithUser(walletId: string, data: ShareWithUserRequest): Promise<ShareWithUserResponse> {
  return apiClient.post(`/wallets/${walletId}/share/user`, data);
}

/**
 * Remove user from wallet
 */
export async function removeUserFromWallet(walletId: string, targetUserId: string): Promise<{ success: boolean; message: string }> {
  return apiClient.delete(`/wallets/${walletId}/share/user/${targetUserId}`);
}

/**
 * Get wallet sharing info
 */
export async function getWalletShareInfo(walletId: string): Promise<WalletShareInfo> {
  return apiClient.get(`/wallets/${walletId}/share`);
}

// Export types
export interface WalletExportKeystore {
  label: string;
  source: string;
  walletModel: string;
  keyDerivation: {
    masterFingerprint: string;
    derivationPath: string;
  };
  extendedPublicKey: string;
}

export interface WalletExport {
  label: string;
  name: string;
  policyType: 'SINGLE' | 'MULTI';
  scriptType: string;
  defaultPolicy?: {
    name: string;
    miniscript: string;
  };
  keystores: WalletExportKeystore[];
  network: string;
  descriptor?: string;
  gapLimit: number;
  exportedAt: string;
  exportedFrom: string;
  version: string;
}

/**
 * Export format info
 */
export interface ExportFormat {
  id: string;
  name: string;
  description: string;
  extension: string;
  mimeType: string;
}

/**
 * Get available export formats for a wallet
 */
export async function getExportFormats(walletId: string): Promise<{ formats: ExportFormat[] }> {
  return apiClient.get(`/wallets/${walletId}/export/formats`);
}

/**
 * Export wallet in Sparrow-compatible JSON format (legacy method)
 */
export async function exportWallet(walletId: string): Promise<WalletExport> {
  return apiClient.get(`/wallets/${walletId}/export`);
}

/**
 * Export wallet in the specified format
 * Downloads the file directly
 */
export async function exportWalletFormat(
  walletId: string,
  formatId: string,
  walletName: string
): Promise<void> {
  const fallbackFilename = `${walletName.replace(/[^a-zA-Z0-9-_]/g, '_')}_export`;
  await apiClient.download(
    `/wallets/${walletId}/export`,
    fallbackFilename,
    { params: { format: formatId } }
  );
}

/**
 * Export wallet labels in BIP 329 format (JSON Lines)
 * Downloads the file directly
 */
export async function exportLabelsBip329(walletId: string, walletName: string): Promise<void> {
  const filename = `${walletName.replace(/[^a-zA-Z0-9]/g, '_')}_labels_bip329.jsonl`;
  await apiClient.download(`/wallets/${walletId}/export/labels`, filename);
}

// ============================================================================
// TELEGRAM SETTINGS
// ============================================================================

import type { WalletTelegramSettings, WalletAutopilotSettings, AutopilotStatus } from '../../types';

/**
 * Get Telegram notification settings for a wallet
 */
export async function getWalletTelegramSettings(walletId: string): Promise<WalletTelegramSettings> {
  const response = await apiClient.get<{ settings: WalletTelegramSettings }>(`/wallets/${walletId}/telegram`);
  return response.settings;
}

/**
 * Update Telegram notification settings for a wallet
 */
export async function updateWalletTelegramSettings(
  walletId: string,
  settings: Partial<WalletTelegramSettings>
): Promise<void> {
  await apiClient.patch(`/wallets/${walletId}/telegram`, settings);
}

// ============================================================================
// AUTOPILOT SETTINGS
// ============================================================================

/**
 * Get autopilot settings for a wallet
 */
export async function getWalletAutopilotSettings(walletId: string): Promise<WalletAutopilotSettings> {
  const response = await apiClient.get<{ settings: WalletAutopilotSettings }>(`/wallets/${walletId}/autopilot`);
  return response.settings;
}

/**
 * Update autopilot settings for a wallet
 */
export async function updateWalletAutopilotSettings(
  walletId: string,
  settings: Partial<WalletAutopilotSettings>
): Promise<void> {
  await apiClient.patch(`/wallets/${walletId}/autopilot`, settings);
}

/**
 * Get autopilot status including UTXO health and fee snapshot
 */
export async function getWalletAutopilotStatus(walletId: string): Promise<AutopilotStatus> {
  return apiClient.get<AutopilotStatus>(`/wallets/${walletId}/autopilot/status`);
}
