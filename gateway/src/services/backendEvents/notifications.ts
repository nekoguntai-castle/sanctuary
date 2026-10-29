/**
 * Notification Formatting
 *
 * Pure functions for formatting push notifications from backend events.
 */

import * as push from '../push';
import type { BackendEvent, BackendEventType } from './types';

/**
 * Event types that should trigger push notifications
 */
export const PUSH_EVENT_TYPES: BackendEventType[] = [
  'transaction',
  'confirmation',
  'broadcast_success',
  'broadcast_failed',
  'psbt_signing_required',
  'draft_created',
  'draft_approved',
  'ai_insight',
  'consolidation_suggestion',
];

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

const formatConfirmationEvent = (event: BackendEvent): Notification => {
  const { data } = event;
  if (data.confirmations !== 1 || !data.txid) return null;

  return push.formatTransactionNotification(
    'confirmed',
    getWalletName(event),
    data.amount || 0,
    data.txid
  );
};

const formatBroadcastSuccessEvent = (event: BackendEvent): Notification => {
  if (!event.data.txid) return null;

  return push.formatBroadcastNotification(
    true,
    getWalletName(event),
    event.data.txid
  );
};

const formatBroadcastFailedEvent = (event: BackendEvent): Notification =>
  push.formatBroadcastNotification(
    false,
    getWalletName(event),
    event.data.txid || '',
    event.data.error
  );

const formatPsbtSigningEvent = (event: BackendEvent): Notification => {
  const { data } = event;
  if (!data.draftId || data.amount == null) return null;

  return push.formatPsbtSigningNotification(
    getWalletName(event),
    data.draftId,
    data.creatorName || 'Someone',
    data.amount,
    data.requiredSignatures ?? 2,
    data.currentSignatures ?? 1
  );
};

const formatDraftCreatedEvent = (event: BackendEvent): Notification => {
  const { data } = event;
  if (!data.draftId || data.amount == null) return null;

  return push.formatDraftCreatedNotification(
    getWalletName(event),
    data.draftId,
    data.creatorName || 'Someone',
    data.amount
  );
};

const formatDraftApprovedEvent = (event: BackendEvent): Notification => {
  const { data } = event;
  if (!data.draftId) return null;

  return push.formatDraftApprovedNotification(
    getWalletName(event),
    data.draftId,
    data.signerName || 'Someone',
    data.currentSignatures ?? 0,
    data.requiredSignatures ?? 0
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

    case 'broadcast_success':
      return formatBroadcastSuccessEvent(event);

    case 'broadcast_failed':
      return formatBroadcastFailedEvent(event);

    case 'psbt_signing_required':
      return formatPsbtSigningEvent(event);

    case 'draft_created':
      return formatDraftCreatedEvent(event);

    case 'draft_approved':
      return formatDraftApprovedEvent(event);

    case 'ai_insight':
      return formatAIInsightEvent(event);

    case 'consolidation_suggestion':
      return formatConsolidationSuggestionEvent(event);

    default:
      return null;
  }
}
