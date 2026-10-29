import {
  findGatewayPushAudience,
  type GatewayPushAudience,
} from '../repositories/pushAudienceRepository';
import { isWalletTransactionNotificationEnabled } from '../services/push/notificationEligibility';
import { mobilePermissionService } from '../services/mobilePermissions';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { parseGatewayPushEvent, type GatewayPushEvent, type WebSocketEvent } from './types';

const log = createLogger('WS:GATEWAY:MAPPER');

export interface GatewayEvent extends WebSocketEvent {
  walletName?: string;
  userIds?: string[];
}

interface TransactionEventData {
  txid?: string;
  type?: string;
  amount?: number;
  [key: string]: unknown;
}

function asTransactionData(data: unknown): TransactionEventData {
  return data && typeof data === 'object' ? data as TransactionEventData : {};
}

function emptyAudience(event: WebSocketEvent, walletName?: string): GatewayEvent {
  return { ...event, ...(walletName ? { walletName } : {}), userIds: [] };
}

/**
 * Keep the users whose mobile `viewTransactions` cap is on. A
 * permission-lookup failure sends to nobody (fail closed).
 */
async function filterByViewTransactions(
  walletId: string,
  userIds: string[],
  logContext: Record<string, string> = {},
): Promise<string[]> {
  try {
    return await mobilePermissionService.filterUserIdsByMobileAction(
      walletId,
      userIds,
      'viewTransactions',
    );
  } catch (error) {
    log.warn('Gateway push mobile permission lookup failed; sending to nobody', {
      walletId,
      ...logContext,
      error: getErrorMessage(error),
    });
    return [];
  }
}

/** Recipients who enabled this notification and hold the `viewTransactions` cap. */
async function eligibleUserIds(
  audience: GatewayPushAudience,
  walletId: string,
  transactionType: string,
): Promise<string[]> {
  const preferred = [...new Set(audience.candidates
    .filter(({ preferences }) => isWalletTransactionNotificationEnabled(
      preferences,
      walletId,
      transactionType,
    ))
    .map(({ userId }) => userId))];

  return filterByViewTransactions(walletId, preferred);
}

interface WalletPushAccess {
  walletName: string;
  userIds: Set<string>;
}

/**
 * The wallet's current name and the users with direct or group access to it.
 * A missing wallet or a lookup failure returns null (send to nobody).
 */
async function findWalletPushAccess(walletId: string, type: string): Promise<WalletPushAccess | null> {
  try {
    // No transaction is involved, so the txid filter is one that matches nothing.
    const audience = await findGatewayPushAudience(walletId, '');
    if (!audience) {
      log.warn('Gateway push wallet not found; sending to nobody', { walletId, type });
      return null;
    }
    return {
      walletName: audience.walletName,
      userIds: new Set(audience.candidates.map(({ userId }) => userId)),
    };
  } catch (error) {
    log.warn('Gateway push wallet access lookup failed; sending to nobody', {
      walletId,
      type,
      error: getErrorMessage(error),
    });
    return null;
  }
}

/**
 * Re-derive a worker-resolved push event at send time. The event crossed
 * Redis, so only its validated fields survive; the listed recipients are
 * re-checked against current wallet access and then the mobile
 * `viewTransactions` cap, and the wallet name is re-read from the DB. Returns
 * null, meaning send to nobody, for a malformed event, an empty audience or
 * any lookup failure.
 */
export async function refilterPushAudience(input: GatewayPushEvent): Promise<GatewayPushEvent | null> {
  const event = parseGatewayPushEvent(input);
  if (!event) {
    log.warn('Dropping malformed gateway push event');
    return null;
  }
  const candidates = [...new Set(event.userIds)];
  if (candidates.length === 0) return null;

  const access = await findWalletPushAccess(event.walletId, event.type);
  if (!access) return null;
  const withAccess = candidates.filter((userId) => access.userIds.has(userId));
  if (withAccess.length === 0) return null;

  const userIds = await filterByViewTransactions(event.walletId, withAccess, { type: event.type });
  if (userIds.length === 0) return null;
  return { ...event, walletName: access.walletName, userIds };
}

/** Add the private push audience required by the external gateway. */
export async function mapGatewayEvent(event: WebSocketEvent): Promise<GatewayEvent> {
  if ((event.type !== 'transaction' && event.type !== 'confirmation') || !event.walletId) {
    return event;
  }

  const data = asTransactionData(event.data);
  if (!data.txid) {
    log.warn('Gateway push event missing transaction ID', { type: event.type, walletId: event.walletId });
    return emptyAudience(event);
  }

  const audience = await findGatewayPushAudience(event.walletId, data.txid);
  if (!audience) {
    log.warn('Gateway push wallet not found', { walletId: event.walletId, txid: data.txid });
    return emptyAudience(event);
  }

  if (event.type === 'confirmation') {
    // Confirmation broadcasts omit direction and amount, so use persisted data.
    const transaction = audience.transaction;
    if (!transaction) {
      log.warn('Gateway push transaction not found', { walletId: event.walletId, txid: data.txid });
      return emptyAudience(event, audience.walletName);
    }
    return {
      ...event,
      walletName: audience.walletName,
      userIds: await eligibleUserIds(audience, event.walletId, transaction.type),
      data: { ...data, type: transaction.type, amount: Number(transaction.amount) },
    };
  }

  const transactionType = data.type && data.amount != null ? data.type : null;
  if (!transactionType) {
    log.warn('Gateway push transaction not found', { walletId: event.walletId, txid: data.txid });
    return emptyAudience(event, audience.walletName);
  }

  return {
    ...event,
    walletName: audience.walletName,
    userIds: await eligibleUserIds(audience, event.walletId, transactionType),
  };
}
