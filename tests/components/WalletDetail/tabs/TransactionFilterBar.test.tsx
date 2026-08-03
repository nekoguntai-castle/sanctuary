import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TransactionFilterBar } from '../../../../src/components/WalletDetail/tabs/TransactionFilterBar';
import type { TransactionFilters } from '../../../../src/components/WalletDetail/hooks/useTransactionFilters';
import type { Label } from '../../../../src/types';

vi.mock('lucide-react', () => ({
  ArrowDownLeft: () => <span data-testid="icon-arrow-down-left" />,
  ArrowUpRight: () => <span data-testid="icon-arrow-up-right" />,
  RefreshCw: () => <span data-testid="icon-refresh-cw" />,
  X: () => <span data-testid="icon-x" />,
  ListFilter: () => <span data-testid="icon-list-filter" />,
}));

const defaultFilters: TransactionFilters = {
  type: 'all',
  confirmations: 'all',
  datePreset: 'all',
  dateFrom: null,
  dateTo: null,
  labelId: null,
};

function buildProps(overrides: Partial<Parameters<typeof TransactionFilterBar>[0]> = {}) {
  return {
    filters: defaultFilters,
    onTypeChange: vi.fn(),
    onConfirmationChange: vi.fn(),
    onDatePresetChange: vi.fn(),
    onCustomDateRangeChange: vi.fn(),
    onLabelChange: vi.fn(),
    onClearAll: vi.fn(),
    hasActiveFilters: false,
    labels: [] as Label[],
    ...overrides,
  };
}

const sampleLabels: Label[] = [
  { id: 'lbl-1', walletId: 'w1', name: 'Exchange', color: '#ff0000' },
  { id: 'lbl-2', walletId: 'w1', name: 'Mining', color: '#00ff00' },
];

