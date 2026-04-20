import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ColumnConfigItems } from './ColumnConfigItems';
import { ColumnConfigResetButton } from './ColumnConfigResetButton';
import { useColumnConfigDrag } from './useColumnConfigDrag';
import type { ColumnConfigDropdownProps } from './types';

export function ColumnConfigDropdown({
  columns,
  columnOrder,
  visibleColumns,
  onOrderChange,
  onVisibilityChange,
  onReset,
  isDefault,
}: ColumnConfigDropdownProps) {
  const { sensors, handleDragEnd } = useColumnConfigDrag(columnOrder, onOrderChange);

  return (
    <div className="absolute right-0 mt-2 w-56 surface-elevated rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 shadow-lg z-50">
      <div className="p-2">
        <div className="text-xs font-medium text-sanctuary-500 uppercase tracking-wider px-2 py-1 mb-1">
          Columns
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={columnOrder}
            strategy={verticalListSortingStrategy}
          >
            <ColumnConfigItems
              columns={columns}
              columnOrder={columnOrder}
              visibleColumns={visibleColumns}
              onVisibilityChange={onVisibilityChange}
            />
          </SortableContext>
        </DndContext>

        <ColumnConfigResetButton
          isDefault={isDefault}
          onReset={onReset}
        />
      </div>
    </div>
  );
}
