import type { DeviceShareInfo } from '../../../types';

export type DeviceShareUser = DeviceShareInfo['users'][number];
export type DeviceShareGroup = NonNullable<DeviceShareInfo['group']>;

export interface OwnerDisplay {
  username: string;
  initial: string;
}

export function getDeviceOwnerDisplay(
  deviceShareInfo: DeviceShareInfo | null,
  username: string | undefined,
): OwnerDisplay {
  const ownerUsername = deviceShareInfo?.users.find((shareUser) => shareUser.role === 'owner')?.username;
  const displayUsername = ownerUsername || username || 'You';
  const initial = ownerUsername?.charAt(0).toUpperCase() || username?.charAt(0).toUpperCase() || 'U';

  return {
    username: displayUsername,
    initial,
  };
}

export function getSharedDeviceUsers(deviceShareInfo: DeviceShareInfo | null): DeviceShareUser[] {
  return deviceShareInfo?.users.filter((shareUser) => shareUser.role !== 'owner') ?? [];
}

export function hasDeviceSharedAccess(
  deviceShareInfo: DeviceShareInfo | null,
  sharedUsers: DeviceShareUser[],
): boolean {
  return Boolean(deviceShareInfo?.group) || sharedUsers.length > 0;
}