describe('TransactionFilterBar', () => {
  // -------------------------------------------------------------------------
  // 1. Renders all type chips
  // -------------------------------------------------------------------------
  it('renders the ListFilter icon and all four type chip buttons', () => {
    render(<TransactionFilterBar {...buildProps()} />);

    expect(screen.getByTestId('icon-list-filter')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /All/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Received/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sent/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Consolidation/i })).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 2. Clicking a type chip calls onTypeChange with correct value
  // -------------------------------------------------------------------------
  it.each([
    ['All', 'all'],
    ['Received', 'received'],
    ['Sent', 'sent'],
    ['Consolidation', 'consolidation'],
  ] as const)('clicking "%s" chip calls onTypeChange with "%s"', (label, expected) => {
    const props = buildProps();
    render(<TransactionFilterBar {...props} />);

    fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }));
    expect(props.onTypeChange).toHaveBeenCalledWith(expected);
  });

  // -------------------------------------------------------------------------
  // 3. Active type chip has correct styling class
  // -------------------------------------------------------------------------
  it.each([
    ['all', 'All'],
    ['received', 'Received'],
    ['sent', 'Sent'],
    ['consolidation', 'Consolidation'],
  ] as const)('active type "%s" applies bg-primary-600 class to "%s" button', (type, label) => {
    const props = buildProps({ filters: { ...defaultFilters, type } });
    render(<TransactionFilterBar {...props} />);

    const activeBtn = screen.getByRole('button', { name: new RegExp(label) });
    expect(activeBtn.className).toContain('bg-primary-600');

    // Other buttons should NOT have the active class
    const allButtons = screen.getAllByRole('button').filter(
      (btn) => btn.textContent !== 'Clear' && !new RegExp(label).test(btn.textContent ?? ''),
    );
    for (const btn of allButtons) {
      expect(btn.className).not.toContain('bg-primary-600');
    }
  });

  // -------------------------------------------------------------------------
  // 4. Date dropdown renders and calls onDatePresetChange on change
  // -------------------------------------------------------------------------
  it('renders date preset dropdown with all options', () => {
    render(<TransactionFilterBar {...buildProps()} />);

    const dateSelect = screen.getByDisplayValue('All Time');
    expect(dateSelect).toBeInTheDocument();

    // Verify all options exist
    const options = dateSelect.querySelectorAll('option');
    const optionValues = Array.from(options).map((o) => o.value);
    expect(optionValues).toEqual(['all', '7d', '30d', 'this_month', 'last_month', 'custom']);
  });

  it('calls onDatePresetChange when date dropdown changes', () => {
    const props = buildProps();
    render(<TransactionFilterBar {...props} />);

    fireEvent.change(screen.getByDisplayValue('All Time'), { target: { value: '30d' } });
    expect(props.onDatePresetChange).toHaveBeenCalledWith('30d');
  });

  // -------------------------------------------------------------------------
  // 5. Custom date inputs appear when datePreset === 'custom'
  // -------------------------------------------------------------------------
  it('does not show date inputs when datePreset is not custom', () => {
    render(<TransactionFilterBar {...buildProps()} />);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    // No date inputs
    const dateInputs = document.querySelectorAll('input[type="date"]');
    expect(dateInputs).toHaveLength(0);
  });

  it('shows two date inputs when datePreset is custom', () => {
    const props = buildProps({
      filters: { ...defaultFilters, datePreset: 'custom', dateFrom: null, dateTo: null },
    });
    render(<TransactionFilterBar {...props} />);

    const dateInputs = document.querySelectorAll('input[type="date"]');
    expect(dateInputs).toHaveLength(2);
    expect(screen.getByText('to')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 6. Custom date "from" input calls onCustomDateRangeChange(timestamp, currentTo)
  // -------------------------------------------------------------------------
  it('changing "from" date calls onCustomDateRangeChange with parsed timestamp and existing dateTo', () => {
    const existingTo = new Date('2025-06-15T23:59:59.999').getTime();
    const props = buildProps({
      filters: { ...defaultFilters, datePreset: 'custom', dateFrom: null, dateTo: existingTo },
    });
    render(<TransactionFilterBar {...props} />);

    const dateInputs = document.querySelectorAll('input[type="date"]');
    const fromInput = dateInputs[0];

    fireEvent.change(fromInput, { target: { value: '2025-06-01' } });

    const expectedFrom = new Date('2025-06-01T00:00:00').getTime();
    expect(props.onCustomDateRangeChange).toHaveBeenCalledWith(expectedFrom, existingTo);
  });

  // -------------------------------------------------------------------------
  // 7. Custom date "to" input calls onCustomDateRangeChange(currentFrom, endOfDayTimestamp)
  // -------------------------------------------------------------------------
  it('changing "to" date calls onCustomDateRangeChange with existing dateFrom and end-of-day timestamp', () => {
    const existingFrom = new Date('2025-06-01T00:00:00').getTime();
    const props = buildProps({
      filters: { ...defaultFilters, datePreset: 'custom', dateFrom: existingFrom, dateTo: null },
    });
    render(<TransactionFilterBar {...props} />);

    const dateInputs = document.querySelectorAll('input[type="date"]');
    const toInput = dateInputs[1];

    fireEvent.change(toInput, { target: { value: '2025-06-15' } });

    const expectedTo = new Date('2025-06-15T23:59:59.999').getTime();
    expect(props.onCustomDateRangeChange).toHaveBeenCalledWith(existingFrom, expectedTo);
  });

  // -------------------------------------------------------------------------
  // 8. Custom date inputs with empty value calls with null
  // -------------------------------------------------------------------------
  it('clearing "from" date input calls onCustomDateRangeChange with null for from', () => {
    const existingFrom = new Date('2025-06-01T00:00:00').getTime();
    const existingTo = new Date('2025-06-15T23:59:59.999').getTime();
    const props = buildProps({
      filters: { ...defaultFilters, datePreset: 'custom', dateFrom: existingFrom, dateTo: existingTo },
    });
    render(<TransactionFilterBar {...props} />);

    const dateInputs = document.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0], { target: { value: '' } });
    expect(props.onCustomDateRangeChange).toHaveBeenCalledWith(null, existingTo);
  });

  it('clearing "to" date input calls onCustomDateRangeChange with null for to', () => {
    const existingFrom = new Date('2025-06-01T00:00:00').getTime();
    const existingTo = new Date('2025-06-15T23:59:59.999').getTime();
    const props = buildProps({
      filters: { ...defaultFilters, datePreset: 'custom', dateFrom: existingFrom, dateTo: existingTo },
    });
    render(<TransactionFilterBar {...props} />);

    const dateInputs = document.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[1], { target: { value: '' } });
    expect(props.onCustomDateRangeChange).toHaveBeenCalledWith(existingFrom, null);
  });

  // -------------------------------------------------------------------------
  // 9. Confirmations dropdown renders and calls onConfirmationChange
  // -------------------------------------------------------------------------
  it('renders confirmations dropdown with all options', () => {
    render(<TransactionFilterBar {...buildProps()} />);

    const confirmSelect = screen.getByDisplayValue('All Status');
    expect(confirmSelect).toBeInTheDocument();

    const options = confirmSelect.querySelectorAll('option');
    const optionValues = Array.from(options).map((o) => o.value);
    expect(optionValues).toEqual(['all', 'unconfirmed', 'confirmed', 'deep']);
  });

  it('calls onConfirmationChange when confirmations dropdown changes', () => {
    const props = buildProps();
    render(<TransactionFilterBar {...props} />);

    fireEvent.change(screen.getByDisplayValue('All Status'), { target: { value: 'deep' } });
    expect(props.onConfirmationChange).toHaveBeenCalledWith('deep');
  });

  // -------------------------------------------------------------------------
  // 10. Label dropdown hidden when labels is empty
  // -------------------------------------------------------------------------
  it('does not render label dropdown when labels array is empty', () => {
    render(<TransactionFilterBar {...buildProps({ labels: [] })} />);
    expect(screen.queryByDisplayValue('All Labels')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 11. Label dropdown visible with labels, calls onLabelChange
  // -------------------------------------------------------------------------
  it('renders label dropdown with all labels when labels are provided', () => {
    const props = buildProps({ labels: sampleLabels });
    render(<TransactionFilterBar {...props} />);

    const labelSelect = screen.getByDisplayValue('All Labels');
    expect(labelSelect).toBeInTheDocument();

    const options = labelSelect.querySelectorAll('option');
    expect(options).toHaveLength(3); // "All Labels" + 2 labels
    expect(options[1].textContent).toBe('Exchange');
    expect(options[1].value).toBe('lbl-1');
    expect(options[2].textContent).toBe('Mining');
    expect(options[2].value).toBe('lbl-2');
  });

  it('calls onLabelChange with labelId when a label is selected', () => {
    const props = buildProps({ labels: sampleLabels });
    render(<TransactionFilterBar {...props} />);

    fireEvent.change(screen.getByDisplayValue('All Labels'), { target: { value: 'lbl-2' } });
    expect(props.onLabelChange).toHaveBeenCalledWith('lbl-2');
  });

  // -------------------------------------------------------------------------
  // 12. Selecting "All Labels" (empty value) calls onLabelChange(null)
  // -------------------------------------------------------------------------
  it('calls onLabelChange(null) when "All Labels" is selected', () => {
    const props = buildProps({
      labels: sampleLabels,
      filters: { ...defaultFilters, labelId: 'lbl-1' },
    });
    render(<TransactionFilterBar {...props} />);

    // The select value is 'lbl-1', so find it by that displayed option
    const labelSelect = screen.getByDisplayValue('Exchange');
    fireEvent.change(labelSelect, { target: { value: '' } });
    expect(props.onLabelChange).toHaveBeenCalledWith(null);
  });

  // -------------------------------------------------------------------------
  // 13. Clear button hidden when hasActiveFilters is false
  // -------------------------------------------------------------------------
  it('does not render Clear button when hasActiveFilters is false', () => {
    render(<TransactionFilterBar {...buildProps({ hasActiveFilters: false })} />);
    expect(screen.queryByRole('button', { name: /Clear/i })).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // 14. Clear button visible when hasActiveFilters is true, calls onClearAll
  // -------------------------------------------------------------------------
  it('renders Clear button when hasActiveFilters is true and calls onClearAll on click', () => {
    const props = buildProps({ hasActiveFilters: true });
    render(<TransactionFilterBar {...props} />);

    const clearBtn = screen.getByRole('button', { name: /Clear/i });
    expect(clearBtn).toBeInTheDocument();
    expect(screen.getByTestId('icon-x')).toBeInTheDocument();

    fireEvent.click(clearBtn);
    expect(props.onClearAll).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 15. toDateInputValue with null returns '' (tested through rendered input value)
  // -------------------------------------------------------------------------
  it('renders empty date input values when dateFrom and dateTo are null', () => {
    const props = buildProps({
      filters: { ...defaultFilters, datePreset: 'custom', dateFrom: null, dateTo: null },
    });
    render(<TransactionFilterBar {...props} />);

    const dateInputs = document.querySelectorAll('input[type="date"]');
    expect((dateInputs[0] as HTMLInputElement).value).toBe('');
    expect((dateInputs[1] as HTMLInputElement).value).toBe('');
  });

  // -------------------------------------------------------------------------
  // 16. toDateInputValue with timestamp returns ISO date string
  // -------------------------------------------------------------------------
  it('renders date input values from timestamps', () => {
    // Use a UTC-midnight timestamp to ensure deterministic ISO date output
    const from = Date.UTC(2025, 5, 1); // 2025-06-01T00:00:00Z
    const to = Date.UTC(2025, 5, 15, 23, 59, 59, 999); // 2025-06-15T23:59:59.999Z
    const props = buildProps({
      filters: { ...defaultFilters, datePreset: 'custom', dateFrom: from, dateTo: to },
    });
    render(<TransactionFilterBar {...props} />);

    const dateInputs = document.querySelectorAll('input[type="date"]');
    // toDateInputValue uses new Date(ts).toISOString().slice(0,10), so always UTC
    expect((dateInputs[0] as HTMLInputElement).value).toBe('2025-06-01');
    expect((dateInputs[1] as HTMLInputElement).value).toBe('2025-06-15');
  });

  // -------------------------------------------------------------------------
  // 17. fromDateInputValue with empty string returns null (tested via interaction)
  // -------------------------------------------------------------------------
  // Already covered by test #8 ("clearing from date input calls with null")

  // -------------------------------------------------------------------------
  // 18. fromDateInputValueEndOfDay with empty string returns null (tested via interaction)
  // -------------------------------------------------------------------------
  // Already covered by test #8 ("clearing to date input calls with null")

  // -------------------------------------------------------------------------
  // Additional: type chip icons render for non-"All" chips
  // -------------------------------------------------------------------------
  it('renders icons for Received, Sent, and Consolidation chips', () => {
    render(<TransactionFilterBar {...buildProps()} />);
    expect(screen.getByTestId('icon-arrow-down-left')).toBeInTheDocument();
    expect(screen.getByTestId('icon-arrow-up-right')).toBeInTheDocument();
    expect(screen.getByTestId('icon-refresh-cw')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Additional: confirmations dropdown reflects current filter value
  // -------------------------------------------------------------------------
  it('confirmations dropdown reflects the active filter value', () => {
    const props = buildProps({
      filters: { ...defaultFilters, confirmations: 'unconfirmed' },
    });
    render(<TransactionFilterBar {...props} />);
    expect(screen.getByDisplayValue('Unconfirmed')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Additional: date preset dropdown reflects the active filter value
  // -------------------------------------------------------------------------
  it('date dropdown reflects the active filter value', () => {
    const props = buildProps({
      filters: { ...defaultFilters, datePreset: '7d' },
    });
    render(<TransactionFilterBar {...props} />);
    expect(screen.getByDisplayValue('Last 7 Days')).toBeInTheDocument();
  });
});
