/**
 * Push Notification Service
 *
 * Sends transaction notifications to users via their registered mobile devices.
 * Supports both iOS (APNs) and Android (FCM) platforms using the ProviderRegistry pattern.
 * Uses the same per-wallet notification settings as Telegram.
 */

import {
  pushDeviceRepository,
  walletRepository,
  userRepository,
} from '../../repositories';
import { ProviderRegistry } from '../../providers';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { type WalletTelegramSettings } from '../telegram/telegramService';
import {
  createPushProviderRegistry,
  initializePushProviders,
  getProviderForPlatform,
  hasConfiguredProviders,
} from './providers';
import type { IPushProvider, PushMessage, PushPlatform } from './types';
import { isInvalidTokenError } from './types';
import { recordPushFailure } from '../deadLetterQueue';

const log = createLogger('PUSH:SVC');

export interface TransactionData {
  txid: string;
  type: string;
  amount: bigint;
}

type WalletNotificationUser = Awaited<
  ReturnType<typeof userRepository.findByWalletAccess>
>[number];
type NotificationWallet = NonNullable<
  Awaited<ReturnType<typeof walletRepository.findNameById>>
>;

/**
 * Result of a `notifyNewTransactions` call. A wallet/user lookup failure is
 * reported as `success: false` (with the error message) instead of being
 * logged and swallowed, so callers can distinguish "nothing to notify" from
 * "notification delivery was not attempted." `recorded` tells a caller
 * whether the failure was already persisted via `recordPushFailure` (per-
 * device send failures are); a lookup failure has not been recorded anywhere
 * yet, so `recorded` is `false`.
 */
export interface NotifyTransactionsResult {
  success: boolean;
  usersNotified: number;
  error?: string;
  recorded?: boolean;
}

function getWalletPushSettings(
  preferences: unknown,
  walletId: string,
): WalletTelegramSettings | undefined {
  const prefs = preferences as Record<string, unknown> | null;
  const telegram = prefs?.telegram as
    | {
        wallets?: Record<string, WalletTelegramSettings>;
      }
    | undefined;

  return telegram?.wallets?.[walletId];
}

function shouldSendTransactionNotification(
  tx: TransactionData,
  walletSettings: WalletTelegramSettings,
): boolean {
  /* v8 ignore start -- transaction type union is constrained by callers */
  switch (tx.type) {
    case 'received':
      return walletSettings.notifyReceived;
    case 'sent':
      return walletSettings.notifySent;
    case 'consolidation':
      return walletSettings.notifyConsolidation;
    default:
      /* v8 ignore next -- transaction type union is constrained by callers */
      return false;
  }
  /* v8 ignore stop */
}

function buildTransactionPushMessage(
  wallet: NotificationWallet,
  tx: TransactionData,
): PushMessage {
  const amountBtc = (Number(tx.amount) / 100_000_000).toFixed(8);
  const emoji =
    tx.type === 'received' ? '📥' : tx.type === 'sent' ? '📤' : '🔄';
  const typeLabel = tx.type.charAt(0).toUpperCase() + tx.type.slice(1);

  return {
    title: `${emoji} ${typeLabel}`,
    body: `${wallet.name}: ${amountBtc} BTC`,
    data: {
      walletId: wallet.id,
      txid: tx.txid,
      type: tx.type,
    },
  };
}

class PushService {
  private registry: ProviderRegistry<IPushProvider>;
  private initialized = false;

  constructor() {
    this.registry = createPushProviderRegistry();
  }

  /**
   * Initialize the push service and register all providers
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await initializePushProviders(this.registry);
    this.initialized = true;
    log.info('Push service initialized with provider registry');
  }

  /**
   * Ensure service is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Check if any push provider is configured
   */
  async isConfigured(): Promise<boolean> {
    await this.ensureInitialized();
    return hasConfiguredProviders(this.registry);
  }

