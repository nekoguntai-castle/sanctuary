/**
 * Devices API
 *
 * API calls for hardware device management
 */

import apiClient from './client';
import type { Device, HardwareDeviceModel, DeviceShareInfo } from '../types';
import type {
  DeviceAccountPurpose,
  WalletScriptType,
} from '@sanctuary/shared/constants/walletIdentity';

// Re-export types for backward compatibility
export type { Device, HardwareDeviceModel, DeviceShareInfo, DeviceRole } from '../types';

/**
 * Account input for multi-account device registration
 */
export interface DeviceAccountInput {
  purpose: DeviceAccountPurpose;
  scriptType: WalletScriptType;
  derivationPath: string;
  xpub: string;
}

export interface CreateDeviceRequest {
  type: string;
  label: string;
  fingerprint: string;
  /** Single xpub (legacy mode) - use accounts[] for multi-account */
  derivationPath?: string;
  /** Single xpub (legacy mode) - use accounts[] for multi-account */
  xpub?: string;
  modelSlug?: string;
  /** Multiple accounts for multi-account import (preferred) */
  accounts?: DeviceAccountInput[];
  /** Set to true to merge accounts into existing device with same fingerprint */
  merge?: boolean;
}

/**
 * Response when a device with same fingerprint already exists
 */
export interface DeviceConflictResponse {
  error: 'Conflict';
  message: string;
  existingDevice: {
    id: string;
    label: string;
    fingerprint: string;
    type: string;
    model?: HardwareDeviceModel;
    accounts: Array<{
      id: string;
      purpose: string;
      scriptType: string;
      derivationPath: string;
      xpub: string;
    }>;
  };
  comparison: {
    /** Accounts that can be added (don't exist yet) */
    newAccounts: DeviceAccountInput[];
    /** Accounts that already exist with same xpub */
    matchingAccounts: DeviceAccountInput[];
    /** Accounts with same path but different xpub - potential security issue */
    conflictingAccounts: Array<{
      incoming: DeviceAccountInput;
      existing: { derivationPath: string; xpub: string };
    }>;
  };
}

/**
 * Response when merge succeeds
 */
export interface DeviceMergeResponse {
  message: string;
  device: Device;
  added: number;
}

export interface UpdateDeviceRequest {
  label?: string;
  derivationPath?: string;
  type?: string;
  modelSlug?: string;
}

/**
 * Get all devices for current user
 */
export async function getDevices(): Promise<Device[]> {
  return apiClient.get<Device[]>('/devices');
}

/**
 * Get a specific device by ID
 */
export async function getDevice(deviceId: string, signal?: AbortSignal): Promise<Device> {
  return apiClient.get<Device>(`/devices/${deviceId}`, undefined, undefined, { signal });
}

/**
 * Result of attempting to create a device
 */
export type CreateDeviceResult =
  | { status: 'created'; device: Device }
  | { status: 'conflict'; conflict: DeviceConflictResponse }
  | { status: 'merged'; result: DeviceMergeResponse };

/**
 * Register a new device
 * Note: This may throw a 409 error if device exists. Use createDeviceWithConflictHandling
 * for explicit conflict handling.
 */
export async function createDevice(data: CreateDeviceRequest): Promise<Device> {
  return apiClient.post<Device>('/devices', data);
}

/**
 * Register a new device with explicit conflict handling
 * Returns structured result indicating success, conflict, or merge result
 */
export async function createDeviceWithConflictHandling(
  data: CreateDeviceRequest
): Promise<CreateDeviceResult> {
  try {
    const device = await apiClient.post<Device | DeviceMergeResponse>('/devices', data);

    // Check if this is a merge response
    if ('added' in device && 'message' in device) {
      return { status: 'merged', result: device as DeviceMergeResponse };
    }

    return { status: 'created', device: device as Device };
  } catch (error: unknown) {
    // Check if this is a 409 conflict with comparison data
    // ApiError uses 'response' property, not 'data'
    if (
      error &&
      typeof error === 'object' &&
      'status' in error &&
      (error as { status: number }).status === 409
    ) {
      // Check both 'response' (ApiError) and 'data' (other error types) for compatibility
      const responseData = 'response' in error
        ? (error as { response: unknown }).response
        : 'data' in error
        ? (error as { data: unknown }).data
        : null;

      if (
        responseData &&
        typeof responseData === 'object' &&
        'existingDevice' in responseData &&
        'comparison' in responseData
      ) {
        return { status: 'conflict', conflict: responseData as DeviceConflictResponse };
      }
    }
    throw error;
  }
}

