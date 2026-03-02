/**
 * Device Token Management
 *
 * Fetches and manages push notification device tokens via the backend API.
 */

import { config } from '../../config';
import { createLogger } from '../../utils/logger';
import { generateRequestSignature } from './auth';
import type { DeviceInfo } from './types';

const log = createLogger('BACKEND_EVENTS');

/**
 * Fetch devices for a user from the backend
 *
 * Calls the backend's internal endpoint to get all registered push devices
 * for a given user. This is used when we receive a transaction event and
 * need to determine which devices should receive push notifications.
 *
 * SEC-002: Uses HMAC signature instead of spoofable X-Gateway-Request header.
 */
export async function getDevicesForUser(userId: string): Promise<DeviceInfo[]> {
  try {
    const path = `/api/v1/push/by-user/${userId}`;
    const headers: Record<string, string> = {};

    // SEC-002: Add HMAC signature if gateway secret is configured
    if (config.gatewaySecret) {
      const { signature, timestamp } = generateRequestSignature('GET', path, null);
      headers['X-Gateway-Signature'] = signature;
      headers['X-Gateway-Timestamp'] = timestamp;
    } else {
      // Fallback to legacy header for backwards compatibility
      headers['X-Gateway-Request'] = 'true';
    }

    const response = await fetch(`${config.backendUrl}${path}`, { headers });

    if (!response.ok) {
      log.warn('Failed to fetch devices for user', { userId, status: response.status });
      return [];
    }

    return (await response.json()) as DeviceInfo[];
  } catch (err) {
    log.error('Error fetching devices', { error: (err as Error).message });
    return [];
  }
}

/**
 * Remove an invalid push token from the backend database
 *
 * Called when FCM/APNs reports that a device token is invalid (uninstalled app,
 * expired token, etc.). This cleans up the database to avoid repeatedly trying
 * to send to dead tokens.
 *
 * SEC-002: Uses HMAC signature for authentication.
 */
export async function removeInvalidDevice(deviceId: string, token: string): Promise<void> {
  try {
    const path = `/api/v1/push/device/${deviceId}`;
    const headers: Record<string, string> = {};

    // SEC-002: Add HMAC signature if gateway secret is configured
    if (config.gatewaySecret) {
      const { signature, timestamp } = generateRequestSignature('DELETE', path, null);
      headers['X-Gateway-Signature'] = signature;
      headers['X-Gateway-Timestamp'] = timestamp;
    } else {
      // Fallback to legacy header for backwards compatibility
      headers['X-Gateway-Request'] = 'true';
    }

    const response = await fetch(`${config.backendUrl}${path}`, {
      method: 'DELETE',
      headers,
    });

    if (response.ok) {
      log.info('Removed invalid push token', {
        deviceId,
        token: token.slice(0, 10) + '...',
      });
    } else {
      log.warn('Failed to remove invalid token', {
        deviceId,
        status: response.status,
      });
    }
  } catch (err) {
    log.error('Error removing invalid token', {
      deviceId,
      error: (err as Error).message,
    });
  }
}
