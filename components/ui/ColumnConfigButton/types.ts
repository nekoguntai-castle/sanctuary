import type { TableColumnConfig } from '../../../types';

export interface ColumnConfigButtonProps {
  columns: Record<string, TableColumnConfig>;
  columnOrder: string[];
  visibleColumns: string[];
  onOrderChange: (newOrder: string[]) => void;
  onVisibilityChange: (columnId: string, visible: boolean) => void;
  onReset: () => void;
  defaultOrder: string[];
  defaultVisible: string[];
}

export interface ColumnConfigDropdownProps {
  columns: Record<string, TableColumnConfig>;
  columnOrder: string[];
  visibleColumns: string[];
  onOrderChange: (newOrder: string[]) => void;
  onVisibilityChange: (columnId: string, visible: boolean) => void;
  onReset: () => void;
  isDefault: boolean;
}
