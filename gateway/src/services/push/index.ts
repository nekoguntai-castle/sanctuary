/**
 * Push Notification Service
 *
 * Unified interface for sending push notifications to both iOS and Android.
 * This module abstracts away the differences between FCM and APNs.
 *
 * ## Architecture
 *
 * ```
 * [Gateway] --> [Push Service] --> [FCM] --> [Android Device]
 *                    |
 *                    +-----------> [APNs] --> [iOS Device]
 * ```
 *
 * ## Initialization
 *
 * Call `initializePushServices()` at startup to initialize FCM/APNs.
 * Services will only be enabled if proper credentials are configured.
 *
 * ## Sending Notifications
 *
 * Use `sendToDevices()` for batch sending to multiple devices.
 * The function automatically routes to the correct service based on platform.
 *
 * ## Invalid Tokens
 *
 * Both FCM and APNs report invalid tokens (uninstalled apps, etc.).
 * The return value includes these so they can be removed from the database.
 *
 * ## Notification Format
 *
 * Use `formatTransactionNotification()` to create consistent notifications
 * for transaction events. This ensures Android/iOS show the same message.
 */

import * as fcm from './fcm';
import * as apns from './apns';
import { createLogger } from '../../utils/logger';

const log = createLogger('PUSH');

export interface PushNotification {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface Device {
  id: string;
  platform: 'ios' | 'android';
  pushToken: string;
}

/**
 * Initialize all push notification services
 */
export function initializePushServices(): void {
  fcm.initializeFCM();
  apns.initializeAPNs();

  const available: string[] = [];
  if (fcm.isFCMAvailable()) available.push('FCM (Android)');
  if (apns.isAPNsAvailable()) available.push('APNs (iOS)');

  if (available.length > 0) {
    log.info(`Push notifications enabled: ${available.join(', ')}`);
  } else {
    log.warn('No push notification services configured');
  }
}

/**
 * Shutdown push services (call on process exit)
 */
export function shutdownPushServices(): void {
  apns.shutdownAPNs();
  log.info('Push services shutdown');
}

/**
 * Send push notification to a single device
 */
export async function sendToDevice(
  device: Device,
  notification: PushNotification
): Promise<{ success: boolean; error?: string; invalidToken?: boolean }> {
  if (device.platform === 'android') {
    if (!fcm.isFCMAvailable()) {
      return { success: false, error: 'FCM not configured' };
    }
    const result = await fcm.sendToDevice(device.pushToken, notification);
    return {
      success: result.success,
      error: result.error,
      invalidToken: result.error === 'invalid_token',
    };
  } else if (device.platform === 'ios') {
    if (!apns.isAPNsAvailable()) {
      return { success: false, error: 'APNs not configured' };
    }
    const result = await apns.sendToDevice(device.pushToken, notification);
    return {
      success: result.success,
      error: result.error,
      invalidToken: result.error === 'invalid_token',
    };
  }

  return { success: false, error: 'Unknown platform' };
}

/**
 * Send push notification to multiple devices
 */
export async function sendToDevices(
  devices: Device[],
  notification: PushNotification
): Promise<{
  success: number;
  failed: number;
  invalidTokens: Array<{ id: string; token: string }>;
}> {
  const androidDevices = devices.filter((d) => d.platform === 'android');
  const iosDevices = devices.filter((d) => d.platform === 'ios');

  let totalSuccess = 0;
  let totalFailed = 0;
  const invalidTokens: Array<{ id: string; token: string }> = [];

  // Send to Android devices
  if (androidDevices.length > 0 && fcm.isFCMAvailable()) {
    const tokens = androidDevices.map((d) => d.pushToken);
    const devicesByToken = new Map(androidDevices.map((device) => [device.pushToken, device]));
    const result = await fcm.sendToDevices(tokens, notification);
    totalSuccess += result.success;
    totalFailed += result.failed;

    // Map invalid tokens back to device IDs
    result.invalidTokens.forEach((token) => {
      const device = devicesByToken.get(token);
      if (device) {
        invalidTokens.push({ id: device.id, token });
      }
    });
  } else if (androidDevices.length > 0) {
    totalFailed += androidDevices.length;
  }

  // Send to iOS devices
  if (iosDevices.length > 0 && apns.isAPNsAvailable()) {
    const tokens = iosDevices.map((d) => d.pushToken);
    const devicesByToken = new Map(iosDevices.map((device) => [device.pushToken, device]));
    const result = await apns.sendToDevices(tokens, notification);
    totalSuccess += result.success;
    totalFailed += result.failed;

    // Map invalid tokens back to device IDs
    result.invalidTokens.forEach((token) => {
      const device = devicesByToken.get(token);
      if (device) {
        invalidTokens.push({ id: device.id, token });
      }
    });
  } else if (iosDevices.length > 0) {
    totalFailed += iosDevices.length;
  }

  return { success: totalSuccess, failed: totalFailed, invalidTokens };
}

/**
 * Format satoshis to BTC string
 */
function formatSats(sats: number): string {
  return `${(sats / 100_000_000).toFixed(8)} BTC`;
}

/**
 * Format a transaction notification
 */
export function formatTransactionNotification(
  type: 'received' | 'sent' | 'confirmed',
  walletName: string,
  amount: number,
  txid: string
): PushNotification {
  // Producers send signed wallet deltas; the message template owns the sign.
  const amountBtc = formatSats(Math.abs(amount));

  switch (type) {
    case 'received':
      return {
        title: `Bitcoin Received`,
        body: `${walletName}: +${amountBtc}`,
        data: { type: 'transaction', txid, walletName },
      };
    case 'sent':
      return {
        title: `Bitcoin Sent`,
        body: `${walletName}: -${amountBtc}`,
        data: { type: 'transaction', txid, walletName },
      };
    case 'confirmed':
      return {
        title: `Transaction Confirmed`,
        body: `${walletName}: ${amountBtc} confirmed`,
        data: { type: 'confirmation', txid, walletName },
      };
    default:
      return {
        title: 'Sanctuary',
        body: 'New wallet activity',
        data: { type: 'unknown' },
      };
  }
}

/**
 * Format a broadcast notification
 */
export function formatBroadcastNotification(
  success: boolean,
  walletName: string,
  txid: string,
  error?: string
): PushNotification {
  if (success) {
    return {
      title: 'Transaction Broadcast',
      body: `Transaction sent from ${walletName}`,
      data: { type: 'broadcast_success', txid, walletName },
    };
  } else {
    return {
      title: 'Broadcast Failed',
      body: error
        ? `Failed to broadcast from ${walletName}: ${error}`
        : `Failed to broadcast from ${walletName}`,
      data: { type: 'broadcast_failed', txid, walletName, error: error || '' },
    };
  }
}

/**
 * Format a PSBT signing required notification
 */
export function formatPsbtSigningNotification(
  walletName: string,
  draftId: string,
  creatorName: string,
  amount: number,
  requiredSignatures: number,
  currentSignatures: number
): PushNotification {
  const amountBtc = formatSats(amount);
  const remaining = requiredSignatures - currentSignatures;

  return {
    title: 'Signature Required',
    body: `${creatorName} needs your signature on ${walletName} (${amountBtc})`,
    data: {
      type: 'psbt_signing_required',
      draftId,
      walletName,
      amount: amount.toString(),
      requiredSignatures: requiredSignatures.toString(),
      currentSignatures: currentSignatures.toString(),
      remaining: remaining.toString(),
    },
  };
}

/**
 * Format a draft created notification
 */
export function formatDraftCreatedNotification(
  walletName: string,
  draftId: string,
  creatorName: string,
  amount: number
): PushNotification {
  const amountBtc = formatSats(amount);

  return {
    title: 'New Draft Transaction',
    body: `${creatorName} created a draft on ${walletName} for ${amountBtc}`,
    data: {
      type: 'draft_created',
      draftId,
      walletName,
      creatorName,
      amount: amount.toString(),
    },
  };
}

/**
 * Format a draft approved notification
 */
export function formatDraftApprovedNotification(
  walletName: string,
  draftId: string,
  signerName: string,
  currentSignatures: number,
  requiredSignatures: number
): PushNotification {
  const isComplete = currentSignatures >= requiredSignatures;

  if (isComplete) {
    return {
      title: 'Transaction Ready',
      body: `${signerName} signed the draft on ${walletName}. Ready to broadcast!`,
      data: {
        type: 'draft_approved',
        draftId,
        walletName,
        signerName,
        ready: 'true',
      },
    };
  } else {
    const remaining = requiredSignatures - currentSignatures;
    return {
      title: 'Draft Signed',
      body: `${signerName} signed the draft on ${walletName}. ${remaining} more signature${remaining > 1 ? 's' : ''} needed.`,
      data: {
        type: 'draft_approved',
        draftId,
        walletName,
        signerName,
        ready: 'false',
        remaining: remaining.toString(),
      },
    };
  }
}