  /**
   * Send a push notification to all devices registered to a user
   *
   * @param userId - The user ID to send notifications to
   * @param message - The notification content
   */
  async sendToUser(userId: string, message: PushMessage): Promise<void> {
    await this.ensureInitialized();

    const devices = await pushDeviceRepository.findByUserId(userId);

    if (devices.length === 0) {
      return;
    }

    for (const device of devices) {
      try {
        const provider = getProviderForPlatform(
          this.registry,
          device.platform as PushPlatform,
        );

        if (!provider) {
          log.debug(`No provider configured for platform "${device.platform}"`);
          continue;
        }

        const result = await provider.send(device.token, message);

        if (result.success) {
          // Update last used timestamp
          await pushDeviceRepository.updateLastUsed(device.id);
        } else if (
          isInvalidTokenError(result) ||
          (result.error && isInvalidTokenError(new Error(result.error)))
        ) {
          // Remove invalid tokens
          await pushDeviceRepository.deleteById(device.id);
          log.info(
            `Removed invalid ${device.platform} token for user ${userId}`,
          );
        } else {
          // Provider resolved without throwing but did not succeed, and it
          // is not an invalid-token result: record it the same way a thrown
          // failure is recorded so it isn't silently dropped.
          const errorMsg = result.error ?? 'Unknown push provider failure';
          log.error(
            `Push to ${device.platform} device failed: ${errorMsg}`,
            { platform: device.platform, errorCode: result.errorCode, error: errorMsg },
          );
          await recordPushFailure(userId, device.token, errorMsg, 1, {
            platform: device.platform,
            messageTitle: message.title,
            errorCode: result.errorCode,
          });
        }
      } catch (err) {
        const errorMsg = getErrorMessage(err);
        log.error(`Push to ${device.platform} device failed: ${errorMsg}`);

        // Remove invalid tokens
        if (isInvalidTokenError(err)) {
          await pushDeviceRepository.deleteById(device.id);
          log.info(
            `Removed invalid ${device.platform} token for user ${userId}`,
          );
        } else {
          // Record non-token-related failures in dead letter queue
          await recordPushFailure(userId, device.token, errorMsg, 1, {
            platform: device.platform,
            messageTitle: message.title,
          });
        }
      }
    }
  }

  /**
   * Notify all eligible users about new transactions via push notifications
   *
   * Uses the same wallet notification settings as Telegram:
   * - user.preferences.telegram.wallets[walletId].enabled
   * - user.preferences.telegram.wallets[walletId].notifyReceived
   * - user.preferences.telegram.wallets[walletId].notifySent
   * - user.preferences.telegram.wallets[walletId].notifyConsolidation
   *
   * @param walletId - The wallet that received/sent transactions
   * @param transactions - Array of new transactions to notify about
   */
  async notifyNewTransactions(
    walletId: string,
    transactions: TransactionData[],
  ): Promise<NotifyTransactionsResult> {
    if (transactions.length === 0) return { success: true, usersNotified: 0 };

    // Skip if no push providers are configured
    if (!(await this.isConfigured())) {
      return { success: true, usersNotified: 0 };
    }

    let wallet: NotificationWallet | null;
    let users: WalletNotificationUser[];
    try {
      // Get wallet info
      wallet = await walletRepository.findNameById(walletId);
      if (!wallet) return { success: true, usersNotified: 0 };

      // Get all users with access to this wallet, including push device counts
      // This avoids N+1 queries by fetching device counts in a single query
      users = await userRepository.findByWalletAccess(walletId, {
        includePushDeviceCount: true,
      });
    } catch (err) {
      const errorMsg = getErrorMessage(err);
      log.error(`Error sending push notifications: ${errorMsg}`);
      // The lookup never reached per-device sends, so nothing was recorded
      // via recordPushFailure yet -- the caller must not swallow this.
      return { success: false, usersNotified: 0, error: errorMsg, recorded: false };
    }

    let usersNotified = 0;
    try {
      for (const user of users) {
        await this.notifyUserNewTransactions(
          user,
          wallet,
          walletId,
          transactions,
        );
        usersNotified++;
      }
    } catch (err) {
      // Per-device send failures are already recorded individually inside
      // notifyUserNewTransactions/sendToUser (recordPushFailure). This catch
      // only guards against an unexpected throw escaping that path (e.g. a
      // provider registry lookup failure) that isn't wrapped by
      // recordPushFailure. It does not reject -- so a BullMQ retry does not
      // re-send to the `usersNotified` users already processed earlier in
      // the loop -- but it does report `success: false` with `recorded:
      // false` so the job helper still records the failure in the dead
      // letter queue instead of it being lost, unlike main's previous
      // single catch-and-log around this whole path.
      const errorMsg = getErrorMessage(err);
      log.error(`Error sending push notifications: ${errorMsg}`);
      return { success: false, usersNotified, error: errorMsg, recorded: false };
    }

    return { success: true, usersNotified };
  }

