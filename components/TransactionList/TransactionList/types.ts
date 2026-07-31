import type { Label, Transaction, Wallet } from '../../../types';
import type { SelectionStatus } from '../hooks/selectionResolution';

/**
 * Props shared by the transaction-details body and its two hosts:
 * the phone modal (`TransactionDetailsModal`) and the tablet+ split-view
 * pane (`TransactionDetailPane`). Both render the identical body via
 * `TransactionDetailsBody`; only the chrome around it differs.
 *
 * `onClose` means "deselect": close the modal on phone, clear the pane
 * (and the `?tx` URL param) on tablet+.
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

/**
 * The unified detail view is a full-screen modal below `tablet` and an inline
 * split-view pane at `tablet`+. It renders an empty state when nothing is
 * selected (pane only), so `selectedTx` is nullable.
 */
export interface TransactionDetailProps
  extends Omit<TransactionDetailsContentProps, 'selectedTx'> {
  selectedTx: Transaction | null;
  selectionStatus: SelectionStatus;
  selectionError: string | null;
  onRetrySelection: () => void;
  /** Pixel height to match the master table column so the pane scrolls independently. */
  tableHeight: number;
}
