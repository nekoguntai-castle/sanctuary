/**
 * Wallet Cell Renderers
 *
 * Cell components for the WalletList ConfigurableTable.
 * Uses a factory pattern to inject shared dependencies (currency formatting, pending data).
 */

import { BalanceCell, DevicesCell, NameCell, PendingCell, SyncCell, TypeCell } from './WalletCells/WalletCellRenderers';
import type { CellRendererProps } from '../ui/ConfigurableTable';
import type { CellRenderers } from '../ui/ConfigurableTable/types';
import type { CurrencyFormatter, WalletWithPending } from './WalletCells/types';
export type { WalletWithPending } from './WalletCells/types';

/**
 * Create wallet cell renderers with injected dependencies
 */
export function createWalletCellRenderers(currency: CurrencyFormatter): CellRenderers<WalletWithPending> {
  return {
    name: NameCell,
    type: TypeCell,
    devices: DevicesCell,
    sync: SyncCell,
    pending: PendingCell,
    balance: ({ item }: CellRendererProps<WalletWithPending>) => (
      <BalanceCell wallet={item} currency={currency} />
    ),
  };
}
