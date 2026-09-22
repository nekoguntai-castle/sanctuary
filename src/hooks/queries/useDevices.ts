import * as devicesApi from '../../api/devices';
import {
  createListQuery,
  createDetailQuery,
  createMutation,
  createInvalidateAll,
} from './factory';
import { deviceKeys } from './deviceKeys';

export { deviceKeys } from './deviceKeys';

/**
 * Hook to fetch all devices for the current user
 */
export const useDevices = createListQuery(deviceKeys, devicesApi.getDevices);

/**
 * Hook to fetch a single device by ID
 */
export const useDevice = createDetailQuery(deviceKeys, devicesApi.getDevice);

/**
 * Hook to create a new device
 */
export const useCreateDevice = createMutation(devicesApi.createDevice, {
  invalidateKeys: [deviceKeys.lists()],
});

/**
 * Hook to delete a device
 */
export const useDeleteDevice = createMutation(
  (deviceId: string) => devicesApi.deleteDevice(deviceId),
  {
    invalidateKeys: [deviceKeys.lists()],
    removeKeys: (deviceId) => [deviceKeys.detail(deviceId)],
  }
);

/**
 * Helper to invalidate all device data
 */
export const useInvalidateDevices = createInvalidateAll(deviceKeys);
