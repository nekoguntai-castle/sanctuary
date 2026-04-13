/**
 * Two-Factor Authentication API
 *
 * API calls for 2FA setup, verification, and management
 */

import apiClient from './client';
import type { AuthResponse } from './auth';

export interface TwoFactorSetupResponse {
  secret: string;
  qrCodeDataUrl: string;
}

export interface TwoFactorEnableResponse {
  success: boolean;
  backupCodes: string[];
}

export interface TwoFactorVerifyRequest {
  tempToken: string;
  code: string;
}

export interface TwoFactorDisableRequest {
  password: string;
  token: string;
}

export interface BackupCodesResponse {
  remaining: number;
}

export interface RegenerateBackupCodesRequest {
  password: string;
  token: string;
}

export interface RegenerateBackupCodesResponse {
  success: boolean;
  backupCodes: string[];
}

/**
 * Start 2FA setup - get QR code and secret
 */
export async function setup2FA(): Promise<TwoFactorSetupResponse> {
  return apiClient.post<TwoFactorSetupResponse>('/auth/2fa/setup', {});
}

/**
 * Enable 2FA by verifying a TOTP code
 */
export async function enable2FA(token: string): Promise<TwoFactorEnableResponse> {
  return apiClient.post<TwoFactorEnableResponse>('/auth/2fa/enable', { token });
}

/**
 * Disable 2FA (requires password and current 2FA code)
 */
export async function disable2FA(data: TwoFactorDisableRequest): Promise<{ success: boolean }> {
  return apiClient.post<{ success: boolean }>('/auth/2fa/disable', data);
}

/**
 * Verify 2FA code during login.
 *
 * ADR 0001 / 0002 Phase 4: no token persistence on the browser side.
 * The backend sets the sanctuary_access / _refresh / _csrf cookies on
 * this response and the ApiClient reads the X-Access-Expires-At header
 * to schedule the next refresh. The caller receives the user object
 * for context hydration only.
 */
export async function verify2FA(data: TwoFactorVerifyRequest): Promise<AuthResponse> {
  return apiClient.post<AuthResponse>('/auth/2fa/verify', data);
}

/**
 * Get remaining backup codes count
 * Uses POST to prevent password exposure in URL/logs
 */
export async function getBackupCodesCount(password: string): Promise<BackupCodesResponse> {
  return apiClient.post<BackupCodesResponse>('/auth/2fa/backup-codes', { password });
}

/**
 * Regenerate backup codes
 */
export async function regenerateBackupCodes(
  data: RegenerateBackupCodesRequest
): Promise<RegenerateBackupCodesResponse> {
  return apiClient.post<RegenerateBackupCodesResponse>('/auth/2fa/backup-codes/regenerate', data);
}
