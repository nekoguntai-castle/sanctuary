/**
 * Telegram Message Formatting
 *
 * Pure functions for formatting transaction and draft messages for Telegram.
 */

import { userRepository } from '../../repositories';
import type { TransactionData } from './types';

/**
 * Get all users who have access to a wallet (direct or via group)
 * Exported for use by other notification services (e.g., push notifications)
 */
export async function getWalletUsers(walletId: string, options?: { walletRoles?: string[] }) {
  return options === undefined
    ? userRepository.findByWalletAccess(walletId)
    : userRepository.findByWalletAccess(walletId, options);
}

/**
 * Format a transaction message for Telegram
 */
export function formatTransactionMessage(
  tx: TransactionData,
  wallet: { name: string },
  explorerUrl: string = 'https://mempool.space'
): string {
  const amountBtc = Number(tx.amount) / 100_000_000;
  const emoji = tx.type === 'received' ? '📥' : tx.type === 'sent' ? '📤' : '🔄';
  const typeLabel = tx.type.charAt(0).toUpperCase() + tx.type.slice(1);

  if (tx.agentOperationalSpend && tx.agentName) {
    const destinationLine = tx.agentDestinationClassification
      ? `Destination: ${formatDestinationClassification(tx.agentDestinationClassification)}\n`
      : '';
    const handlingLine = tx.agentUnknownDestinationHandlingMode
      ? `Handling: ${formatHandlingMode(tx.agentUnknownDestinationHandlingMode)}\n`
      : '';

    return (
      `${emoji} <b>Agent Operational Spend</b>\n` +
      `Agent: ${escapeHtml(tx.agentName)}\n` +
      `Operational Wallet: ${escapeHtml(wallet.name)}\n` +
      `Amount: ${amountBtc.toFixed(8)} BTC\n\n` +
      destinationLine +
      handlingLine +
      `<i>Review only. Sanctuary does not sign or broadcast operational wallet spends.</i>\n\n` +
      `<a href="${explorerUrl}/tx/${tx.txid}">View Transaction</a>`
    );
  }

  return (
    `${emoji} <b>${typeLabel}</b>\n` +
    `Wallet: ${escapeHtml(wallet.name)}\n` +
    `Amount: ${amountBtc.toFixed(8)} BTC\n\n` +
    `<a href="${explorerUrl}/tx/${tx.txid}">View Transaction</a>`
  );
}

function formatDestinationClassification(classification: string): string {
  switch (classification) {
    case 'external_spend':
      return 'External spend';
    case 'known_self_transfer':
      return 'Known self-transfer';
    case 'change_like_movement':
      return 'Change-like movement';
    case 'unknown_destination':
      return 'Unknown destination';
    default:
      return classification.replace(/_/g, ' ');
  }
}

function formatHandlingMode(mode: string): string {
  switch (mode) {
    case 'notify_only':
      return 'Notify only';
    case 'pause_agent':
      return 'Pause agent';
    case 'notify_and_pause':
      return 'Notify and pause';
    case 'record_only':
      return 'Record only';
    default:
      return mode.replace(/_/g, ' ');
  }
}

/**
 * Format a draft transaction message for Telegram
 */
export function formatDraftMessage(
  draft: {
    amount: bigint;
    recipient: string;
    label?: string | null;
    feeRate: number;
    agentName?: string | null;
    agentOperationalWalletName?: string | null;
    agentSigned?: boolean;
  },
  wallet: { name: string },
  createdBy: string
): string {
  const amountBtc = Number(draft.amount) / 100_000_000;
  const shortRecipient = `${draft.recipient.slice(0, 12)}...${draft.recipient.slice(-8)}`;

  if (draft.agentName) {
    let message =
      `📝 <b>Agent Funding Request</b>\n\n` +
      `Agent: ${escapeHtml(draft.agentName)}\n` +
      `From: ${escapeHtml(wallet.name)}\n` +
      `To: ${escapeHtml(draft.agentOperationalWalletName || 'Linked operational wallet')}\n` +
      `Address: <code>${shortRecipient}</code>\n` +
      `Amount: ${amountBtc.toFixed(8)} BTC\n` +
      `Fee Rate: ${draft.feeRate} sat/vB\n` +
      /* v8 ignore start -- agent funding drafts always include the initial agent signature */
      `Agent signature: ${draft.agentSigned ? 'present' : 'missing'}\n`;
      /* v8 ignore stop */

    /* v8 ignore next -- label is optional metadata and covered by standard draft formatting */
    if (draft.label) {
      message += `Label: ${escapeHtml(draft.label)}\n`;
    }

    message += `\n<i>Review in Sanctuary before signing. Once funded, the agent can spend from the operational wallet without multisig approval.</i>`;
    return message;
  }

  let message =
    `📝 <b>Draft Transaction Created</b>\n\n` +
    `Wallet: ${escapeHtml(wallet.name)}\n` +
    `Amount: ${amountBtc.toFixed(8)} BTC\n` +
    `To: <code>${shortRecipient}</code>\n` +
    `Fee Rate: ${draft.feeRate} sat/vB\n` +
    `Created by: ${escapeHtml(createdBy)}\n`;

  if (draft.label) {
    message += `Label: ${escapeHtml(draft.label)}\n`;
  }

  message += `\n<i>Awaiting signature</i>`;

  return message;
}

/**
 * Escape HTML special characters for Telegram
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
