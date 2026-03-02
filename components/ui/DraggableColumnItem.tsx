/**
 * Draggable Column Item
 *
 * A sortable list item for column configuration.
 * Shows drag handle, visibility checkbox, and column label.
 */

import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Check } from 'lucide-react';
import type { TableColumnConfig } from '../../types';

interface DraggableColumnItemProps {
  column: TableColumnConfig;
  isVisible: boolean;
  onToggle: (id: string, visible: boolean) => void;
}

export const DraggableColumnItem: React.FC<DraggableColumnItemProps> = ({
  column,
  isVisible,
  onToggle,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle(column.id, !isVisible);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        flex items-center gap-2 px-2 py-1.5 rounded-lg
        ${isDragging ? 'bg-primary-100 dark:bg-primary-900/30 shadow-md z-50' : 'hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800'}
        ${column.required ? 'opacity-75' : ''}
        transition-colors
      `}
    >
      {/* Drag Handle */}
      <button
        {...attributes}
        {...listeners}
        className="p-0.5 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 cursor-grab active:cursor-grabbing touch-none"
        aria-label="Drag to reorder"
      >
        <GripVertical className="w-4 h-4" />
      </button>

      {/* Visibility Checkbox */}
      <button
        onClick={handleCheckboxClick}
        disabled={column.required}
        className={`
          w-4 h-4 rounded flex items-center justify-center flex-shrink-0
          border transition-colors
          ${column.required
            ? 'bg-sanctuary-200 dark:bg-sanctuary-700 border-sanctuary-300 dark:border-sanctuary-600 cursor-not-allowed'
            : isVisible
              ? 'bg-primary-500 border-primary-500 text-white'
              : 'bg-white dark:bg-sanctuary-800 border-sanctuary-300 dark:border-sanctuary-600 hover:border-primary-400'
          }
        `}
        aria-label={column.required ? 'Required column (always visible)' : isVisible ? 'Hide column' : 'Show column'}
      >
        {(isVisible || column.required) && <Check className="w-3 h-3" />}
      </button>

      {/* Column Label */}
      <span className="text-sm text-sanctuary-700 dark:text-sanctuary-300 select-none">
        {column.label}
        {column.required && (
          <span className="ml-1 text-[10px] text-sanctuary-400">(required)</span>
        )}
      </span>
    </div>
  );
};
