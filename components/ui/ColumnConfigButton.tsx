/**
 * Column Config Button
 *
 * A dropdown button that allows users to:
 * - Toggle column visibility
 * - Drag and drop to reorder columns
 * - Reset to default configuration
 */

import React, { useCallback, useRef, useState } from 'react';
import { ColumnConfigDropdown } from './ColumnConfigButton/ColumnConfigDropdown';
import { ColumnConfigTrigger } from './ColumnConfigButton/ColumnConfigTrigger';
import { isDefaultColumnConfig } from './ColumnConfigButton/columnConfigState';
import { useColumnConfigDismissal } from './ColumnConfigButton/useColumnConfigDismissal';
import type { ColumnConfigButtonProps } from './ColumnConfigButton/types';

export const ColumnConfigButton: React.FC<ColumnConfigButtonProps> = ({
  columns,
  columnOrder,
  visibleColumns,
  onOrderChange,
  onVisibilityChange,
  onReset,
  defaultOrder,
  defaultVisible,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const closeDropdown = useCallback(() => setIsOpen(false), []);

  useColumnConfigDismissal(isOpen, containerRef, closeDropdown);

  const isDefault = isDefaultColumnConfig({
    columnOrder,
    visibleColumns,
    defaultOrder,
    defaultVisible,
  });

  return (
    <div ref={containerRef} className="relative">
      <ColumnConfigTrigger
        isOpen={isOpen}
        onToggle={() => setIsOpen((current) => !current)}
      />

      {isOpen && (
        <ColumnConfigDropdown
          columns={columns}
          columnOrder={columnOrder}
          visibleColumns={visibleColumns}
          onOrderChange={onOrderChange}
          onVisibilityChange={onVisibilityChange}
          onReset={onReset}
          isDefault={isDefault}
        />
      )}
    </div>
  );
};
