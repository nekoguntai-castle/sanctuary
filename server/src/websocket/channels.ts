/**
 * WebSocket Channel Subscription Management
 *
 * Handles channel subscription/unsubscription logic with:
 * - Subscription limits per connection
 * - Wallet access validation for wallet-specific channels
 * - Batch subscribe/unsubscribe for efficient multi-channel operations
 * - Event-to-channel routing for broadcast fanout
 */

import { checkWalletAccess } from '../services/accessControl';
import { createLogger } from '../utils/logger';
import {
  websocketRateLimitHits,
  websocketSubscriptions,
} from '../observability/metrics';
import {
  MAX_SUBSCRIPTIONS_PER_CONNECTION,
  AuthenticatedWebSocket,
  WebSocketEvent,
} from './types';
import { recordRateLimitEvent } from './rateLimiter';

const log = createLogger('WS_CHANNELS');

/**
 * Callback interface for channel operations that need to interact with the server
 */
export interface ChannelCallbacks {
  /** Send a message to the client */
  sendToClient(client: AuthenticatedWebSocket, message: unknown): boolean;
  /** Get the subscriptions map */
  getSubscriptions(): Map<string, Set<AuthenticatedWebSocket>>;
}

/**
 * Handle subscription request
 * SECURITY: Validates that user has access to wallet-specific channels
 */
export async function handleSubscribe(
  client: AuthenticatedWebSocket,
  data: { channel: string },
  callbacks: ChannelCallbacks
): Promise<void> {
  const { channel } = data;
  const subscriptions = callbacks.getSubscriptions();

  // Check subscription limit
  if (client.subscriptions.size >= MAX_SUBSCRIPTIONS_PER_CONNECTION) {
    log.warn('Subscription limit exceeded', {
      userId: client.userId,
      subscriptionCount: client.subscriptions.size,
      channel,
    });
    // Record metric and event
    websocketRateLimitHits.inc({ reason: 'subscription_limit' });
    recordRateLimitEvent(
      client.userId || null,
      'subscription_limit',
      `${client.subscriptions.size}/${MAX_SUBSCRIPTIONS_PER_CONNECTION} subscriptions`
    );
    callbacks.sendToClient(client, {
      type: 'error',
      data: {
        code: 'SUBSCRIPTION_LIMIT_EXCEEDED',
        message: `Subscription limit of ${MAX_SUBSCRIPTIONS_PER_CONNECTION} exceeded`,
        current: client.subscriptions.size,
        limit: MAX_SUBSCRIPTIONS_PER_CONNECTION,
        hint: 'Consider using fewer subscriptions or increase MAX_WS_SUBSCRIPTIONS',
      },
    });
    return;
  }

  // Validate subscription based on authentication
  if (channel.startsWith('wallet:') && !client.userId) {
    callbacks.sendToClient(client, {
      type: 'error',
      data: { message: 'Authentication required for wallet subscriptions' },
    });
    return;
  }

  // Validate wallet access for wallet-specific channels
  if (channel.startsWith('wallet:') && client.userId) {
    const walletIdMatch = channel.match(/^wallet:([a-f0-9-]+)/);
    if (walletIdMatch) {
      const walletId = walletIdMatch[1];
      const access = await checkWalletAccess(walletId, client.userId);
      if (!access.hasAccess) {
        log.warn(`User ${client.userId} denied access to wallet ${walletId}`);
        callbacks.sendToClient(client, {
          type: 'error',
          data: { message: 'Access denied to this wallet' },
        });
        return;
      }
    }
  }

  // Add to subscriptions
  client.subscriptions.add(channel);

  if (!subscriptions.has(channel)) {
    subscriptions.set(channel, new Set());
  }
  subscriptions.get(channel)!.add(client);

  // Track subscription gauge
  websocketSubscriptions.inc();

  log.info(`Client subscribed to ${channel} (total subscribers: ${subscriptions.get(channel)!.size})`);

  callbacks.sendToClient(client, {
    type: 'subscribed',
    data: { channel },
  });
}

/**
 * Handle unsubscribe request
 */
export function handleUnsubscribe(
  client: AuthenticatedWebSocket,
  data: { channel: string },
  callbacks: ChannelCallbacks
): void {
  const { channel } = data;
  const subscriptions = callbacks.getSubscriptions();

  // Only process if actually subscribed
  if (!client.subscriptions.has(channel)) return;

  client.subscriptions.delete(channel);

  const subscribers = subscriptions.get(channel);
  if (subscribers) {
    subscribers.delete(client);
    if (subscribers.size === 0) {
      subscriptions.delete(channel);
    }
  }

  // Track subscription gauge
  websocketSubscriptions.dec();

  log.debug(`Client unsubscribed from ${channel}`);

  callbacks.sendToClient(client, {
    type: 'unsubscribed',
    data: { channel },
  });
}

