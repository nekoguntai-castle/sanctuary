import { getAlignmentClass } from './tableColumns';
import type { CellRenderers } from './types';
import type { TableColumnConfig } from '../../../types';
import type { KeyboardEvent } from 'react';

interface ConfigurableTableBodyProps<T> {
  columns: TableColumnConfig[];
  data: T[];
  keyExtractor: (item: T) => string;
  cellRenderers: CellRenderers<T>;
  onRowClick?: (item: T) => void;
}

export function ConfigurableTableBody<T>({
  columns,
  data,
  keyExtractor,
  cellRenderers,
  onRowClick,
}: ConfigurableTableBodyProps<T>) {
  return (
    <tbody className="surface-elevated divide-y divide-sanctuary-200 dark:divide-sanctuary-800">
      {data.map((item) => (
        <ConfigurableTableRow
          key={keyExtractor(item)}
          item={item}
          columns={columns}
          cellRenderers={cellRenderers}
          onRowClick={onRowClick}
        />
      ))}
    </tbody>
  );
}

interface ConfigurableTableRowProps<T> {
  item: T;
  columns: TableColumnConfig[];
  cellRenderers: CellRenderers<T>;
  onRowClick?: (item: T) => void;
}

function ConfigurableTableRow<T>({
  item,
  columns,
  cellRenderers,
  onRowClick,
}: ConfigurableTableRowProps<T>) {
  const isClickable = Boolean(onRowClick);

  return (
    <tr
      onClick={() => onRowClick?.(item)}
      onKeyDown={(event) => handleRowKeyDown(event, item, onRowClick)}
      tabIndex={isClickable ? 0 : undefined}
      className={`
        hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 transition-colors
        ${isClickable ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500' : ''}
      `}
    >
      {columns.map((column) => (
        <ConfigurableTableCell
          key={column.id}
          column={column}
          item={item}
          cellRenderers={cellRenderers}
        />
      ))}
    </tr>
  );
}

function handleRowKeyDown<T>(
  event: KeyboardEvent<HTMLTableRowElement>,
  item: T,
  onRowClick?: (item: T) => void
) {
  if (!onRowClick || event.currentTarget !== event.target) {
    return;
  }

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    onRowClick(item);
  }
}

interface ConfigurableTableCellProps<T> {
  column: TableColumnConfig;
  item: T;
  cellRenderers: CellRenderers<T>;
}

function ConfigurableTableCell<T>({
  column,
  item,
  cellRenderers,
}: ConfigurableTableCellProps<T>) {
  const CellRenderer = cellRenderers[column.id];

  if (!CellRenderer) {
    return <td />;
  }

  return (
    <td className={`px-6 py-4 whitespace-nowrap ${getAlignmentClass(column.align)}`}>
      <CellRenderer item={item} column={column} />
    </td>
  );
}
