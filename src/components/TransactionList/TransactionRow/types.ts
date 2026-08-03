import type { ReactNode } from 'react';
import type { Transaction, Wallet } from '../../../types';

export interface TransactionRowProps {
  tx: Transaction;
  isReceive: boolean;
  isConsolidation: boolean;
  isHighlighted: boolean;
  txWallet: Wallet | undefined;
  showWalletBadge: boolean;
  walletBalance: number | undefined;
  confirmationThreshold: number;
  deepConfirmationThreshold: number;
  onWalletClick?: (walletId: string) => void;
  onTxClick: (tx: Transaction) => void;
}

export interface TransactionCellProps {
  tx: Transaction;
  highlightClass: string;
  onTxClick: (tx: Transaction) => void;
}

export interface ClickableCellProps extends TransactionCellProps {
  children: ReactNode;
  className?: string;
}
