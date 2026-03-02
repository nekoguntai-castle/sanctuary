/**
 * Telegram Message Formatting
 *
 * Pure functions for formatting transaction and draft messages for Telegram.
 */

import { db as prisma } from '../../repositories/db';
import type { TransactionData } from './types';

/**
 * Get all users who have access to a wallet (direct or via group)
 * Exported for use by other notification services (e.g., push notifications)
 */
export async function getWalletUsers(walletId: string) {
  return prisma.user.findMany({
    where: {
      OR: [
        { wallets: { some: { walletId } } },
        { groupMemberships: { some: { group: { wallets: { some: { id: walletId } } } } } },
      ],
    },
    select: { id: true, username: true, preferences: true },
  });
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

  return (
    `${emoji} <b>${typeLabel}</b>\n` +
    `Wallet: ${escapeHtml(wallet.name)}\n` +
    `Amount: ${amountBtc.toFixed(8)} BTC\n\n` +
    `<a href="${explorerUrl}/tx/${tx.txid}">View Transaction</a>`
  );
}

/**
 * Format a draft transaction message for Telegram
 */
export function formatDraftMessage(
  draft: { amount: bigint; recipient: string; label?: string | null; feeRate: number },
  wallet: { name: string },
  createdBy: string
): string {
  const amountBtc = Number(draft.amount) / 100_000_000;
  const shortRecipient = `${draft.recipient.slice(0, 12)}...${draft.recipient.slice(-8)}`;

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