/**
 * Merge accounts into an existing device
 */
export async function mergeDeviceAccounts(
  data: CreateDeviceRequest
): Promise<DeviceMergeResponse> {
  return apiClient.post<DeviceMergeResponse>('/devices', { ...data, merge: true });
}

/**
 * Update a device
 */
export async function updateDevice(deviceId: string, data: UpdateDeviceRequest): Promise<Device> {
  return apiClient.patch<Device>(`/devices/${deviceId}`, data);
}

/**
 * Delete a device
 */
export async function deleteDevice(deviceId: string): Promise<void> {
  return apiClient.delete<void>(`/devices/${deviceId}`);
}

// ========================================
// HARDWARE DEVICE MODELS (Public endpoints)
// ========================================

export interface DeviceModelFilters {
  manufacturer?: string;
  airGapped?: boolean;
  connectivity?: string;
  showDiscontinued?: boolean;
}

/**
 * Get all available hardware device models
 */
export async function getDeviceModels(
  filters?: DeviceModelFilters,
  signal?: AbortSignal,
): Promise<HardwareDeviceModel[]> {
  if (!filters) {
    return apiClient.get<HardwareDeviceModel[]>('/devices/models', undefined, undefined, { signal });
  }

  return apiClient.get<HardwareDeviceModel[]>('/devices/models', {
    manufacturer: filters.manufacturer || undefined,
    airGapped: filters.airGapped,
    connectivity: filters.connectivity || undefined,
    showDiscontinued: filters.showDiscontinued ? true : undefined,
  }, undefined, { signal });
}

/**
 * Get a specific device model by slug
 */
export async function getDeviceModel(slug: string): Promise<HardwareDeviceModel> {
  return apiClient.get<HardwareDeviceModel>(`/devices/models/${slug}`);
}

/**
 * Get list of all manufacturers
 */
export async function getManufacturers(): Promise<string[]> {
  return apiClient.get<string[]>('/devices/manufacturers');
}

// ========================================
// DEVICE SHARING
// ========================================

export interface ShareDeviceWithUserRequest {
  targetUserId: string;
}

export interface ShareDeviceWithGroupRequest {
  groupId: string | null;
}

export interface ShareDeviceResponse {
  success: boolean;
  message: string;
  groupName?: string | null;
}

/**
 * Get sharing info for a device
 */
export async function getDeviceShareInfo(
  deviceId: string,
  signal?: AbortSignal,
): Promise<DeviceShareInfo> {
  return apiClient.get<DeviceShareInfo>(
    `/devices/${deviceId}/share`,
    undefined,
    undefined,
    { signal },
  );
}

/**
 * Share a device with a user
 */
export async function shareDeviceWithUser(
  deviceId: string,
  data: ShareDeviceWithUserRequest
): Promise<ShareDeviceResponse> {
  return apiClient.post<ShareDeviceResponse>(`/devices/${deviceId}/share/user`, data);
}

/**
 * Remove a user's access to a device
 */
export async function removeUserFromDevice(
  deviceId: string,
  targetUserId: string
): Promise<ShareDeviceResponse> {
  return apiClient.delete<ShareDeviceResponse>(`/devices/${deviceId}/share/user/${targetUserId}`);
}

/**
 * Share a device with a group or remove group access
 */
export async function shareDeviceWithGroup(
  deviceId: string,
  data: ShareDeviceWithGroupRequest
): Promise<ShareDeviceResponse> {
  return apiClient.post<ShareDeviceResponse>(`/devices/${deviceId}/share/group`, data);
}

// ========================================
// DEVICE ACCOUNTS
// ========================================

/**
 * Add a new account to an existing device
 * Used to add additional derivation paths (e.g., multisig to a single-sig device)
 */
export async function addDeviceAccount(
  deviceId: string,
  account: DeviceAccountInput
): Promise<DeviceAccountInput & { id: string }> {
  return apiClient.post<DeviceAccountInput & { id: string }>(`/devices/${deviceId}/accounts`, account);
}
