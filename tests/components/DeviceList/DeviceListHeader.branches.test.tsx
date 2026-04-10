import { fireEvent,render,screen } from '@testing-library/react';
import { describe,expect,it,vi } from 'vitest';
import { DeviceListHeader } from '../../../components/DeviceList/DeviceListHeader';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../../../components/ui/ColumnConfigButton', () => ({
  ColumnConfigButton: () => <div data-testid="column-config">Column Config</div>,
}));

vi.mock('../../../components/ui/CustomIcons', () => ({
  getWalletIcon: (_type: string, _cls: string) => <span data-testid="wallet-icon" />,
}));

const buildProps = (overrides: Partial<React.ComponentProps<typeof DeviceListHeader>> = {}) => ({
  deviceCount: 6,
  ownedCount: 4,
  sharedCount: 2,
  viewMode: 'grouped' as const,
  setViewMode: vi.fn(),
  ownershipFilter: 'all' as const,
  setOwnershipFilter: vi.fn(),
  walletFilter: 'all',
  setWalletFilter: vi.fn(),
  walletOptions: [],
  unassignedCount: 0,
  columnOrder: [],
  visibleColumns: [],
  onColumnOrderChange: vi.fn(),
  onColumnVisibilityChange: vi.fn(),
  onColumnReset: vi.fn(),
  ...overrides,
});

