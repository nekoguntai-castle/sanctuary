import { checkWalletAccessUncached } from '../services/accessControl';
import { resolveCurrentAccessTokenPayload } from '../services/accessTokenSessionService';
import { isTokenRevoked } from '../services/tokenRevocation';
import { websocketSubscriptions } from '../observability/metrics';
import { getErrorMessage } from '../utils/errors';
import { createLogger } from '../utils/logger';
import { getChannelsForEvent } from './channels';
import type { WebSocketAuthorizationControl } from './authorizationControl';
import { bumpSubscriptionGeneration, type AuthenticatedWebSocket, type WebSocketEvent } from './types';

const log = createLogger('WS:CLIENT_AUTHORIZATION');

interface ClientAuthorizationContext {
  clients: Set<AuthenticatedWebSocket>;
  subscriptions: Map<string, Set<AuthenticatedWebSocket>>;
  connectionsPerUser: Map<string, Set<AuthenticatedWebSocket>>;
  revokeClient(client: AuthenticatedWebSocket): void;
}

interface LocalBroadcastContext extends ClientAuthorizationContext {
  sendToClient(client: AuthenticatedWebSocket, message: unknown): boolean;
}

interface PrivateEventAuthorizationCache {
  byClient: Map<AuthenticatedWebSocket, Promise<boolean>>;
  walletAccessByUser: Map<string, Promise<WalletAccessDecision>>;
}

type WalletAccessDecision = 'allowed' | 'denied' | 'unavailable';

async function resolveWalletAccess(walletId: string, userId: string): Promise<WalletAccessDecision> {
  try {
    const access = await checkWalletAccessUncached(walletId, userId);
    return access.hasAccess ? 'allowed' : 'denied';
  } catch (error) {
    log.error('Wallet access revalidation unavailable', {
      error: getErrorMessage(error), walletId, userId,
    });
    return 'unavailable';
  }
}

async function revalidateClientAuthorization(
  client: AuthenticatedWebSocket,
  context: ClientAuthorizationContext,
): Promise<boolean> {
  try {
    if (
      !client.userId || !client.authClaims || !client.authJti ||
      typeof client.authSessionVersion !== 'number' ||
      typeof client.authExpiresAt !== 'number' || client.authExpiresAt <= Date.now()
    ) {
      throw new Error('Missing or expired access-token claims');
    }

    const current = await resolveCurrentAccessTokenPayload(client.authClaims);
    if (
      current.userId !== client.userId ||
      current.sessionVersion !== client.authSessionVersion ||
      await isTokenRevoked(client.authJti)
    ) {
      throw new Error('Access token is no longer current');
    }
    return true;
  } catch (error) {
    log.warn('WebSocket authorization revalidation failed', {
      error: getErrorMessage(error), userId: client.userId,
    });
    context.revokeClient(client);
    return false;
  }
}

function walletChannelPrefix(walletId: string): string {
  return `wallet:${walletId}`;
}

function hasWalletSubscription(client: AuthenticatedWebSocket, walletId: string): boolean {
  const prefix = walletChannelPrefix(walletId);
  return Array.from(client.subscriptions).some(
    (channel) => channel === prefix || channel.startsWith(`${prefix}:`),
  );
}

function removeWalletSubscriptions(
  client: AuthenticatedWebSocket,
  walletId: string,
  subscriptions: Map<string, Set<AuthenticatedWebSocket>>,
): void {
  const prefix = walletChannelPrefix(walletId);
  let removed = 0;
  for (const channel of Array.from(client.subscriptions)) {
    if (channel !== prefix && !channel.startsWith(`${prefix}:`)) continue;
    client.subscriptions.delete(channel);
    bumpSubscriptionGeneration(client);
    removed++;
    const subscribers = subscriptions.get(channel);
    subscribers?.delete(client);
    if (subscribers?.size === 0) subscriptions.delete(channel);
  }
  if (removed > 0) websocketSubscriptions.dec(removed);
}

async function canReceivePrivateEvent(
  client: AuthenticatedWebSocket,
  walletId: string,
  cache: PrivateEventAuthorizationCache,
  context: ClientAuthorizationContext,
): Promise<boolean> {
  let authorization = cache.byClient.get(client);
  if (!authorization) {
    authorization = revalidateClientAuthorization(client, context);
    cache.byClient.set(client, authorization);
  }
  if (!(await authorization) || !client.userId) return false;

  let walletAccess = cache.walletAccessByUser.get(client.userId);
  if (!walletAccess) {
    walletAccess = resolveWalletAccess(walletId, client.userId);
    cache.walletAccessByUser.set(client.userId, walletAccess);
  }

  const decision = await walletAccess;
  if (decision === 'allowed') return true;
  if (decision === 'denied') removeWalletSubscriptions(client, walletId, context.subscriptions);
  return false;
}

export async function broadcastAuthorizedEvent(
  event: WebSocketEvent,
  context: LocalBroadcastContext,
): Promise<void> {
  const channels = getChannelsForEvent(event);
  const walletId = typeof event.walletId === 'string' && event.walletId.length > 0
    ? event.walletId
    : null;
  const cache: PrivateEventAuthorizationCache = {
    byClient: new Map(),
    walletAccessByUser: new Map(),
  };

  for (const channel of channels) {
    const subscribers = context.subscriptions.get(channel);
    if (!subscribers) continue;
    const clients = Array.from(subscribers);
    const subscriptionGenerations = clients.map((client) => client.subscriptionGeneration);
    const authorized = walletId
      ? await Promise.all(clients.map((client) => canReceivePrivateEvent(client, walletId, cache, context)))
      : clients.map(() => true);
    const message = {
      type: 'event', event: event.type, data: event.data, channel, timestamp: Date.now(),
    };
    for (const [index, client] of clients.entries()) {
      if (
        authorized[index] &&
        client.subscriptionGeneration === subscriptionGenerations[index] &&
        context.subscriptions.get(channel)?.has(client)
      ) {
        context.sendToClient(client, message);
      }
    }
  }
}

async function revalidateChangedWallet(
  walletId: string,
  context: ClientAuthorizationContext,
): Promise<void> {
  const accessByUser = new Map<string, Promise<WalletAccessDecision>>();
  for (const client of context.clients) {
    if (!client.userId || !hasWalletSubscription(client, walletId)) continue;
    let hasAccess = accessByUser.get(client.userId);
    if (!hasAccess) {
      hasAccess = resolveWalletAccess(walletId, client.userId);
      accessByUser.set(client.userId, hasAccess);
    }
    if (await hasAccess === 'denied') {
      removeWalletSubscriptions(client, walletId, context.subscriptions);
    }
  }
}

export async function applyAuthorizationControlToClients(
  control: WebSocketAuthorizationControl,
  context: ClientAuthorizationContext,
): Promise<void> {
  if (control.type === 'wallet-access-changed') {
    await revalidateChangedWallet(control.walletId, context);
    return;
  }

  const clients = control.type === 'user-access-revoked'
    ? Array.from(context.connectionsPerUser.get(control.userId) ?? [])
    : Array.from(context.clients).filter((client) => client.authJti === control.jti);
  for (const client of clients) context.revokeClient(client);
}
