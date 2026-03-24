import { render, screen } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { FeatureTable, useFeatureTableConfig } from '../../../components/ui/FeatureTable';
import type { TableColumnConfig } from '../../../types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPreferences = new Map<string, unknown>();

vi.mock('../../../hooks/useUserPreference', () => ({
  useUserPreference: vi.fn((key: string, defaultValue: unknown) => {
    const value = mockPreferences.has(key) ? mockPreferences.get(key) : defaultValue;
    const setter = vi.fn((newVal: unknown) => mockPreferences.set(key, newVal));
    return [value, setter];
  }),
}));

vi.mock('../../../components/ui/ConfigurableTable', () => ({
  ConfigurableTable: vi.fn((props: Record<string, unknown>) => (
    <div data-testid="configurable-table">
      {JSON.stringify({
        columnOrder: props.columnOrder,
        visibleColumns: props.visibleColumns,
      })}
    </div>
  )),
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

interface Item {
  id: string;
  name: string;
}

const columns: Record<string, TableColumnConfig> = {
  name: { id: 'name', label: 'Name', sortable: true, sortKey: 'name' },
  age: { id: 'age', label: 'Age' },
  status: { id: 'status', label: 'Status' },
};

const defaultColumnOrder = ['name', 'age', 'status'];
const defaultVisibleColumns = ['name', 'age'];

const data: Item[] = [
  { id: '1', name: 'Alice' },
  { id: '2', name: 'Bob' },
];

const cellRenderers = {
  name: ({ item }: { item: Item }) => <span>{item.name}</span>,
  age: () => <span>-</span>,
  status: () => <span>ok</span>,
};

function renderFeatureTable(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    preferenceKey: 'test',
    columns,
    defaultColumnOrder,
    defaultVisibleColumns,
    data,
    keyExtractor: (item: Item) => item.id,
    cellRenderers,
  };

  return render(<FeatureTable<Item> {...defaultProps} {...overrides} />);
}

// ---------------------------------------------------------------------------
// FeatureTable component tests
// ---------------------------------------------------------------------------

describe('FeatureTable', () => {
  beforeEach(() => {
    mockPreferences.clear();
  });

  it('renders ConfigurableTable with default column order when no saved preferences', () => {
    renderFeatureTable();

    const tableEl = screen.getByTestId('configurable-table');
    const passedProps = JSON.parse(tableEl.textContent!);

    expect(passedProps.columnOrder).toEqual(['name', 'age', 'status']);
    expect(passedProps.visibleColumns).toEqual(['name', 'age']);
  });

  it('uses saved column order from preferences', () => {
    mockPreferences.set('viewSettings.test.columnOrder', ['status', 'name', 'age']);

    renderFeatureTable();

    const tableEl = screen.getByTestId('configurable-table');
    const passedProps = JSON.parse(tableEl.textContent!);

    expect(passedProps.columnOrder).toEqual(['status', 'name', 'age']);
  });

  it('merges saved column order with new columns added after save', () => {
    // Saved order only has 'name' and 'age'; 'status' was added later
    mockPreferences.set('viewSettings.test.columnOrder', ['name', 'age']);

    renderFeatureTable();

    const tableEl = screen.getByTestId('configurable-table');
    const passedProps = JSON.parse(tableEl.textContent!);

    // 'status' should be appended at the end
    expect(passedProps.columnOrder).toEqual(['name', 'age', 'status']);
  });

  it('filters out stale columns from saved order', () => {
    // 'removed_col' no longer exists in the columns definition
    mockPreferences.set('viewSettings.test.columnOrder', ['removed_col', 'name', 'age', 'status']);

    renderFeatureTable();

    const tableEl = screen.getByTestId('configurable-table');
    const passedProps = JSON.parse(tableEl.textContent!);

    expect(passedProps.columnOrder).toEqual(['name', 'age', 'status']);
    expect(passedProps.columnOrder).not.toContain('removed_col');
  });

  it('passes visibleColumns to ConfigurableTable', () => {
    const customVisible = ['name', 'status'];
    mockPreferences.set('viewSettings.test.visibleColumns', customVisible);

    renderFeatureTable();

    const tableEl = screen.getByTestId('configurable-table');
    const passedProps = JSON.parse(tableEl.textContent!);

    expect(passedProps.visibleColumns).toEqual(['name', 'status']);
  });
});

// ---------------------------------------------------------------------------
// useFeatureTableConfig hook tests
// ---------------------------------------------------------------------------

describe('useFeatureTableConfig', () => {
  const hookParams = {
    preferenceKey: 'hookTest',
    columns,
    defaultColumnOrder,
    defaultVisibleColumns,
  };

  beforeEach(() => {
    mockPreferences.clear();
  });

  it('returns columnConfigProps and tableProps', () => {
    const { result } = renderHook(() => useFeatureTableConfig(hookParams));

    expect(result.current).toHaveProperty('columnConfigProps');
    expect(result.current).toHaveProperty('tableProps');

    // columnConfigProps should contain expected keys
    expect(result.current.columnConfigProps).toHaveProperty('columns');
    expect(result.current.columnConfigProps).toHaveProperty('columnOrder');
    expect(result.current.columnConfigProps).toHaveProperty('visibleColumns');
    expect(result.current.columnConfigProps).toHaveProperty('onOrderChange');
    expect(result.current.columnConfigProps).toHaveProperty('onVisibilityChange');
    expect(result.current.columnConfigProps).toHaveProperty('onReset');
    expect(result.current.columnConfigProps).toHaveProperty('defaultOrder');
    expect(result.current.columnConfigProps).toHaveProperty('defaultVisible');

    // tableProps should contain expected keys
    expect(result.current.tableProps).toHaveProperty('columns');
    expect(result.current.tableProps).toHaveProperty('columnOrder');
    expect(result.current.tableProps).toHaveProperty('visibleColumns');
  });

  it('returns default column order when no saved preferences', () => {
    const { result } = renderHook(() => useFeatureTableConfig(hookParams));

    expect(result.current.columnConfigProps.columnOrder).toEqual(defaultColumnOrder);
    expect(result.current.tableProps.columnOrder).toEqual(defaultColumnOrder);
    expect(result.current.columnConfigProps.visibleColumns).toEqual(defaultVisibleColumns);
  });

  it('handleColumnOrderChange updates preference', () => {
    const { result } = renderHook(() => useFeatureTableConfig(hookParams));

    act(() => {
      result.current.columnConfigProps.onOrderChange(['status', 'age', 'name']);
    });

    expect(mockPreferences.get('viewSettings.hookTest.columnOrder')).toEqual([
      'status',
      'age',
      'name',
    ]);
  });

  it('handleColumnVisibilityChange adds a column when visible is true', () => {
    const { result } = renderHook(() => useFeatureTableConfig(hookParams));

    act(() => {
      result.current.columnConfigProps.onVisibilityChange('status', true);
    });

    // Default visible was ['name', 'age'], adding 'status'
    expect(mockPreferences.get('viewSettings.hookTest.visibleColumns')).toEqual([
      'name',
      'age',
      'status',
    ]);
  });

  it('handleColumnVisibilityChange removes a column when visible is false', () => {
    const { result } = renderHook(() => useFeatureTableConfig(hookParams));

    act(() => {
      result.current.columnConfigProps.onVisibilityChange('age', false);
    });

    // Default visible was ['name', 'age'], removing 'age'
    expect(mockPreferences.get('viewSettings.hookTest.visibleColumns')).toEqual(['name']);
  });

  it('handleColumnReset restores defaults', () => {
    // Set some saved state first
    mockPreferences.set('viewSettings.hookTest.columnOrder', ['status', 'name', 'age']);
    mockPreferences.set('viewSettings.hookTest.visibleColumns', ['status']);

    const { result } = renderHook(() => useFeatureTableConfig(hookParams));

    act(() => {
      result.current.columnConfigProps.onReset();
    });

    // columnOrder should be reset to undefined (so mergeColumnOrder falls back to default)
    expect(mockPreferences.get('viewSettings.hookTest.columnOrder')).toBeUndefined();
    // visibleColumns should be restored to defaults
    expect(mockPreferences.get('viewSettings.hookTest.visibleColumns')).toEqual(
      defaultVisibleColumns,
    );
  });
});
