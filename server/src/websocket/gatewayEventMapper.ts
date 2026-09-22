import {
  findGatewayPushAudience,
  type GatewayPushAudience,
} from '../repositories/pushAudienceRepository';
import { isWalletTransactionNotificationEnabled } from '../services/push/notificationEligibility';
import { createLogger } from '../utils/logger';
import type { WebSocketEvent } from './types';

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

function eligibleUserIds(
  audience: GatewayPushAudience,
  walletId: string,
  transactionType: string,
): string[] {
  return [...new Set(audience.candidates
    .filter(({ preferences }) => isWalletTransactionNotificationEnabled(
      preferences,
      walletId,
      transactionType,
    ))
    .map(({ userId }) => userId))];
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
      userIds: eligibleUserIds(audience, event.walletId, transaction.type),
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
    userIds: eligibleUserIds(audience, event.walletId, transactionType),
  };
}
