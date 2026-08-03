import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useCallback } from 'react';

export function useColumnConfigDrag(
  columnOrder: string[],
  onOrderChange: (newOrder: string[]) => void,
) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const newOrder = getReorderedColumns(columnOrder, event);

      if (newOrder) {
        onOrderChange(newOrder);
      }
    },
    [columnOrder, onOrderChange],
  );

  return { sensors, handleDragEnd };
}

function getReorderedColumns(columnOrder: string[], event: DragEndEvent): string[] | null {
  const { active, over } = event;

  if (!over || active.id === over.id) {
    return null;
  }

  const oldIndex = columnOrder.indexOf(active.id as string);
  const newIndex = columnOrder.indexOf(over.id as string);

  return arrayMove(columnOrder, oldIndex, newIndex);
}
