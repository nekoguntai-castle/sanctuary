import type { TableColumnConfig } from '../../../types';

export function getOrderedColumns(
  columns: Record<string, TableColumnConfig>,
  columnOrder: string[],
  visibleColumns: string[],
): TableColumnConfig[] {
  const visibleSet = new Set(visibleColumns);

  return columnOrder
    .filter((id) => visibleSet.has(id) && columns[id])
    .map((id) => columns[id]);
}

export function getAlignmentClass(align?: 'left' | 'center' | 'right'): string {
  switch (align) {
    case 'center':
      return 'text-center';
    case 'right':
      return 'text-right';
    default:
      return 'text-left';
  }
}
