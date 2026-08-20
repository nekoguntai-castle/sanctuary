import type { Label, Transaction, Wallet } from '../../../types';

/**
 * Everything a detail panel needs that is the same for every open tab.
 *
 * Assembled once by `TransactionList` and spread into each panel, so opening a
 * second tab costs one txid rather than another twenty props. What is *not*
 * here is per-transaction state — resolution and label editing both live inside
 * the panel, which is what keeps two open transactions from sharing a slot.
 */
export interface TransactionPanelSharedProps {
  wallets: Wallet[];
  walletAddresses: string[];
  walletLabels: Label[];
  selectionTransactions: Transaction[];
  walletId?: string;
  explorerUrl: string;
  copied: boolean;
  canEdit: boolean;
  aiEnabled: boolean;
  confirmationThreshold: number;
  deepConfirmationThreshold: number;
  format: (sats: number, options?: { forceSats?: boolean }) => string;
  onCopyToClipboard: (text: string) => Promise<void>;
  onLabelsChange?: () => void;
}
