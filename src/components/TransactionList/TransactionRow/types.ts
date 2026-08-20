import type { ReactNode } from 'react';
import type { Transaction, Wallet } from '../../../types';

/**
 * How a row click asks for its tab. `background` opens without switching to it,
 * the way a modifier-click opens a browser tab — the point of tabs is queueing
 * several transactions without losing your place in the table.
 */
export interface TxClickOptions {
  background?: boolean;
}

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
  onTxClick: (tx: Transaction, options?: TxClickOptions) => void;
}

export interface TransactionCellProps {
  tx: Transaction;
  highlightClass: string;
  onTxClick: (tx: Transaction, options?: TxClickOptions) => void;
}

export interface ClickableCellProps extends TransactionCellProps {
  children: ReactNode;
  className?: string;
}
