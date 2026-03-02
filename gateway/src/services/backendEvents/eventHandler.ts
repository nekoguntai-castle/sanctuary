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

/**
 * Handle incoming event from backend
 */
export async function handleEvent(event: BackendEvent): Promise<void> {
  log.debug('Received backend event', { type: event.type, walletId: event.walletId });

  // Only handle events that should trigger push notifications
  if (!PUSH_EVENT_TYPES.includes(event.type)) {
    return;
  }

  // Need userId to know which devices to notify
  if (!event.userId) {
    log.warn('Event missing userId, cannot send push notification');
    return;
  }

  const devices = await getDevicesForUser(event.userId);
  if (devices.length === 0) {
    log.debug('No devices registered for user', { userId: event.userId });
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
    userId: event.userId,
    eventType: event.type,
    success: result.success,
    failed: result.failed,
  });

  // Remove invalid tokens from database
  if (result.invalidTokens.length > 0) {
    log.warn('Invalid push tokens found', { count: result.invalidTokens.length });

    // Remove each invalid token from the backend database
    for (const invalidToken of result.invalidTokens) {
      await removeInvalidDevice(invalidToken.id, invalidToken.token);
    }
  }
}
