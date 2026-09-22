/**
 * Firebase Cloud Messaging (FCM) Service
 *
 * Sends push notifications to Android devices.
 */

import { cert, initializeApp, type FirebaseError } from 'firebase-admin/app';
import {
  getMessaging,
  type Message,
  type Messaging,
  type MulticastMessage,
} from 'firebase-admin/messaging';
import { config } from '../../config';
import { createLogger } from '../../utils/logger';

const log = createLogger('FCM');
const FCM_MULTICAST_LIMIT = 500;

let messaging: Messaging | undefined;

/**
 * Initialize Firebase Admin SDK
 */
export function initializeFCM(): boolean {
  if (messaging) return true;

  if (!config.fcm.projectId || !config.fcm.privateKey || !config.fcm.clientEmail) {
    log.warn('FCM not configured - Android push notifications disabled');
    return false;
  }

  try {
    const app = initializeApp({
      credential: cert({
        projectId: config.fcm.projectId,
        privateKey: config.fcm.privateKey,
        clientEmail: config.fcm.clientEmail,
      }),
    });
    messaging = getMessaging(app);
    log.info('FCM initialized successfully');
    return true;
  } catch (err) {
    log.error('Failed to initialize FCM', { error: (err as Error).message });
    return false;
  }
}

/**
 * Check if FCM is available
 */
export function isFCMAvailable(): boolean {
  return messaging !== undefined;
}

export interface FCMNotification {
  title: string;
  body: string;
  data?: Record<string, string>;
}

interface MulticastResult {
  success: number;
  failed: number;
  invalidTokens: string[];
}

function buildMulticastMessage(
  tokens: string[],
  notification: FCMNotification,
): MulticastMessage {
  return {
    tokens,
    notification: {
      title: notification.title,
      body: notification.body,
    },
    data: notification.data,
    android: {
      priority: 'high',
      notification: {
        channelId: 'sanctuary_transactions',
        priority: 'high',
        defaultSound: true,
        defaultVibrateTimings: true,
      },
    },
  };
}

async function sendMulticastBatch(
  client: Messaging,
  tokens: string[],
  notification: FCMNotification,
): Promise<MulticastResult> {
  try {
    const response = await client.sendEachForMulticast(buildMulticastMessage(tokens, notification));
    const invalidTokens = response.responses.flatMap((result, index) => {
      const code = result.error?.code;
      return !result.success && (
        code === 'messaging/invalid-registration-token'
        || code === 'messaging/registration-token-not-registered'
      ) ? [tokens[index]] : [];
    });
    return {
      success: response.successCount,
      failed: response.failureCount,
      invalidTokens,
    };
  } catch (err) {
    log.error('FCM multicast error', { error: (err as Error).message });
    return { success: 0, failed: tokens.length, invalidTokens: [] };
  }
}

/**
 * Send push notification to a single Android device
 */
export async function sendToDevice(
  pushToken: string,
  notification: FCMNotification
): Promise<{ success: boolean; error?: string }> {
  const client = messaging;
  if (!client) {
    return { success: false, error: 'FCM not initialized' };
  }

  try {
    const message: Message = {
      token: pushToken,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: notification.data,
      android: {
        priority: 'high',
        notification: {
          channelId: 'sanctuary_transactions',
          priority: 'high',
          defaultSound: true,
          defaultVibrateTimings: true,
        },
      },
    };

    const response = await client.send(message);
    log.debug('FCM notification sent', { messageId: response });
    return { success: true };
  } catch (err) {
    const error = err as FirebaseError;
    log.error('FCM send error', { error: error.message, code: error.code });

    // Handle invalid/expired tokens
    if (
      error.code === 'messaging/invalid-registration-token' ||
      error.code === 'messaging/registration-token-not-registered'
    ) {
      return { success: false, error: 'invalid_token' };
    }

    return { success: false, error: error.message };
  }
}

/**
 * Send push notification to multiple Android devices
 */
export async function sendToDevices(
  pushTokens: string[],
  notification: FCMNotification
): Promise<{ success: number; failed: number; invalidTokens: string[] }> {
  const client = messaging;
  if (!client) {
    return { success: 0, failed: pushTokens.length, invalidTokens: [] };
  }

  if (pushTokens.length === 0) {
    return { success: 0, failed: 0, invalidTokens: [] };
  }

  const result: MulticastResult = { success: 0, failed: 0, invalidTokens: [] };
  for (let offset = 0; offset < pushTokens.length; offset += FCM_MULTICAST_LIMIT) {
    const batch = pushTokens.slice(offset, offset + FCM_MULTICAST_LIMIT);
    const batchResult = await sendMulticastBatch(client, batch, notification);
    result.success += batchResult.success;
    result.failed += batchResult.failed;
    result.invalidTokens.push(...batchResult.invalidTokens);
  }

  log.debug('FCM multicast sent', { success: result.success, failed: result.failed });
  return result;
}
