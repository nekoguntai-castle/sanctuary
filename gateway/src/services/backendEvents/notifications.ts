/**
 * Notification Formatting
 *
 * Pure functions for formatting push notifications from backend events.
 */

import { GATEWAY_NOTIFIED_EVENT_TYPES } from '@sanctuary/shared/constants/gatewayEvents';
import * as push from '../push';
import type { BackendEvent, BackendEventType } from './types';

/**
 * Event types that should trigger push notifications
 */
export const PUSH_EVENT_TYPES: readonly BackendEventType[] = GATEWAY_NOTIFIED_EVENT_TYPES;

type Notification = push.PushNotification | null;

const getWalletName = (event: BackendEvent): string => event.walletName || 'Wallet';

const toTransactionNotificationType = (
  type: NonNullable<BackendEvent['data']['type']>
): 'received' | 'sent' => (type === 'consolidation' ? 'sent' : type);

const formatTransactionEvent = (event: BackendEvent): Notification => {
  const { data } = event;
  if (!data.type || data.amount == null || !data.txid) return null;

  return push.formatTransactionNotification(
    toTransactionNotificationType(data.type),
    getWalletName(event),
    data.amount,
    data.txid
  );
};

/**
 * The server's first-confirmation milestone (previous 0 -> now >= 1), so a
 * block that lands 0 -> 2 still notifies. Without previousConfirmations (older
 * servers) only an exact 1 counts.
 */
const isFirstConfirmation = ({ confirmations, previousConfirmations }: BackendEvent['data']): boolean => {
  if (confirmations === undefined) return false;
  return previousConfirmations === undefined
    ? confirmations === 1
    : previousConfirmations === 0 && confirmations >= 1;
};

const formatConfirmationEvent = (event: BackendEvent): Notification => {
  const { data } = event;
  if (!isFirstConfirmation(data) || !data.txid) return null;

  return push.formatTransactionNotification(
    'confirmed',
    getWalletName(event),
    data.amount || 0,
    data.txid
  );
};

// Wallet-level pushes are deliberately minimal (decision D-4): wallet name
// plus severity/type or fee rate, never AI summary text, amounts or UTXO counts.
const formatAIInsightEvent = (event: BackendEvent): Notification => {
  const { data } = event;
  if (!data.insightId || !data.severity) return null;
  const typeLabel = data.insightTypeLabel || data.insightType || 'wallet';

  return {
    title: 'Treasury Intelligence',
    body: `${getWalletName(event)}: ${data.severity} ${typeLabel} insight`,
    data: { walletId: event.walletId, insightId: data.insightId, kind: 'ai_insight' },
  };
};

const formatConsolidationSuggestionEvent = (event: BackendEvent): Notification => {
  const { feeRate } = event.data;
  if (typeof feeRate !== 'number' || !Number.isFinite(feeRate)) return null;

  return {
    title: 'Consolidation opportunity',
    body: `${getWalletName(event)}: fees are low (${feeRate} sat/vB)`,
    data: { walletId: event.walletId, kind: 'consolidation_suggestion' },
  };
};

/**
 * Format a push notification based on event type
 */
export function formatNotificationForEvent(event: BackendEvent): push.PushNotification | null {
  switch (event.type) {
    case 'transaction':
      return formatTransactionEvent(event);

    case 'confirmation':
      return formatConfirmationEvent(event);

    case 'ai_insight':
      return formatAIInsightEvent(event);

    case 'consolidation_suggestion':
      return formatConsolidationSuggestionEvent(event);

    default:
      return null;
  }
}
