import type { Transaction } from '../../../types';
import { truncateAddress } from '../../../utils/formatters';

/**
 * What a transaction tab is called.
 *
 * A txid is 64 hex characters and every one of them looks the same at a glance,
 * so a strip of raw txids is unreadable. Where the transaction is in the loaded
 * list its direction leads, which is what distinguishes two tabs at speed; the
 * shortened txid follows, because that is what the user matches against the row
 * and the explorer. A tab opened from a deep link before its transaction has
 * resolved has only the txid to show.
 */
export function tabTitle(txid: string, tx: Transaction | null): string {
  const shortened = truncateAddress(txid, 6, 6);
  if (!tx) return shortened;
  return `${tx.amount > 0 ? 'Received' : 'Sent'} ${shortened}`;
}

/** Screen-reader name for the close control, which is otherwise a bare ×. */
export function closeTabLabel(txid: string, tx: Transaction | null): string {
  return `Close ${tabTitle(txid, tx)}`;
}

/** Screen-reader name for the control that pops a tab out into its own panel. */
export function detachTabLabel(txid: string, tx: Transaction | null): string {
  return `Detach ${tabTitle(txid, tx)}`;
}

/**
 * DOM ids linking each tab to its panel (`aria-controls` / `aria-labelledby`).
 * Scoped by the list's instance id because two transaction lists can be on one
 * page — the dashboard preview above wallet activity, for instance — and
 * duplicate ids would cross-wire their panels.
 */
export const tabDomId = (instanceId: string, tab: string): string =>
  `tx-tab-${instanceId}-${tab}`;

export const panelDomId = (instanceId: string, tab: string): string =>
  `tx-panel-${instanceId}-${tab}`;
