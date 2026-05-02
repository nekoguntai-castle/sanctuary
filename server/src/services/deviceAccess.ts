/**
 * Device Access Service
 *
 * Business logic for device access control and sharing
 */

import { deviceRepository, userRepository } from '../repositories';
import { createLogger } from '../utils/logger';

const log = createLogger('DEVICE_ACCESS:SVC');

// ========================================
// TYPES
// ========================================

export type DeviceRole = 'owner' | 'viewer' | null;

export interface DeviceAccessCheckResult {
  hasAccess: boolean;
  isOwner: boolean;
  role: DeviceRole;
}

export interface DeviceWalletInfo {
  wallet: {
    id: string;
    name: string;
    type: string;
    scriptType: string | null;
    network: string;
  };
}

export interface DeviceAccountInfo {
  id: string;
  purpose: string;
  scriptType: string;
  derivationPath: string;
  xpub: string;
}

export interface DeviceWithAccess {
  id: string;
  userId: string;
  modelId: string | null;
  type: string;
  label: string;
  fingerprint: string;
  derivationPath: string | null;
  xpub: string;
  groupId: string | null;
  groupRole: string;
  createdAt: Date;
  updatedAt: Date;
  // Access info
  isOwner: boolean;
  userRole: DeviceRole;
  sharedBy?: string; // Username of owner if shared
  model?: { id: string; slug: string; name: string } | null;
  walletCount: number;
  wallets: DeviceWalletInfo[];
  accounts: DeviceAccountInfo[];
}

// ========================================
// DEVICE ACCESS HELPERS
// ========================================

/**
 * Get user's role for a specific device
 * Returns the highest privilege role if user has multiple access paths
 */
export async function getUserDeviceRole(deviceId: string, userId: string): Promise<DeviceRole> {
  // Check direct user access first (via DeviceUser table)
  const deviceUser = await deviceRepository.findDeviceUser(deviceId, userId);

  if (deviceUser) {
    return deviceUser.role as DeviceRole;
  }

  // Check group access
  const groupRole = await deviceRepository.findGroupRoleByMembership(deviceId, userId);

  if (groupRole) {
    return groupRole as DeviceRole;
  }

  return null;
}

/**
 * Check if user has any access to device (for read operations)
 */
export async function checkDeviceAccess(deviceId: string, userId: string): Promise<boolean> {
  const role = await getUserDeviceRole(deviceId, userId);
  return role !== null;
}

/**
 * Check if user is device owner
 * Use this for operations like sharing, editing, deleting device
 */
export async function checkDeviceOwnerAccess(deviceId: string, userId: string): Promise<boolean> {
  const role = await getUserDeviceRole(deviceId, userId);
  return role === 'owner';
}

/**
 * Check device access and owner permission in a single query
 */
export async function checkDeviceAccessWithRole(
  deviceId: string,
  userId: string
): Promise<DeviceAccessCheckResult> {
  const role = await getUserDeviceRole(deviceId, userId);
  return {
    hasAccess: role !== null,
    isOwner: role === 'owner',
    role,
  };
}

/**
 * Get all devices accessible by user (owned + shared via user + shared via group)
 * Optimized: single query with OR logic, only loads needed fields
 */
export async function getUserAccessibleDevices(userId: string): Promise<DeviceWithAccess[]> {
  // Single query combining direct access and group access
  const devices = await deviceRepository.findAccessibleByUser(userId);

  // Format devices with access info
  return devices.map((device) => {
    const userAccess = device.users[0];
    // If user has direct access, use that role; otherwise it's group access
    const hasDirectAccess = userAccess !== undefined;
    const userRole = hasDirectAccess
      ? (userAccess.role as DeviceRole)
      : (device.groupRole as DeviceRole);
    const isOwner = userRole === 'owner';

    return {
      id: device.id,
      userId: device.userId,
      modelId: device.modelId,
      type: device.type,
      label: device.label,
      fingerprint: device.fingerprint,
      derivationPath: device.derivationPath,
      xpub: device.xpub,
      groupId: device.groupId,
      groupRole: device.groupRole,
      createdAt: device.createdAt,
      updatedAt: device.updatedAt,
      isOwner,
      userRole,
      sharedBy: isOwner ? undefined : device.user.username,
      model: device.model,
      walletCount: device.wallets.length,
      wallets: device.wallets,
      accounts: device.accounts,
    };
  });
}

/**
 * Get sharing info for a device
 */
