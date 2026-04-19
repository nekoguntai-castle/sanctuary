import type { Transaction } from '../../../types';
import { isConsolidation } from '../../../utils/transaction';

export type ConfirmationStatus = {
  icon: 'shield' | 'check' | 'clock';
  label: string;
  className: string;
};

export type TransactionTypeInfo = {
  label: 'Consolidation' | 'Received' | 'Sent';
  className: string;
  isConsolidation: boolean;
};

export type DetailCard = {
  label: string;
  value: string;
  muted?: boolean;
};

export function getConfirmationStatus(
  confirmations: number | undefined,
  confirmationThreshold: number,
  deepConfirmationThreshold: number
): ConfirmationStatus {
  const safeConfirmations = confirmations ?? 0;

  if (safeConfirmations >= deepConfirmationThreshold) {
    return {
      icon: 'shield',
      label: `${safeConfirmations.toLocaleString()} Confirmations (Final)`,
      className: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-300',
    };
  }

  if (safeConfirmations >= confirmationThreshold) {
    return {
      icon: 'check',
      label: `${safeConfirmations}/${deepConfirmationThreshold} Confirmations`,
      className: 'bg-success-100 text-success-800 dark:bg-success-500/20 dark:text-success-300',
    };
  }

  if (safeConfirmations > 0) {
    return {
      icon: 'clock',
      label: `Confirming (${safeConfirmations}/${deepConfirmationThreshold})`,
      className: 'bg-primary-100 text-primary-800 dark:bg-primary-500/20 dark:text-primary-300',
    };
  }

  return {
    icon: 'clock',
    label: 'Pending Confirmation',
    className: 'bg-warning-100 text-warning-800 dark:bg-warning-500/20 dark:text-warning-300',
  };
}

export function getTransactionTypeInfo(tx: Transaction, walletAddresses: string[]): TransactionTypeInfo {
  const selectedConsolidation = isConsolidation(tx, walletAddresses);
  if (selectedConsolidation) {
    return {
      label: 'Consolidation',
      className: 'text-primary-600 dark:text-primary-400',
      isConsolidation: true,
    };
  }

  if (tx.amount > 0) {
    return {
      label: 'Received',
      className: 'text-success-600 dark:text-success-400',
      isConsolidation: false,
    };
  }

  return {
    label: 'Sent',
    className: 'text-sanctuary-900 dark:text-sanctuary-100',
    isConsolidation: false,
  };
}

export function getTimestampParts(tx: Transaction): { date: string; time: string; header: string } {
  if (!tx.timestamp) {
    return { date: 'Pending', time: '', header: 'Pending' };
  }

  const date = new Date(tx.timestamp);
  return {
    date: date.toLocaleDateString(),
    time: date.toLocaleTimeString(),
    header: date.toLocaleString(),
  };
}

export function getBlockHeightCard(tx: Transaction): DetailCard {
  if (tx.blockHeight != null && tx.blockHeight > 0) {
    return { label: 'Block Height', value: tx.blockHeight.toLocaleString() };
  }

  return { label: 'Block Height', value: 'Unconfirmed', muted: true };
}

export function getFeeOrConfirmationCard(
  tx: Transaction,
  format: (sats: number, options?: { forceSats?: boolean }) => string
): DetailCard {
  if (tx.amount < 0) {
    return getFeeCard(tx, format);
  }

  return {
    label: 'Confirmations',
    value: tx.confirmations?.toLocaleString() || '0',
  };
}

function getFeeCard(
  tx: Transaction,
  format: (sats: number, options?: { forceSats?: boolean }) => string
): DetailCard {
  if (tx.fee != null && tx.fee > 0) {
    return { label: 'Network Fee', value: format(tx.fee, { forceSats: true }) };
  }

  return { label: 'Network Fee', value: 'N/A', muted: true };
}

export function getCounterpartyAddressTitle(tx: Transaction, walletAddresses: string[]): string {
  if (isConsolidation(tx, walletAddresses)) {
    return 'Consolidation Address (Your Wallet)';
  }

  return tx.amount > 0 ? 'Sender Address' : 'Recipient Address';
}

export function getOwnAddressTitle(tx: Transaction): string {
  return tx.amount > 0 ? 'Your Receiving Address' : 'Your Sending Address';
}

export function getOwnAddressValue(tx: Transaction): string {
  const address = tx.address;
  if (!address) {
    return '';
  }

  return typeof address === 'string' ? address : address.address;
}
