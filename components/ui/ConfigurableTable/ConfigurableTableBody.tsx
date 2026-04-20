import { getAlignmentClass } from './tableColumns';
import type { CellRenderers } from './types';
import type { TableColumnConfig } from '../../../types';

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
  return (
    <tr
      onClick={() => onRowClick?.(item)}
      className={`
        hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 transition-colors
        ${onRowClick ? 'cursor-pointer' : ''}
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
