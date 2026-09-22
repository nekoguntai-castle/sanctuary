/**
 * Event Handler
 *
 * Routes backend events to push notifications.
 */

import { createLogger } from '../../utils/logger';
import * as push from '../push';
import { getDevicesForUser, removeInvalidDevice } from './deviceTokens';
import { PUSH_EVENT_TYPES, formatNotificationForEvent } from './notifications';
import type { BackendEvent } from './types';

const log = createLogger('BACKEND_EVENTS');
// Bound concurrent backend requests for wallets with large shared audiences.
const DEVICE_LOOKUP_CONCURRENCY = 5;

function getAudienceIds(event: BackendEvent): string[] {
  return [...new Set([
    ...(event.userIds ?? []),
    ...(event.userId ? [event.userId] : []),
  ].filter((userId) => userId.length > 0))];
}

async function getDistinctAudienceDevices(userIds: string[]) {
  const devicesById = new Map<string, Awaited<ReturnType<typeof getDevicesForUser>>[number]>();
  for (let offset = 0; offset < userIds.length; offset += DEVICE_LOOKUP_CONCURRENCY) {
    const batch = userIds.slice(offset, offset + DEVICE_LOOKUP_CONCURRENCY);
    const deviceLists = await Promise.all(batch.map((userId) => getDevicesForUser(userId)));
    for (const device of deviceLists.flat()) {
      devicesById.set(device.id, device);
    }
  }
  return [...devicesById.values()];
}

/**
 * Handle incoming event from backend
 */
export async function handleEvent(event: BackendEvent): Promise<void> {
  log.debug('Received backend event', { type: event.type, walletId: event.walletId });

  // Only handle events that should trigger push notifications
  if (!PUSH_EVENT_TYPES.includes(event.type)) {
    return;
  }

  const userIds = getAudienceIds(event);
  if (userIds.length === 0) {
    log.warn('Event missing recipients, cannot send push notification');
    return;
  }

  const devices = await getDistinctAudienceDevices(userIds);
  if (devices.length === 0) {
    log.debug('No devices registered for audience', { userIds });
    return;
  }

  // Format notification based on event type
  const notification = formatNotificationForEvent(event);
  if (!notification) {
    log.debug('Event does not require push notification', { event });
    return;
  }

  // Send push notifications
  const pushDevices = devices.map((d) => ({
    id: d.id,
    platform: d.platform,
    pushToken: d.pushToken,
  }));

  const result = await push.sendToDevices(pushDevices, notification);
  log.info('Push notifications sent', {
    userIds,
    eventType: event.type,
    success: result.success,
    failed: result.failed,
  });

  // Remove invalid tokens from database
  if (result.invalidTokens.length > 0) {
    log.warn('Invalid push tokens found', { count: result.invalidTokens.length });

    // Remove each invalid token from the backend database
    const distinctInvalidTokens = new Map(
      result.invalidTokens.map((invalidToken) => [invalidToken.id, invalidToken]),
    );
    for (const invalidToken of distinctInvalidTokens.values()) {
      await removeInvalidDevice(invalidToken.id, invalidToken.token);
    }
  }
}
