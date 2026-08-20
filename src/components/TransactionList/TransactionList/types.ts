import type { Label, Transaction, Wallet } from '../../../types';

/**
 * Props for the transaction-details body, which is rendered inside a detail
 * tab's panel — docked in the tab strip or, from phase 2, detached into a
 * floating panel. The chrome differs; the body does not.
 *
 * `onClose` means "close this tab": it drops the transaction from `?tx` and
 * hands focus to the neighbouring tab.
 */
export interface TransactionDetailsContentProps {
  selectedTx: Transaction;
  wallets: Wallet[];
  walletAddresses: string[];
  explorerUrl: string;
  copied: boolean;
  fullTxDetails: Transaction | null;
  loadingDetails: boolean;
  editingLabels: boolean;
  availableLabels: Label[];
  selectedLabelIds: string[];
  savingLabels: boolean;
  labelMutationError: string | null;
  canEdit: boolean;
  aiEnabled: boolean;
  confirmationThreshold: number;
  deepConfirmationThreshold: number;
  format: (sats: number, options?: { forceSats?: boolean }) => string;
  onClose: () => void;
  onLabelsChange?: () => void;
  onCopyToClipboard: (text: string) => Promise<void>;
  onEditLabels: (tx: Transaction) => void;
  onSaveLabels: () => void;
  onCancelEdit: () => void;
  onToggleLabel: (labelId: string) => void;
  onAISuggestion: (suggestion: string) => void;
}
