import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ColumnConfigButton } from '../../../components/ui/ColumnConfigButton';

vi.mock('lucide-react', () => ({
  Columns: () => <span data-testid="columns-icon" />,
  RotateCcw: () => <span data-testid="reset-icon" />,
}));

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children, onDragEnd }: any) => (
    <div data-testid="dnd-context">
      <button
        type="button"
        onClick={() =>
          onDragEnd({
            active: { id: 'name' },
            over: { id: 'balance' },
          })
        }
      >
        Trigger drag
      </button>
      <button
        type="button"
        onClick={() =>
          onDragEnd({
            active: { id: 'name' },
            over: { id: 'name' },
          })
        }
      >
        Trigger drag same
      </button>
      <button
        type="button"
        onClick={() =>
          onDragEnd({
            active: { id: 'name' },
            over: null,
          })
        }
      >
        Trigger drag missing
      </button>
      {children}
    </div>
  ),
  closestCenter: vi.fn(),
  KeyboardSensor: class {},
  PointerSensor: class {},
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
}));

vi.mock('@dnd-kit/sortable', () => ({
  arrayMove: (items: string[], oldIndex: number, newIndex: number) => {
    const copy = [...items];
    const [moved] = copy.splice(oldIndex, 1);
    copy.splice(newIndex, 0, moved);
    return copy;
  },
  SortableContext: ({ children }: any) => <div data-testid="sortable-context">{children}</div>,
  sortableKeyboardCoordinates: vi.fn(),
  verticalListSortingStrategy: {},
}));

vi.mock('../../../components/ui/DraggableColumnItem', () => ({
  DraggableColumnItem: ({ column, isVisible, onToggle }: any) => (
    <button type="button" onClick={() => onToggle(column.id, !isVisible)}>
      {column.label}:{isVisible ? 'on' : 'off'}
    </button>
  ),
}));

function renderColumnConfigButton(overrideProps: Partial<React.ComponentProps<typeof ColumnConfigButton>> = {}) {
  const onOrderChange = vi.fn();
  const onVisibilityChange = vi.fn();
  const onReset = vi.fn();

  const props: React.ComponentProps<typeof ColumnConfigButton> = {
    columns: {
      name: { id: 'name', label: 'Name' } as any,
      balance: { id: 'balance', label: 'Balance' } as any,
    },
    columnOrder: ['name', 'balance'],
    visibleColumns: ['name', 'balance'],
    onOrderChange,
    onVisibilityChange,
    onReset,
    defaultOrder: ['name', 'balance'],
    defaultVisible: ['name', 'balance'],
    ...overrideProps,
  };

  render(<ColumnConfigButton {...props} />);
  return { onOrderChange, onVisibilityChange, onReset };
}

describe('ColumnConfigButton', () => {
  it('opens and closes dropdown from trigger button', async () => {
    const user = userEvent.setup();
    renderColumnConfigButton();

    const trigger = screen.getByRole('button', { name: /configure columns/i });
    await user.click(trigger);
    expect(screen.getByText('Columns')).toBeInTheDocument();

    await user.click(trigger);
    expect(screen.queryByText('Columns')).not.toBeInTheDocument();
  });

  it('closes dropdown when clicking outside or pressing Escape', async () => {
    const user = userEvent.setup();
    renderColumnConfigButton();
    const trigger = screen.getByRole('button', { name: /configure columns/i });

    await user.click(trigger);
    expect(screen.getByText('Columns')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('Columns')).not.toBeInTheDocument();

    await user.click(trigger);
    expect(screen.getByText('Columns')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Columns')).not.toBeInTheDocument();
  });

  it('calls visibility callback from item toggle', async () => {
    const user = userEvent.setup();
    const { onVisibilityChange } = renderColumnConfigButton();

    await user.click(screen.getByRole('button', { name: /configure columns/i }));
    await user.click(screen.getByRole('button', { name: 'Name:on' }));

    expect(onVisibilityChange).toHaveBeenCalledWith('name', false);
  });

  it('calls reorder callback on drag end', async () => {
    const user = userEvent.setup();
    const { onOrderChange } = renderColumnConfigButton();

    await user.click(screen.getByRole('button', { name: /configure columns/i }));
    await user.click(screen.getByRole('button', { name: /^trigger drag$/i }));

    expect(onOrderChange).toHaveBeenCalledWith(['balance', 'name']);
  });

  it('does not reorder when drag target is missing or unchanged', async () => {
    const user = userEvent.setup();
    const { onOrderChange } = renderColumnConfigButton();

    await user.click(screen.getByRole('button', { name: /configure columns/i }));
    await user.click(screen.getByRole('button', { name: /trigger drag same/i }));
    await user.click(screen.getByRole('button', { name: /trigger drag missing/i }));

    expect(onOrderChange).not.toHaveBeenCalled();
  });

  it('disables reset when configuration matches defaults', async () => {
    const user = userEvent.setup();
    renderColumnConfigButton();

    await user.click(screen.getByRole('button', { name: /configure columns/i }));
    expect(screen.getByRole('button', { name: /reset to default/i })).toBeDisabled();
  });

  it('enables reset and calls callback when configuration is customized', async () => {
    const user = userEvent.setup();
    const { onReset } = renderColumnConfigButton({
      columnOrder: ['balance', 'name'],
      visibleColumns: ['name'],
    });

    await user.click(screen.getByRole('button', { name: /configure columns/i }));
    const reset = screen.getByRole('button', { name: /reset to default/i });
    expect(reset).not.toBeDisabled();

    await user.click(reset);
    expect(onReset).toHaveBeenCalled();
  });

  it('skips unknown column ids and ignores non-escape keys for close handler', async () => {
    const user = userEvent.setup();
    renderColumnConfigButton({
      columnOrder: ['name', 'missing-column', 'balance'],
    });

    await user.click(screen.getByRole('button', { name: /configure columns/i }));
    expect(screen.queryByRole('button', { name: /missing-column/i })).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Enter' });
    expect(screen.getByText('Columns')).toBeInTheDocument();
  });
});
