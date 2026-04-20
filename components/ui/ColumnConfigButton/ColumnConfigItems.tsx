import { DraggableColumnItem } from '../DraggableColumnItem';
import type { TableColumnConfig } from '../../../types';

interface ColumnConfigItemsProps {
  columns: Record<string, TableColumnConfig>;
  columnOrder: string[];
  visibleColumns: string[];
  onVisibilityChange: (columnId: string, visible: boolean) => void;
}

export function ColumnConfigItems({
  columns,
  columnOrder,
  visibleColumns,
  onVisibilityChange,
}: ColumnConfigItemsProps) {
  return (
    <div className="space-y-0.5">
      {columnOrder.map((columnId) => {
        const column = columns[columnId];

        if (!column) {
          return null;
        }

        return (
          <DraggableColumnItem
            key={columnId}
            column={column}
            isVisible={visibleColumns.includes(columnId)}
            onToggle={onVisibilityChange}
          />
        );
      })}
    </div>
  );
}