describe('DeviceListHeader branch coverage', () => {
  it('covers ownership filter active branches and list-view callback', () => {
    const setOwnershipFilter = vi.fn();
    const setViewMode = vi.fn();
    const props = buildProps({ setOwnershipFilter, setViewMode });
    const { rerender } = render(<DeviceListHeader {...props} />);

    const allButton = screen.getByRole('button', { name: 'All (6)' });
    expect(allButton.className).toContain('surface-secondary');
    fireEvent.click(allButton);
    expect(setOwnershipFilter).toHaveBeenCalledWith('all');

    rerender(<DeviceListHeader {...buildProps({ ownershipFilter: 'owned', setOwnershipFilter, setViewMode })} />);
    expect(screen.getByRole('button', { name: 'Owned (4)' }).className).toContain('surface-secondary');

    rerender(<DeviceListHeader {...buildProps({ ownershipFilter: 'shared', setOwnershipFilter, setViewMode })} />);
    expect(screen.getByRole('button', { name: 'Shared (2)' }).className).toContain('surface-secondary');

    fireEvent.click(screen.getByRole('button', { name: 'List View' }));
    expect(setViewMode).toHaveBeenCalledWith('list');
  });

  it('covers list-mode column config visibility and connect navigation', () => {
    render(<DeviceListHeader {...buildProps({ viewMode: 'list' })} />);

    expect(screen.getByTestId('column-config')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Connect New Device/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/devices/connect');
  });

  it('hides wallet filter dropdown when no wallet options and no unassigned', () => {
    render(<DeviceListHeader {...buildProps({ walletOptions: [], unassignedCount: 0 })} />);
    expect(screen.queryByText('All Wallets')).not.toBeInTheDocument();
  });

  it('shows wallet filter dropdown when wallet options exist', () => {
    const setWalletFilter = vi.fn();
    const walletOptions = [
      { id: 'w1', name: 'Savings', type: 'single_sig', count: 2 },
      { id: 'w2', name: 'Multisig Vault', type: 'multi_sig', count: 3 },
    ];
    render(<DeviceListHeader {...buildProps({ walletOptions, setWalletFilter })} />);

    // Trigger button shows "All Wallets"
    const trigger = screen.getByTitle('Filter by wallet');
    expect(trigger).toBeInTheDocument();
    expect(trigger.textContent).toContain('All Wallets');

    // Open dropdown
    fireEvent.click(trigger);
    expect(screen.getByText('Savings')).toBeInTheDocument();
    expect(screen.getByText('Multisig Vault')).toBeInTheDocument();

    // Select a wallet
    fireEvent.click(screen.getByText('Savings'));
    expect(setWalletFilter).toHaveBeenCalledWith('w1');
  });

  it('shows unassigned option when unassigned devices exist', () => {
    const setWalletFilter = vi.fn();
    render(<DeviceListHeader {...buildProps({ unassignedCount: 3, setWalletFilter })} />);

    // Open dropdown
    fireEvent.click(screen.getByTitle('Filter by wallet'));
    expect(screen.getByText('Unassigned')).toBeInTheDocument();

    // Select unassigned
    fireEvent.click(screen.getByText('Unassigned'));
    expect(setWalletFilter).toHaveBeenCalledWith('unassigned');
  });

  it('highlights trigger button when wallet filter is active', () => {
    const walletOptions = [{ id: 'w1', name: 'Savings', type: 'single_sig', count: 2 }];
    render(<DeviceListHeader {...buildProps({ walletFilter: 'w1', walletOptions })} />);

    const trigger = screen.getByTitle('Filter by wallet');
    expect(trigger.className).toContain('surface-secondary');
    expect(trigger.textContent).toContain('Savings');
  });

  it('shows "All Wallets" when wallet filter selects all', () => {
    const walletOptions = [{ id: 'w1', name: 'Savings', type: 'single_sig', count: 2 }];
    const setWalletFilter = vi.fn();
    render(<DeviceListHeader {...buildProps({ walletFilter: 'w1', walletOptions, setWalletFilter })} />);

    const trigger = screen.getByTitle('Filter by wallet');
    expect(trigger.className).toContain('surface-secondary');

    // Open dropdown and click "All Wallets" option
    fireEvent.click(trigger);
    const dropdownItems = screen.getAllByRole('button').filter(b => b.textContent?.includes('All Wallets'));
    // The dropdown "All Wallets" button (not the trigger)
    const allWalletsDropdownItem = dropdownItems[dropdownItems.length - 1];
    fireEvent.click(allWalletsDropdownItem);
    expect(setWalletFilter).toHaveBeenCalledWith('all');
  });

  it('closes dropdown on outside click', () => {
    const walletOptions = [{ id: 'w1', name: 'Savings', type: 'single_sig', count: 2 }];
    render(<DeviceListHeader {...buildProps({ walletOptions })} />);

    // Open dropdown
    fireEvent.click(screen.getByTitle('Filter by wallet'));
    expect(screen.getByText('Savings')).toBeInTheDocument();

    // Click outside
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('Savings')).not.toBeInTheDocument();
  });

  it('closes dropdown on Escape key', () => {
    const walletOptions = [{ id: 'w1', name: 'Savings', type: 'single_sig', count: 2 }];
    render(<DeviceListHeader {...buildProps({ walletOptions })} />);

    fireEvent.click(screen.getByTitle('Filter by wallet'));
    expect(screen.getByText('Savings')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Savings')).not.toBeInTheDocument();
  });

  it('shows "Unassigned" label on trigger when unassigned filter is active', () => {
    render(<DeviceListHeader {...buildProps({ walletFilter: 'unassigned', unassignedCount: 3 })} />);

    const trigger = screen.getByTitle('Filter by wallet');
    expect(trigger.textContent).toContain('Unassigned');
    expect(trigger.className).toContain('surface-secondary');
  });

  it('falls back to "All Wallets" label when wallet filter references unknown wallet', () => {
    const walletOptions = [{ id: 'w1', name: 'Savings', type: 'single_sig', count: 2 }];
    render(<DeviceListHeader {...buildProps({ walletFilter: 'unknown-id', walletOptions })} />);

    const trigger = screen.getByTitle('Filter by wallet');
    expect(trigger.textContent).toContain('All Wallets');
  });

  it('hides ownership filter when sharedCount is 0', () => {
    render(<DeviceListHeader {...buildProps({ sharedCount: 0 })} />);
    expect(screen.queryByText(/Owned/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Shared/)).not.toBeInTheDocument();
  });

  it('highlights unassigned option when walletFilter is unassigned', () => {
    render(<DeviceListHeader {...buildProps({ walletFilter: 'unassigned', unassignedCount: 2 })} />);
    fireEvent.click(screen.getByTitle('Filter by wallet'));

    // The unassigned button in dropdown should have active styling
    // "Unassigned" appears in both trigger and dropdown; find the dropdown one
    const unassignedBtns = screen.getAllByText('Unassigned').map(el => el.closest('button')!);
    const dropdownBtn = unassignedBtns[unassignedBtns.length - 1];
    expect(dropdownBtn.className).toContain('surface-secondary');
  });

  it('does not close dropdown on non-Escape key', () => {
    const walletOptions = [{ id: 'w1', name: 'Savings', type: 'single_sig', count: 2 }];
    render(<DeviceListHeader {...buildProps({ walletOptions })} />);

    fireEvent.click(screen.getByTitle('Filter by wallet'));
    expect(screen.getByText('Savings')).toBeInTheDocument();

    // Press a non-Escape key — dropdown should stay open
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(screen.getByText('Savings')).toBeInTheDocument();
  });

  it('does not close dropdown on click inside', () => {
    const walletOptions = [{ id: 'w1', name: 'Savings', type: 'single_sig', count: 2 }];
    render(<DeviceListHeader {...buildProps({ walletOptions })} />);

    fireEvent.click(screen.getByTitle('Filter by wallet'));
    const dropdown = screen.getByText('Savings').closest('div')!;

    // Click inside the dropdown — should stay open (mousedown inside)
    fireEvent.mouseDown(dropdown);
    expect(screen.getByText('Savings')).toBeInTheDocument();
  });

  it('shows deletion note subtitle', () => {
    render(<DeviceListHeader {...buildProps()} />);
    expect(screen.getByText('Devices must be removed from all wallets before they can be deleted.')).toBeInTheDocument();
  });
});