export async function getDeviceShareInfo(deviceId: string): Promise<{
  group: { id: string; name: string } | null;
  users: Array<{ id: string; username: string; role: string }>;
}> {
  const device = await deviceRepository.findShareInfo(deviceId);

  if (!device) {
    return { group: null, users: [] };
  }

  return {
    group: device.group,
    users: device.users.map((du) => ({
      id: du.user.id,
      username: du.user.username,
      role: du.role,
    })),
  };
}

/**
 * Share device with a user
 */
export async function shareDeviceWithUser(
  deviceId: string,
  targetUserId: string,
  ownerId: string
): Promise<{ success: boolean; message: string }> {
  // Verify the requester is owner
  const isOwner = await checkDeviceOwnerAccess(deviceId, ownerId);
  if (!isOwner) {
    return { success: false, message: 'Only device owner can share' };
  }

  // Check if target user exists
  const targetUser = await userRepository.findById(targetUserId);
  if (!targetUser) {
    return { success: false, message: 'User not found' };
  }

  // Check if already shared
  const existing = await deviceRepository.findDeviceUser(deviceId, targetUserId);

  if (existing) {
    return { success: true, message: 'Device already shared with this user' };
  }

  // Create share record
  await deviceRepository.createDeviceUser(deviceId, targetUserId, 'viewer');

  log.info('Device shared with user', { deviceId, targetUserId, sharedBy: ownerId });

  return { success: true, message: 'Device shared successfully' };
}

/**
 * Remove user's access to device
 */
export async function removeUserFromDevice(
  deviceId: string,
  targetUserId: string,
  ownerId: string
): Promise<{ success: boolean; message: string }> {
  // Verify the requester is owner
  const isOwner = await checkDeviceOwnerAccess(deviceId, ownerId);
  if (!isOwner) {
    return { success: false, message: 'Only device owner can remove access' };
  }

  // Find the access record
  const deviceUser = await deviceRepository.findDeviceUser(deviceId, targetUserId);

  if (!deviceUser) {
    return { success: false, message: 'User does not have access to this device' };
  }

  // Can't remove owner
  if (deviceUser.role === 'owner') {
    return { success: false, message: 'Cannot remove device owner' };
  }

  // Delete access record
  await deviceRepository.deleteDeviceUser(deviceUser.id);

  log.info('User removed from device', { deviceId, targetUserId, removedBy: ownerId });

  return { success: true, message: 'User access removed' };
}

/**
 * Share device with a group
 */
export async function shareDeviceWithGroup(
  deviceId: string,
  groupId: string | null,
  ownerId: string
): Promise<{ success: boolean; message: string; groupName: string | null }> {
  // Verify the requester is owner
  const isOwner = await checkDeviceOwnerAccess(deviceId, ownerId);
  if (!isOwner) {
    return { success: false, message: 'Only device owner can share', groupName: null };
  }

  // If groupId provided, verify group exists
  let groupName: string | null = null;
  if (groupId) {
    groupName = await deviceRepository.findGroupName(groupId);
    if (!groupName) {
      return { success: false, message: 'Group not found', groupName: null };
    }
  }

  // Update device's group
  await deviceRepository.update(deviceId, {
    groupId: groupId,
    groupRole: 'viewer',
  });

  log.info('Device group sharing updated', { deviceId, groupId, updatedBy: ownerId });

  return {
    success: true,
    message: groupId ? 'Device shared with group' : 'Group access removed',
    groupName,
  };
}

/**
 * Get devices that would need to be shared when sharing a wallet
 * Returns devices associated with the wallet that the target user doesn't have access to
 */
export async function getDevicesToShareForWallet(
  walletId: string,
  targetUserId: string
): Promise<Array<{ id: string; label: string; fingerprint: string }>> {
  // Batch fetch: get all groups the target user is a member of (avoids N+1 queries)
  const userGroupIdsList = await deviceRepository.findUserGroupIds(targetUserId);
  const userGroupIds = new Set(userGroupIdsList);

  // Get all devices associated with the wallet
  const walletDevices = await deviceRepository.findWalletDevicesWithUserAccess(walletId, targetUserId);

  // Filter to devices the target user doesn't have access to
  const devicesToShare: Array<{ id: string; label: string; fingerprint: string }> = [];

  for (const wd of walletDevices) {
    const device = wd.device;
    const hasDirectAccess = device.users.length > 0;

    // Check group access using pre-fetched group memberships (no additional queries)
    const hasGroupAccess = device.groupId ? userGroupIds.has(device.groupId) : false;

    if (!hasDirectAccess && !hasGroupAccess) {
      devicesToShare.push({
        id: device.id,
        label: device.label,
        fingerprint: device.fingerprint,
      });
    }
  }

  return devicesToShare;
}
