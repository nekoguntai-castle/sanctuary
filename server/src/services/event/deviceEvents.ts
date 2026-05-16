/**
 * Device Event Emitters
 *
 * Handles emission of device-related events to the event bus.
 */

import { eventBus } from '../../events/eventBus';
import { createLogger } from '../../utils/logger';
import type { DeviceRoleValue } from '@sanctuary/shared/constants/deviceRoles';
import type { DeviceRegisteredData } from './types';

const log = createLogger('EVENT:SVC_DEVICE');

/**
 * Emit device registered event
 */
export function emitDeviceRegistered(data: DeviceRegisteredData): void {
  eventBus.emit('device:registered', data);
  log.info('Emitted device:registered', { deviceId: data.deviceId, type: data.type });
}

/**
 * Emit device deleted event
 */
export function emitDeviceDeleted(deviceId: string, userId: string): void {
  eventBus.emit('device:deleted', { deviceId, userId });
  log.info('Emitted device:deleted', { deviceId, userId });
}

/**
 * Emit device shared event
 */
export function emitDeviceShared(deviceId: string, ownerId: string, sharedWithUserId: string, role: DeviceRoleValue): void {
  eventBus.emit('device:shared', { deviceId, ownerId, sharedWithUserId, role });
  log.info('Emitted device:shared', { deviceId, sharedWithUserId, role });
}
