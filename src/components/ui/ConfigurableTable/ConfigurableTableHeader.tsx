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
  const isSortable = Boolean(column.sortable && column.sortKey);
  const canSort = Boolean(isSortable && onSort);
  const content = (
    <>
      {column.label}
      <SortIcon column={column} sortBy={sortBy} sortOrder={sortOrder} />
    </>
  );

  return (
    <th
      scope="col"
      aria-sort={getAriaSort(column, sortBy, sortOrder)}
      className={getHeaderClassName(column, canSort)}
    >
      {canSort ? (
        <button
          type="button"
          onClick={() => onSort!(column.sortKey!)}
          className={getHeaderButtonClassName(column)}
        >
          {content}
        </button>
      ) : (
        <span className={getHeaderContentClassName(column)}>{content}</span>
      )}
    </th>
  );
}

function getAriaSort(
  column: TableColumnConfig,
  sortBy?: string,
  sortOrder?: 'asc' | 'desc'
): 'ascending' | 'descending' | 'none' | undefined {
  if (!column.sortable || !column.sortKey) {
    return undefined;
  }

  if (sortBy !== column.sortKey) {
    return 'none';
  }

  return sortOrder === 'asc' ? 'ascending' : 'descending';
}

function getHeaderClassName(column: TableColumnConfig, canSort: boolean): string {
  const sortableClasses = canSort
    ? 'cursor-pointer hover:text-sanctuary-700 dark:hover:text-sanctuary-300 select-none transition-colors'
    : '';

  return `
    px-6 py-3.5 text-xs font-semibold text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider
    ${getAlignmentClass(column.align)}
    ${sortableClasses}
  `;
}

function getHeaderButtonClassName(column: TableColumnConfig): string {
  return `
    group inline-flex w-full items-center gap-1 rounded-sm bg-transparent p-0 text-xs font-semibold uppercase tracking-wider text-inherit
    ${getHeaderJustifyClass(column)}
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
    focus-visible:ring-offset-white dark:focus-visible:ring-offset-sanctuary-900
  `;
}

function getHeaderContentClassName(column: TableColumnConfig): string {
  return `inline-flex items-center gap-1 ${getHeaderJustifyClass(column)}`;
}

function getHeaderJustifyClass(column: TableColumnConfig): string {
  if (column.align === 'right') {
    return 'justify-end';
  }

  if (column.align === 'center') {
    return 'justify-center';
  }

  return 'justify-start';
}
