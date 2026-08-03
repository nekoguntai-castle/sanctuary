/**
 * Device List Column Configuration
 *
 * Defines column metadata for the DeviceList table view.
 * Used by ConfigurableTable for column rendering and ColumnConfigButton for user customization.
 */

import type { TableColumnConfig, DeviceColumnId } from '../../types';

export const DEVICE_COLUMNS: Record<DeviceColumnId, TableColumnConfig> = {
  label: {
    id: 'label',
    label: 'Label',
    sortable: true,
    sortKey: 'label',
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
  fingerprint: {
    id: 'fingerprint',
    label: 'Fingerprint',
    sortable: true,
    sortKey: 'fingerprint',
    defaultVisible: true,
    required: false,
    align: 'left',
  },
  accounts: {
    id: 'accounts',
    label: 'Accounts',
    sortable: false,
    defaultVisible: true,
    required: false,
    align: 'left',
  },
  wallets: {
    id: 'wallets',
    label: 'Wallets',
    sortable: true,
    sortKey: 'wallets',
    defaultVisible: true,
    required: false,
    align: 'left',
  },
  actions: {
    id: 'actions',
    label: 'Actions',
    sortable: false,
    defaultVisible: true,
    required: false,
    align: 'right',
  },
};

/**
 * Default column order for device list table
 */
export const DEFAULT_DEVICE_COLUMN_ORDER: DeviceColumnId[] = [
  'label',
  'type',
  'fingerprint',
  'accounts',
  'wallets',
  'actions',
];

/**
 * Default visible columns for device list table
 */
export const DEFAULT_DEVICE_VISIBLE_COLUMNS: DeviceColumnId[] = [
  'label',
  'type',
  'fingerprint',
  'accounts',
  'wallets',
  'actions',
];

/**
 * Get ordered visible columns based on user preferences
 * Handles edge cases like missing columns or new columns added later
 */
export function getDeviceColumnsInOrder(
  columnOrder: string[] | undefined,
  visibleColumns: string[] | undefined
): DeviceColumnId[] {
  const order = columnOrder?.length ? columnOrder : DEFAULT_DEVICE_COLUMN_ORDER;
  const visible = new Set(visibleColumns?.length ? visibleColumns : DEFAULT_DEVICE_VISIBLE_COLUMNS);

  // Filter to only valid column IDs
  const validIds = new Set(Object.keys(DEVICE_COLUMNS));

  // Get columns in order, filtered by visibility
  const result = order
    .filter((id): id is DeviceColumnId => validIds.has(id) && visible.has(id));

  // Append any required columns that might be missing
  for (const [id, config] of Object.entries(DEVICE_COLUMNS)) {
    if (config.required && !result.includes(id as DeviceColumnId)) {
      result.push(id as DeviceColumnId);
    }
  }

  return result;
}

/**
 * Merge saved column order with current column definitions
 * Handles new columns added after user saved preferences
 */
export function mergeDeviceColumnOrder(savedOrder: string[] | undefined): DeviceColumnId[] {
  if (!savedOrder?.length) return DEFAULT_DEVICE_COLUMN_ORDER;

  const validIds = new Set(Object.keys(DEVICE_COLUMNS));
  const result: DeviceColumnId[] = [];
  const seen = new Set<string>();

  // Add saved columns that still exist
  for (const id of savedOrder) {
    if (validIds.has(id) && !seen.has(id)) {
      result.push(id as DeviceColumnId);
      seen.add(id);
    }
  }

  // Append any new columns not in saved order
  for (const id of DEFAULT_DEVICE_COLUMN_ORDER) {
    if (!seen.has(id)) {
      result.push(id);
    }
  }

  return result;
}
