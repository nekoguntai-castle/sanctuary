/**
 * Wallet List Column Configuration
 *
 * Defines column metadata for the WalletList table view.
 * Used by ConfigurableTable for column rendering and ColumnConfigButton for user customization.
 */

import type { TableColumnConfig, WalletColumnId } from '../../types';

export const WALLET_COLUMNS: Record<WalletColumnId, TableColumnConfig> = {
  name: {
    id: 'name',
    label: 'Name',
    sortable: true,
    sortKey: 'name',
    defaultVisible: true,
    required: true,
    align: 'left',
  },
  type: {
    id: 'type',
    label: 'Type',
    sortable: true,
    sortKey: 'type',
    defaultVisible: true,
    required: false,
    align: 'left',
  },
  devices: {
    id: 'devices',
    label: 'Devices',
    sortable: true,
    sortKey: 'devices',
    defaultVisible: true,
    required: false,
    align: 'left',
  },
  sync: {
    id: 'sync',
    label: 'Sync',
    sortable: false,
    defaultVisible: true,
    required: false,
    align: 'left',
  },
  pending: {
    id: 'pending',
    label: 'Pending',
    sortable: false,
    defaultVisible: true,
    required: false,
    align: 'center',
  },
  balance: {
    id: 'balance',
    label: 'Balance',
    sortable: true,
    sortKey: 'balance',
    defaultVisible: true,
    required: true,
    align: 'right',
  },
};

/**
 * Default column order for wallet list table
 */
export const DEFAULT_WALLET_COLUMN_ORDER: WalletColumnId[] = [
  'name',
  'type',
  'devices',
  'sync',
  'pending',
  'balance',
];

/**
 * Default visible columns for wallet list table
 */
export const DEFAULT_WALLET_VISIBLE_COLUMNS: WalletColumnId[] = [
  'name',
  'type',
  'devices',
  'sync',
  'pending',
  'balance',
];

/**
 * Get ordered visible columns based on user preferences
 * Handles edge cases like missing columns or new columns added later
 */
export function getWalletColumnsInOrder(
  columnOrder: string[] | undefined,
  visibleColumns: string[] | undefined
): WalletColumnId[] {
  const order = columnOrder?.length ? columnOrder : DEFAULT_WALLET_COLUMN_ORDER;
  const visible = new Set(visibleColumns?.length ? visibleColumns : DEFAULT_WALLET_VISIBLE_COLUMNS);

  // Filter to only valid column IDs
  const validIds = new Set(Object.keys(WALLET_COLUMNS));

  // Get columns in order, filtered by visibility
  const result = order
    .filter((id): id is WalletColumnId => validIds.has(id) && visible.has(id));

  // Append any required columns that might be missing
  for (const [id, config] of Object.entries(WALLET_COLUMNS)) {
    if (config.required && !result.includes(id as WalletColumnId)) {
      result.push(id as WalletColumnId);
    }
  }

  return result;
}

/**
 * Merge saved column order with current column definitions
 * Handles new columns added after user saved preferences
 */
export function mergeWalletColumnOrder(savedOrder: string[] | undefined): WalletColumnId[] {
  if (!savedOrder?.length) return DEFAULT_WALLET_COLUMN_ORDER;

  const validIds = new Set(Object.keys(WALLET_COLUMNS));
  const result: WalletColumnId[] = [];
  const seen = new Set<string>();

  // Add saved columns that still exist
  for (const id of savedOrder) {
    if (validIds.has(id) && !seen.has(id)) {
      result.push(id as WalletColumnId);
      seen.add(id);
    }
  }

  // Append any new columns not in saved order
  for (const id of DEFAULT_WALLET_COLUMN_ORDER) {
    if (!seen.has(id)) {
      result.push(id);
    }
  }

  return result;
}
