interface ColumnConfigState {
  columnOrder: string[];
  visibleColumns: string[];
  defaultOrder: string[];
  defaultVisible: string[];
}

export function isDefaultColumnConfig({
  columnOrder,
  visibleColumns,
  defaultOrder,
  defaultVisible,
}: ColumnConfigState): boolean {
  return (
    JSON.stringify(columnOrder) === JSON.stringify(defaultOrder) &&
    JSON.stringify([...visibleColumns].sort()) === JSON.stringify([...defaultVisible].sort())
  );
}
