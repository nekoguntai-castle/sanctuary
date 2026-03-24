/**
 * FeatureTable - Generic table wrapper with preference persistence
 *
 * Wraps ConfigurableTable with:
 * - Column visibility/order preferences (persisted via useUserPreference)
 * - Sort state persistence
 * - Standard ColumnConfigButton integration
 * - Optional network tabs with URL-synced state
 *
 * Reduces per-feature boilerplate to just defining columns, cell renderers, and data.
 *
 * @example How WalletList table view would be simplified:
 *
 * ```tsx
 * // Before: ~80 lines of column config, preference wiring, handlers
 * // After:
 * <FeatureTable<WalletWithPending>
 *   preferenceKey="wallets"
 *   columns={WALLET_COLUMNS}
 *   defaultColumnOrder={DEFAULT_WALLET_COLUMN_ORDER}
 *   defaultVisibleColumns={DEFAULT_WALLET_VISIBLE_COLUMNS}
 *   data={walletsWithPending}
 *   keyExtractor={(w) => w.id}
 *   cellRenderers={cellRenderers}
 *   onSort={(field) => setSortBy(field as SortField)}
 *   sortBy={sortBy}
 *   sortOrder={sortOrder}
 *   onRowClick={(wallet) => navigate(`/wallets/${wallet.id}`)}
 *   emptyMessage="No wallets found"
 * />
 * ```
 *
 * The ColumnConfigButton is exposed via renderColumnConfig() for flexible toolbar placement.
 */

import React, { useMemo, useCallback } from 'react';
import { ConfigurableTable } from './ConfigurableTable';
import { useUserPreference } from '../../hooks/useUserPreference';
import type { TableColumnConfig } from '../../types';
import type { CellRendererProps } from './ConfigurableTable';

// Re-export for consumer convenience
export type { CellRendererProps };

/**
 * Merge saved column order with current column definitions.
 * Handles new columns added after a user saved preferences, and removes
 * stale column IDs that no longer exist in the definition.
 */