  private async notifyUserNewTransactions(
    user: WalletNotificationUser,
    wallet: NotificationWallet,
    walletId: string,
    transactions: TransactionData[],
  ): Promise<void> {
    // Skip if user has no push devices registered (count already fetched)
    if (user._count.pushDevices === 0) return;

    // Use same wallet settings as Telegram
    const walletSettings = getWalletPushSettings(user.preferences, walletId);

    // Skip if notifications not enabled for this wallet
    if (!walletSettings?.enabled) return;

    // Send notification for each transaction that matches user's preferences
    for (const tx of transactions) {
      if (shouldSendTransactionNotification(tx, walletSettings)) {
        await this.sendToUser(user.id, buildTransactionPushMessage(wallet, tx));
      }
    }
  }

  /**
   * Get list of available providers
   */
  getProviders(): string[] {
    if (!this.initialized) {
      return [];
    }
    return this.registry.getAll().map((p) => p.name);
  }

  /**
   * Health check - test connectivity to providers
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    providers: Record<string, boolean>;
  }> {
    await this.ensureInitialized();

    const health = await this.registry.getHealth();
    const results: Record<string, boolean> = {};

    for (const status of health.providers) {
      results[status.name] = status.healthy;
    }

    return {
      healthy: health.healthyProviders > 0,
      providers: results,
    };
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    await this.registry.shutdown();
    this.initialized = false;
    log.info('Push service shut down');
  }
}

// Singleton instance
let pushService: PushService | null = null;

/**
 * Get push service instance
 */
export function getPushService(): PushService {
  if (!pushService) {
    pushService = new PushService();
  }
  return pushService;
}

// Export legacy functions for backward compatibility
export { PushMessage } from './types';

export function isPushConfigured(): boolean {
  // Check if providers would be configured (synchronous check)
  const apnsConfigured = !!(
    process.env.APNS_KEY_ID &&
    process.env.APNS_TEAM_ID &&
    process.env.APNS_KEY_PATH &&
    process.env.APNS_BUNDLE_ID
  );

  let fcmConfigured = false;
  const serviceAccountPath = process.env.FCM_SERVICE_ACCOUNT;
  if (serviceAccountPath) {
    try {
      const fs = require('fs');
      fs.accessSync(serviceAccountPath, fs.constants.R_OK);
      fcmConfigured = true;
    } catch (error) {
      /* v8 ignore next -- local file permission failure only disables optional FCM support */
      log.debug('FCM service account not accessible', {
        error: getErrorMessage(error),
      });
    }
  }

  return apnsConfigured || fcmConfigured;
}

export async function sendPushNotification(
  userId: string,
  message: PushMessage,
): Promise<void> {
  return getPushService().sendToUser(userId, message);
}

export async function notifyNewTransactions(
  walletId: string,
  transactions: TransactionData[],
): Promise<NotifyTransactionsResult> {
  return getPushService().notifyNewTransactions(walletId, transactions);
}

export default PushService;
