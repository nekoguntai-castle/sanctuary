import { SortIcon } from './SortIcon';
import { getAlignmentClass } from './tableColumns';
import type { TableColumnConfig } from '../../../types';

interface ConfigurableTableHeaderProps {
  columns: TableColumnConfig[];
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  onSort?: (field: string) => void;
}

export function ConfigurableTableHeader({
  columns,
  sortBy,
  sortOrder,
  onSort,
}: ConfigurableTableHeaderProps) {
  return (
    <thead className="surface-muted sticky top-0 z-10">
      <tr className="border-b-2 border-sanctuary-200 dark:border-sanctuary-700">
        {columns.map((column) => (
          <ColumnHeader
            key={column.id}
            column={column}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSort={onSort}
          />
        ))}
      </tr>
    </thead>
  );
}

interface ColumnHeaderProps {
  column: TableColumnConfig;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  onSort?: (field: string) => void;
}

function ColumnHeader({ column, sortBy, sortOrder, onSort }: ColumnHeaderProps) {
  return (
    <th
      scope="col"
      onClick={() => handleHeaderClick(column, onSort)}
      className={getHeaderClassName(column)}
    >
      <span className={`inline-flex items-center gap-1 ${column.align === 'right' ? 'justify-end' : ''}`}>
        {column.label}
        <SortIcon column={column} sortBy={sortBy} sortOrder={sortOrder} />
      </span>
    </th>
  );
}

function handleHeaderClick(column: TableColumnConfig, onSort?: (field: string) => void) {
  if (column.sortable && column.sortKey && onSort) {
    onSort(column.sortKey);
  }
}

function getHeaderClassName(column: TableColumnConfig): string {
  const sortableClasses = column.sortable
    ? 'cursor-pointer hover:text-sanctuary-700 dark:hover:text-sanctuary-300 select-none transition-colors'
    : '';

  return `
    px-6 py-3.5 text-xs font-semibold text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider
    ${getAlignmentClass(column.align)}
    ${sortableClasses}
  `;
}
