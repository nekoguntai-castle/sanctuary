import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfigurableTable } from '../../../src/components/ui/ConfigurableTable';
import type { TableColumnConfig } from '../../../src/types';

vi.mock('lucide-react', () => ({
  ChevronUp: () => <span data-testid="chevron-up" />,
  ChevronDown: () => <span data-testid="chevron-down" />,
  ArrowUpDown: () => <span data-testid="arrow-up-down" />,
}));

interface Person {
  id: string;
  name: string;
  age: number;
}

const columns: Record<string, TableColumnConfig> = {
  name: { id: 'name', label: 'Name', sortable: true, sortKey: 'name', align: 'left' },
  age: { id: 'age', label: 'Age', align: 'right' },
  status: { id: 'status', label: 'Status', align: 'center' },
  hidden: { id: 'hidden', label: 'Hidden' },
};

const cellRenderers = {
  name: ({ item }: { item: Person }) => <span>{item.name}</span>,
  age: ({ item }: { item: Person }) => <span>{item.age}</span>,
  status: () => <span>ok</span>,
};

const data: Person[] = [
  { id: '1', name: 'Alice', age: 30 },
  { id: '2', name: 'Bob', age: 25 },
];

describe('ConfigurableTable', () => {
  it('renders empty message when there is no data', () => {
    render(
      <ConfigurableTable
        columns={columns}
        columnOrder={['name']}
        visibleColumns={['name']}
        data={[]}
        keyExtractor={(item) => item.id}
        cellRenderers={cellRenderers}
        emptyMessage="No rows"
      />
    );

    expect(screen.getByText('No rows')).toBeInTheDocument();
  });

  it('renders columns based on order and visibility', () => {
    render(
      <ConfigurableTable
        columns={columns}
        columnOrder={['age', 'name', 'hidden']}
        visibleColumns={['name', 'age']}
        data={data}
        keyExtractor={(item) => item.id}
        cellRenderers={cellRenderers}
      />
    );

    const headers = screen.getAllByRole('columnheader');
    expect(headers.map((header) => header.textContent)).toEqual(['Age', 'Name']);

    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(1 + data.length);
  });

  it('calls onSort when sortable header clicked', async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();

    render(
      <ConfigurableTable
        columns={columns}
        columnOrder={['name']}
        visibleColumns={['name']}
        data={data}
        keyExtractor={(item) => item.id}
        cellRenderers={cellRenderers}
        onSort={onSort}
        sortBy="name"
        sortOrder="asc"
      />
    );

    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'ascending');

    await user.click(screen.getByRole('button', { name: 'Name' }));
    expect(onSort).toHaveBeenCalledWith('name');
    expect(screen.getByTestId('chevron-up')).toBeInTheDocument();
  });

  it('supports keyboard sorting for sortable headers', async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();

    render(
      <ConfigurableTable
        columns={columns}
        columnOrder={['name']}
        visibleColumns={['name']}
        data={data}
        keyExtractor={(item) => item.id}
        cellRenderers={cellRenderers}
        onSort={onSort}
        sortBy="age"
        sortOrder="asc"
      />
    );

    const header = screen.getByRole('columnheader', { name: 'Name' });
    const sortButton = screen.getByRole('button', { name: 'Name' });

    expect(header).toHaveAttribute('aria-sort', 'none');

    sortButton.focus();
    expect(sortButton).toHaveFocus();

    await user.keyboard('{Enter}');
    await user.keyboard(' ');

    expect(onSort).toHaveBeenNthCalledWith(1, 'name');
    expect(onSort).toHaveBeenNthCalledWith(2, 'name');
  });

  it('renders descending sort indicator for active sortable column', () => {
    render(
      <ConfigurableTable
        columns={columns}
        columnOrder={['name']}
        visibleColumns={['name']}
        data={data}
        keyExtractor={(item) => item.id}
        cellRenderers={cellRenderers}
        sortBy="name"
        sortOrder="desc"
      />
    );

    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByTestId('chevron-down')).toBeInTheDocument();
  });

  it('does not call onSort for non-sortable columns', async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();

    render(
      <ConfigurableTable
        columns={columns}
        columnOrder={['age']}
        visibleColumns={['age']}
        data={data}
        keyExtractor={(item) => item.id}
        cellRenderers={cellRenderers}
        onSort={onSort}
      />
    );

    await user.click(screen.getByText('Age'));
    expect(screen.getByRole('columnheader', { name: 'Age' })).not.toHaveAttribute('aria-sort');
    expect(screen.queryByRole('button', { name: 'Age' })).not.toBeInTheDocument();
    expect(onSort).not.toHaveBeenCalled();
  });

  it('invokes onRowClick when row is clicked', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();

    render(
      <ConfigurableTable
        columns={columns}
        columnOrder={['name']}
        visibleColumns={['name']}
        data={data}
        keyExtractor={(item) => item.id}
        cellRenderers={cellRenderers}
        onRowClick={onRowClick}
      />
    );

    await user.click(screen.getByText('Alice'));
    expect(onRowClick).toHaveBeenCalledWith(data[0]);
  });

  it('invokes onRowClick from keyboard activation on focusable rows', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();

    render(
      <ConfigurableTable
        columns={columns}
        columnOrder={['name']}
        visibleColumns={['name']}
        data={data}
        keyExtractor={(item) => item.id}
        cellRenderers={cellRenderers}
        onRowClick={onRowClick}
      />
    );

    const firstRow = screen.getByText('Alice').closest('tr') as HTMLTableRowElement;

    expect(firstRow).toHaveAttribute('tabindex', '0');

    firstRow.focus();
    expect(firstRow).toHaveFocus();

    await user.keyboard('{Enter}');
    await user.keyboard(' ');

    expect(onRowClick).toHaveBeenNthCalledWith(1, data[0]);
    expect(onRowClick).toHaveBeenNthCalledWith(2, data[0]);
  });

  it('leaves rows inert when no row click handler is provided', () => {
    render(
      <ConfigurableTable
        columns={columns}
        columnOrder={['name']}
        visibleColumns={['name']}
        data={data}
        keyExtractor={(item) => item.id}
        cellRenderers={cellRenderers}
      />
    );

    const firstRow = screen.getByText('Alice').closest('tr') as HTMLTableRowElement;

    fireEvent.keyDown(firstRow, { key: 'Enter' });
    expect(firstRow).not.toHaveAttribute('tabindex');
  });

  it('ignores row key events from nested targets and unrelated keys', () => {
    const onRowClick = vi.fn();

    render(
      <ConfigurableTable
        columns={columns}
        columnOrder={['name']}
        visibleColumns={['name']}
        data={data}
        keyExtractor={(item) => item.id}
        cellRenderers={cellRenderers}
        onRowClick={onRowClick}
      />
    );

    const firstCellText = screen.getByText('Alice');
    const firstRow = firstCellText.closest('tr') as HTMLTableRowElement;

    fireEvent.keyDown(firstCellText, { key: 'Enter' });
    fireEvent.keyDown(firstRow, { key: 'Escape' });

    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('renders centered alignment classes and empty cells when renderer is missing', () => {
    render(
      <ConfigurableTable
        columns={columns}
        columnOrder={['status', 'hidden']}
        visibleColumns={['status', 'hidden']}
        data={[data[0]]}
        keyExtractor={(item) => item.id}
        cellRenderers={{ status: cellRenderers.status }}
      />
    );

    const headers = screen.getAllByRole('columnheader');
    expect(headers[0].className).toContain('text-center');
    expect(headers[1].className).toContain('text-left');

    const cells = screen.getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('ok');
    expect(cells[1]).toBeEmptyDOMElement();
  });
});