/**
 * Handle batch subscribe request (scalable subscription for many channels)
 * Reduces message count from O(N) to O(1) for N channels
 */
export async function handleSubscribeBatch(
  client: AuthenticatedWebSocket,
  data: { channels: string[] },
  callbacks: ChannelCallbacks
): Promise<void> {
  const { channels } = data;
  const subscriptions = callbacks.getSubscriptions();
  const subscribed: string[] = [];
  const errors: { channel: string; reason: string }[] = [];

  for (const channel of channels) {
    // Check subscription limit
    if (client.subscriptions.size >= MAX_SUBSCRIPTIONS_PER_CONNECTION) {
      errors.push({ channel, reason: 'Subscription limit reached' });
      continue;
    }

    // Skip if already subscribed
    if (client.subscriptions.has(channel)) {
      subscribed.push(channel);
      continue;
    }

    // Validate subscription based on authentication
    if (channel.startsWith('wallet:') && !client.userId) {
      errors.push({ channel, reason: 'Authentication required' });
      continue;
    }

    // Validate wallet access for wallet-specific channels
    if (channel.startsWith('wallet:') && client.userId) {
      const walletIdMatch = channel.match(/^wallet:([a-f0-9-]+)/);
      if (walletIdMatch) {
        const walletId = walletIdMatch[1];
        const access = await checkWalletAccess(walletId, client.userId);
        if (!access.hasAccess) {
          errors.push({ channel, reason: 'Access denied' });
          continue;
        }
      }
    }

    // Add to subscriptions
    client.subscriptions.add(channel);

    if (!subscriptions.has(channel)) {
      subscriptions.set(channel, new Set());
    }
    subscriptions.get(channel)!.add(client);
    subscribed.push(channel);

    // Track subscription gauge
    websocketSubscriptions.inc();
  }

  log.info(`Client batch subscribed to ${subscribed.length} channels (${errors.length} errors)`);

  callbacks.sendToClient(client, {
    type: 'subscribed_batch',
    data: { subscribed, errors: errors.length > 0 ? errors : undefined },
  });
}

/**
 * Handle batch unsubscribe request
 */
export function handleUnsubscribeBatch(
  client: AuthenticatedWebSocket,
  data: { channels: string[] },
  callbacks: ChannelCallbacks
): void {
  const { channels } = data;
  const subscriptions = callbacks.getSubscriptions();
  const unsubscribed: string[] = [];

  for (const channel of channels) {
    if (!client.subscriptions.has(channel)) continue;

    client.subscriptions.delete(channel);

    const subscribers = subscriptions.get(channel);
    if (subscribers) {
      subscribers.delete(client);
      if (subscribers.size === 0) {
        subscriptions.delete(channel);
      }
    }

    unsubscribed.push(channel);

    // Track subscription gauge
    websocketSubscriptions.dec();
  }

  log.debug(`Client batch unsubscribed from ${unsubscribed.length} channels`);

  callbacks.sendToClient(client, {
    type: 'unsubscribed_batch',
    data: { unsubscribed },
  });
}

/**
 * Get channels that should receive this event
 */
export function getChannelsForEvent(event: WebSocketEvent): string[] {
  const channels: string[] = [];

  // Global channels
  if (event.type === 'block' || event.type === 'newBlock') {
    channels.push('blocks');
  }

  if (event.type === 'mempool') {
    channels.push('mempool');
  }

  // Model download is a system-wide event - broadcast to all authenticated clients
  if (event.type === 'modelDownload') {
    channels.push('system');
  }

  // Sync events go to global channel for cross-page cache updates
  if (event.type === 'sync') {
    channels.push('sync:all');
  }

  // Transaction events go to global channel for cross-page cache updates
  // This ensures all browser windows receive updates even if wallet-specific
  // subscriptions failed due to auth race conditions
  if (event.type === 'transaction' || event.type === 'balance' || event.type === 'confirmation') {
    channels.push('transactions:all');
  }

  // Log events go to global channel for multi-window sync log visibility
  if (event.type === 'log') {
    channels.push('logs:all');
  }

  // Wallet-specific channels
  if (event.walletId) {
    channels.push(`wallet:${event.walletId}`);
    channels.push(`wallet:${event.walletId}:${event.type}`);
  }

  // Address-specific channels
  if (event.addressId) {
    channels.push(`address:${event.addressId}`);
  }

  return channels;
}
