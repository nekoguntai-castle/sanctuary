import type { Wallet } from '../../../src/api/wallets';
import type { CellRendererProps } from '../../ui/ConfigurableTable';

export interface WalletWithPending extends Wallet {
  pendingData?: {
    net: number;
    count: number;
    hasIncoming: boolean;
    hasOutgoing: boolean;
  };
}

export interface CurrencyFormatter {
  format: (sats: number) => string;
  formatFiat: (sats: number) => string | null;
  showFiat: boolean;
}

export type WalletCellProps = CellRendererProps<WalletWithPending>;
