/**
 * Device Access Middleware
 *
 * Middleware to verify user has appropriate access level to a device.
 * Thin wrapper around the generic resource access middleware factory.
 *
 * Unlike walletAccess, `getUserDeviceRole` is not cached at the service
 * layer, so the "one role lookup per request" guarantee from the factory
 * is load-bearing here — it halves the DB query count on every
 * device-protected route compared to the previous check+getRole pattern.
 */

import { Request } from 'express';
import { getUserDeviceRole, DeviceRole } from '../services/deviceAccess';
import { createResourceAccessMiddleware } from './resourceAccess';

// Extend Express Request type to include device info
declare global {
  namespace Express {
    interface Request {
      deviceId?: string;
      deviceRole?: DeviceRole;
    }
  }
}

export type DeviceAccessLevel = 'view' | 'owner';

export const requireDeviceAccess = createResourceAccessMiddleware<DeviceAccessLevel, DeviceRole>({
  resourceName: 'Device',
  loggerName: 'MW:DEVICE_ACCESS',
  paramNames: ['deviceId', 'id'],
  getRole: getUserDeviceRole,
  predicates: {
    view: (role) => role !== null,
    owner: (role) => role === 'owner',
  },
  attachToRequest: (req: Request, id: string, role: DeviceRole) => {
    req.deviceId = id;
    req.deviceRole = role;
  },
});

/**
 * Helper to check access inline within a handler (for conditional logic)
 * Returns the user's role or null if no access
 */
export async function getDeviceAccessRole(
  deviceId: string,
  userId: string,
): Promise<DeviceRole> {
  return getUserDeviceRole(deviceId, userId);
}
