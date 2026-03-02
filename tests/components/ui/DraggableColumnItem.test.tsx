import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DraggableColumnItem } from '../../../components/ui/DraggableColumnItem';
import type { TableColumnConfig } from '../../../types';

const sortableState = vi.hoisted(() => ({
  isDragging: false,
}));

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: { 'data-sortable': 'true' },
    listeners: { onPointerDown: vi.fn() },
    setNodeRef: vi.fn(),
    transform: { x: 10, y: 5, scaleX: 1, scaleY: 1 },
    transition: 'transform 150ms ease',
    isDragging: sortableState.isDragging,
  }),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: () => 'translate(10px, 5px)',
    },
  },
}));

vi.mock('lucide-react', () => ({
  GripVertical: () => <span data-testid="drag-icon" />,
  Check: () => <span data-testid="check-icon" />,
}));

const baseColumn: TableColumnConfig = {
  id: 'balance',
  label: 'Balance',
};

describe('DraggableColumnItem', () => {
  afterEach(() => {
    sortableState.isDragging = false;
  });

  it('renders label and shows check when visible', () => {
    render(
      <DraggableColumnItem
        column={baseColumn}
        isVisible={true}
        onToggle={vi.fn()}
      />
    );

    expect(screen.getByText('Balance')).toBeInTheDocument();
    expect(screen.getByTestId('check-icon')).toBeInTheDocument();
    expect(screen.getByLabelText('Drag to reorder')).toBeInTheDocument();
  });

  it('toggles visibility when checkbox clicked', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    render(
      <DraggableColumnItem
        column={baseColumn}
        isVisible={false}
        onToggle={onToggle}
      />
    );

    await user.click(screen.getByLabelText('Show column'));
    expect(onToggle).toHaveBeenCalledWith('balance', true);
  });

  it('does not toggle required columns', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    render(
      <DraggableColumnItem
        column={{ ...baseColumn, required: true }}
        isVisible={true}
        onToggle={onToggle}
      />
    );

    const checkbox = screen.getByLabelText('Required column (always visible)');
    expect(checkbox).toBeDisabled();

    await user.click(checkbox);
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.getByText('(required)')).toBeInTheDocument();
  });

  it('applies dragging style when sortable state indicates dragging', () => {
    sortableState.isDragging = true;

    const { container } = render(
      <DraggableColumnItem
        column={baseColumn}
        isVisible={true}
        onToggle={vi.fn()}
      />
    );

    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('bg-primary-100');
  });
});