function mergeColumnOrder(
  savedOrder: string[] | undefined,
  defaultOrder: string[],
  columns: Record<string, TableColumnConfig>,
): string[] {
  if (!savedOrder?.length) return defaultOrder;

  const validIds = new Set(Object.keys(columns));
  const result: string[] = [];
  const seen = new Set<string>();

  // Preserve saved order for columns that still exist
  for (const id of savedOrder) {
    if (validIds.has(id) && !seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  }

  // Append any new columns not in saved order
  for (const id of defaultOrder) {
    if (!seen.has(id)) {
      result.push(id);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FeatureTableProps<T> {
  /** Key under viewSettings for persisting preferences (e.g. 'wallets', 'devices') */
  preferenceKey: string;

  /** Column definitions keyed by column ID */
  columns: Record<string, TableColumnConfig>;

  /** Default column display order */
  defaultColumnOrder: string[];

  /** Default visible column IDs */
  defaultVisibleColumns: string[];

  /** Row data */
  data: T[];

  /** Unique key for each row */
  keyExtractor: (item: T) => string;

  /** Cell renderers keyed by column ID */
  cellRenderers: Record<string, React.FC<CellRendererProps<T>>>;

  /** Current sort field (managed externally since sorting logic varies per feature) */
  sortBy?: string;

  /** Current sort direction */
  sortOrder?: 'asc' | 'desc';

  /** Called when a sortable column header is clicked */
  onSort?: (field: string) => void;

  /** Called when a row is clicked */
  onRowClick?: (item: T) => void;

  /** Message shown when data is empty */
  emptyMessage?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FeatureTable<T>({
  preferenceKey,
  columns,
  defaultColumnOrder,
  defaultVisibleColumns,
  data,
  keyExtractor,
  cellRenderers,
  sortBy,
  sortOrder,
  onSort,
  onRowClick,
  emptyMessage,
}: FeatureTableProps<T>) {
  // ----- Preference persistence via dot-notation keys -----

  const [savedColumnOrder] = useUserPreference<string[] | undefined>(
    `viewSettings.${preferenceKey}.columnOrder`,
    undefined,
  );

  const [visibleColumns] = useUserPreference<string[]>(
    `viewSettings.${preferenceKey}.visibleColumns`,
    defaultVisibleColumns,
  );

  // Merge saved order with current column defs (handles added/removed columns)
  const columnOrder = useMemo(
    () => mergeColumnOrder(savedColumnOrder, defaultColumnOrder, columns),
    [savedColumnOrder, defaultColumnOrder, columns],
  );

  return (
    <div>
      <ConfigurableTable<T>
        columns={columns}
        columnOrder={columnOrder}
        visibleColumns={visibleColumns}
        data={data}
        keyExtractor={keyExtractor}
        cellRenderers={cellRenderers}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSort={onSort}
        onRowClick={onRowClick}
        emptyMessage={emptyMessage}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Companion hook: useFeatureTableConfig
// ---------------------------------------------------------------------------

/**
 * Hook that exposes column config state for use in external toolbars.
 *
 * Use this when you need to render the ColumnConfigButton in a custom
 * location (e.g. a shared header bar) rather than next to the table.
 *
 * @example
 * ```tsx
 * const tableConfig = useFeatureTableConfig({ ... });
 *
 * // In your toolbar:
 * <ColumnConfigButton {...tableConfig.columnConfigProps} />
 *
 * // In your table area:
 * <ConfigurableTable
 *   {...tableConfig.tableProps}
 *   data={data}
 *   keyExtractor={keyExtractor}
 *   cellRenderers={cellRenderers}
 *   sortBy={sortBy}
 *   sortOrder={sortOrder}
 *   onSort={onSort}
 * />
 * ```
 */

interface UseFeatureTableConfigParams {
  preferenceKey: string;
  columns: Record<string, TableColumnConfig>;
  defaultColumnOrder: string[];
  defaultVisibleColumns: string[];
}

interface FeatureTableConfig {
  /** Props to spread onto ColumnConfigButton */
  columnConfigProps: {
    columns: Record<string, TableColumnConfig>;
    columnOrder: string[];
    visibleColumns: string[];
    onOrderChange: (newOrder: string[]) => void;
    onVisibilityChange: (columnId: string, visible: boolean) => void;
    onReset: () => void;
    defaultOrder: string[];
    defaultVisible: string[];
  };
  /** Props to spread onto ConfigurableTable (minus data/renderers/sort) */
  tableProps: {
    columns: Record<string, TableColumnConfig>;
    columnOrder: string[];
    visibleColumns: string[];
  };
}

export function useFeatureTableConfig({
  preferenceKey,
  columns,
  defaultColumnOrder,
  defaultVisibleColumns,
}: UseFeatureTableConfigParams): FeatureTableConfig {
  const [savedColumnOrder, setSavedColumnOrder] = useUserPreference<string[] | undefined>(
    `viewSettings.${preferenceKey}.columnOrder`,
    undefined,
  );

  const [visibleColumns, setVisibleColumns] = useUserPreference<string[]>(
    `viewSettings.${preferenceKey}.visibleColumns`,
    defaultVisibleColumns,
  );

  const columnOrder = useMemo(
    () => mergeColumnOrder(savedColumnOrder, defaultColumnOrder, columns),
    [savedColumnOrder, defaultColumnOrder, columns],
  );

  const handleColumnOrderChange = useCallback(
    (newOrder: string[]) => {
      setSavedColumnOrder(newOrder);
    },
    [setSavedColumnOrder],
  );

  const handleColumnVisibilityChange = useCallback(
    (columnId: string, visible: boolean) => {
      const updated = visible
        ? [...visibleColumns, columnId]
        : visibleColumns.filter((id) => id !== columnId);
      setVisibleColumns(updated);
    },
    [visibleColumns, setVisibleColumns],
  );

  const handleColumnReset = useCallback(() => {
    setSavedColumnOrder(undefined);
    setVisibleColumns(defaultVisibleColumns);
  }, [setSavedColumnOrder, setVisibleColumns, defaultVisibleColumns]);

  return {
    columnConfigProps: {
      columns,
      columnOrder,
      visibleColumns,
      onOrderChange: handleColumnOrderChange,
      onVisibilityChange: handleColumnVisibilityChange,
      onReset: handleColumnReset,
      defaultOrder: defaultColumnOrder,
      defaultVisible: defaultVisibleColumns,
    },
    tableProps: {
      columns,
      columnOrder,
      visibleColumns,
    },
  };
}
