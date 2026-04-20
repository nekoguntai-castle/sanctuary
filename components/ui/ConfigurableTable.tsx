/**
 * Configurable Table
 *
 * A generic table component that renders columns based on configuration.
 * Supports:
 * - Dynamic column ordering and visibility
 * - Sortable column headers
 * - Custom cell renderers
 */

import { ConfigurableTableBody } from './ConfigurableTable/ConfigurableTableBody';
import { ConfigurableTableHeader } from './ConfigurableTable/ConfigurableTableHeader';
import { EmptyTableState } from './ConfigurableTable/EmptyTableState';
import { TableShell } from './ConfigurableTable/TableShell';
import { getOrderedColumns } from './ConfigurableTable/tableColumns';
import type { CellRenderers } from './ConfigurableTable/types';
import type { TableColumnConfig } from '../../types';

export type { CellRendererProps } from './ConfigurableTable/types';

interface ConfigurableTableProps<T> {
  columns: Record<string, TableColumnConfig>;
  columnOrder: string[];
  visibleColumns: string[];
  data: T[];
  keyExtractor: (item: T) => string;
  cellRenderers: CellRenderers<T>;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  onSort?: (field: string) => void;
  onRowClick?: (item: T) => void;
  emptyMessage?: string;
}

export function ConfigurableTable<T>({
  columns,
  columnOrder,
  visibleColumns,
  data,
  keyExtractor,
  cellRenderers,
  sortBy,
  sortOrder,
  onSort,
  onRowClick,
  emptyMessage = 'No data available',
}: ConfigurableTableProps<T>) {
  const orderedColumns = getOrderedColumns(columns, columnOrder, visibleColumns);

  if (data.length === 0) {
    return <EmptyTableState message={emptyMessage} />;
  }

  return (
    <TableShell>
      <ConfigurableTableHeader
        columns={orderedColumns}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSort={onSort}
      />
      <ConfigurableTableBody
        columns={orderedColumns}
        data={data}
        keyExtractor={keyExtractor}
        cellRenderers={cellRenderers}
        onRowClick={onRowClick}
      />
    </TableShell>
  );
}
