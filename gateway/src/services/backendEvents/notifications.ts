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
];

/**
 * Format a push notification based on event type
 */
export function formatNotificationForEvent(event: BackendEvent): push.PushNotification | null {
  const walletName = event.walletName || 'Wallet';

  switch (event.type) {
    case 'transaction':
      if (!event.data.type || event.data.amount == null || !event.data.txid) return null;
      const txType = event.data.type === 'consolidation' ? 'sent' : event.data.type;
      return push.formatTransactionNotification(
        txType as 'received' | 'sent',
        walletName,
        event.data.amount,
        event.data.txid
      );

    case 'confirmation':
      // Only notify on first confirmation
      if (event.data.confirmations !== 1 || !event.data.txid) return null;
      return push.formatTransactionNotification(
        'confirmed',
        walletName,
        event.data.amount || 0,
        event.data.txid
      );

    case 'broadcast_success':
      if (!event.data.txid) return null;
      return push.formatBroadcastNotification(
        true,
        walletName,
        event.data.txid
      );

    case 'broadcast_failed':
      return push.formatBroadcastNotification(
        false,
        walletName,
        event.data.txid || '',
        event.data.error
      );

    case 'psbt_signing_required':
      if (!event.data.draftId || event.data.amount == null) return null;
      return push.formatPsbtSigningNotification(
        walletName,
        event.data.draftId,
        event.data.creatorName || 'Someone',
        event.data.amount,
        event.data.requiredSignatures ?? 2,
        event.data.currentSignatures ?? 1
      );

    case 'draft_created':
      if (!event.data.draftId || event.data.amount == null) return null;
      return push.formatDraftCreatedNotification(
        walletName,
        event.data.draftId,
        event.data.creatorName || 'Someone',
        event.data.amount
      );

    case 'draft_approved':
      if (!event.data.draftId) return null;
      return push.formatDraftApprovedNotification(
        walletName,
        event.data.draftId,
        event.data.signerName || 'Someone',
        event.data.currentSignatures ?? 0,
        event.data.requiredSignatures ?? 0
      );

    default:
      return null;
  }
}
