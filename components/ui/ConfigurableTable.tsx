/**
 * Configurable Table
 *
 * A generic table component that renders columns based on configuration.
 * Supports:
 * - Dynamic column ordering and visibility
 * - Sortable column headers
 * - Custom cell renderers
 */

import React from 'react';
import { ChevronUp, ChevronDown, ArrowUpDown } from 'lucide-react';
import type { TableColumnConfig } from '../../types';

export interface CellRendererProps<T> {
  item: T;
  column: TableColumnConfig;
}

interface ConfigurableTableProps<T> {
  columns: Record<string, TableColumnConfig>;
  columnOrder: string[];
  visibleColumns: string[];
  data: T[];
  keyExtractor: (item: T) => string;
  cellRenderers: Record<string, React.FC<CellRendererProps<T>>>;
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
  // Get columns to render in order
  const visibleSet = new Set(visibleColumns);
  const orderedColumns = columnOrder
    .filter((id) => visibleSet.has(id) && columns[id])
    .map((id) => columns[id]);

  const handleHeaderClick = (column: TableColumnConfig) => {
    if (column.sortable && column.sortKey && onSort) {
      onSort(column.sortKey);
    }
  };

  const getAlignmentClass = (align?: 'left' | 'center' | 'right') => {
    switch (align) {
      case 'center':
        return 'text-center';
      case 'right':
        return 'text-right';
      default:
        return 'text-left';
    }
  };

  if (data.length === 0) {
    return (
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 p-8 text-center text-sanctuary-400">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-sanctuary-200 dark:divide-sanctuary-800">
          <thead className="surface-muted sticky top-0 z-10">
            <tr className="border-b-2 border-sanctuary-200 dark:border-sanctuary-700">
              {orderedColumns.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  onClick={() => handleHeaderClick(column)}
                  className={`
                    px-6 py-3.5 text-xs font-semibold text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider
                    ${getAlignmentClass(column.align)}
                    ${column.sortable ? 'cursor-pointer hover:text-sanctuary-700 dark:hover:text-sanctuary-300 select-none transition-colors' : ''}
                  `}
                >
                  <span className={`inline-flex items-center gap-1 ${column.align === 'right' ? 'justify-end' : ''}`}>
                    {column.label}
                    {column.sortable && column.sortKey && (
                      sortBy === column.sortKey ? (
                        sortOrder === 'asc' ? (
                          <ChevronUp className="w-3.5 h-3.5 text-primary-500 transition-transform" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5 text-primary-500 transition-transform" />
                        )
                      ) : (
                        <ArrowUpDown className="w-3 h-3 opacity-30 group-hover:opacity-50 transition-opacity" />
                      )
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="surface-elevated divide-y divide-sanctuary-200 dark:divide-sanctuary-800">
            {data.map((item) => (
              <tr
                key={keyExtractor(item)}
                onClick={() => onRowClick?.(item)}
                className={`
                  hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 transition-colors
                  ${onRowClick ? 'cursor-pointer' : ''}
                `}
              >
                {orderedColumns.map((column) => {
                  const CellRenderer = cellRenderers[column.id];
                  if (!CellRenderer) return <td key={column.id} />;

                  return (
                    <td
                      key={column.id}
                      className={`px-6 py-4 whitespace-nowrap ${getAlignmentClass(column.align)}`}
                    >
                      <CellRenderer item={item} column={column} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
