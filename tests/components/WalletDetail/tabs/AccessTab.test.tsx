import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AccessTab } from '../../../../components/WalletDetail/tabs/AccessTab';

vi.mock('../../../../components/PendingTransfersPanel', () => ({
  PendingTransfersPanel: () => <div data-testid="pending-transfers">Pending Transfers</div>,
}));

describe('AccessTab', () => {
  const baseProps = {
    accessSubTab: 'ownership' as const,
    onAccessSubTabChange: vi.fn(),
    walletShareInfo: {
      users: [
        { id: 'owner-1', username: 'alice', role: 'owner' },
        { id: 'user-2', username: 'bob', role: 'viewer' },
      ],
      group: null,
    } as any,
    userRole: 'owner',
    user: { id: 'owner-1', username: 'alice' } as any,
    onShowTransferModal: vi.fn(),
    selectedGroupToAdd: '',
    onSelectedGroupToAddChange: vi.fn(),
    groups: [{ id: 'g1', name: 'Team A' }],
    sharingLoading: false,
    onAddGroup: vi.fn(),
    onUpdateGroupRole: vi.fn(),
    onRemoveGroup: vi.fn(),
    userSearchQuery: '',
    onSearchUsers: vi.fn(),
    searchingUsers: false,
    userSearchResults: [],
    onShareWithUser: vi.fn(),
    onRemoveUserAccess: vi.fn(),
    walletId: 'wallet-1',
    onTransferComplete: vi.fn(),
  };

  it('renders ownership tab and triggers transfer action for owners', () => {
    render(<AccessTab {...baseProps} />);

    expect(screen.getByText('alice')).toBeInTheDocument();
    const transferButton = screen.getByText('Transfer');
    fireEvent.click(transferButton);
    expect(baseProps.onShowTransferModal).toHaveBeenCalled();
  });

  it('falls back to current user identity when owner is not in wallet share info', () => {
    render(
      <AccessTab
        {...baseProps}
        walletShareInfo={{ users: [{ id: 'user-2', username: 'bob', role: 'viewer' }], group: null } as any}
      />
    );

    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('uses generic ownership fallbacks when no share info or user is available', () => {
    render(
      <AccessTab
        {...baseProps}
        walletShareInfo={null}
        user={null}
        userRole="viewer"
      />
    );

    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('U')).toBeInTheDocument();
    expect(screen.queryByText('Transfer')).not.toBeInTheDocument();
  });

  it('renders sharing tab controls and empty state', () => {
    render(
      <AccessTab
        {...baseProps}
        accessSubTab="sharing"
        walletShareInfo={{ users: [{ id: 'owner-1', username: 'alice', role: 'owner' }], group: null } as any}
      />
    );

    expect(screen.getByPlaceholderText('Add user...')).toBeInTheDocument();
    expect(screen.getByText('Not shared with anyone yet.')).toBeInTheDocument();
  });

  it('renders transfers sub-tab panel', () => {
    render(<AccessTab {...baseProps} accessSubTab="transfers" />);
    expect(screen.getByTestId('pending-transfers')).toBeInTheDocument();
  });

  it('invokes sub-tab change handlers', () => {
    render(<AccessTab {...baseProps} />);

    fireEvent.click(screen.getByText('sharing'));
    fireEvent.click(screen.getByText('transfers'));
    fireEvent.click(screen.getByText('ownership'));

    expect(baseProps.onAccessSubTabChange).toHaveBeenCalledWith('sharing');
    expect(baseProps.onAccessSubTabChange).toHaveBeenCalledWith('transfers');
    expect(baseProps.onAccessSubTabChange).toHaveBeenCalledWith('ownership');
  });

  it('handles owner sharing controls for groups and users', () => {
    render(
      <AccessTab
        {...baseProps}
        accessSubTab="sharing"
        selectedGroupToAdd="g1"
        userSearchQuery="bob"
        userSearchResults={[{ id: 'u9', username: 'charlie' } as any]}
      />
    );

    fireEvent.change(screen.getByDisplayValue('Team A'), { target: { value: 'g1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Viewer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Signer' }));

    fireEvent.change(screen.getByPlaceholderText('Add user...'), { target: { value: 'char' } });
    fireEvent.click(screen.getByText('View'));
    fireEvent.click(screen.getByText('Sign'));

    expect(baseProps.onSelectedGroupToAddChange).toHaveBeenCalledWith('g1');
    expect(baseProps.onAddGroup).toHaveBeenCalledWith('viewer');
    expect(baseProps.onAddGroup).toHaveBeenCalledWith('signer');
    expect(baseProps.onSearchUsers).toHaveBeenCalledWith('char');
    expect(baseProps.onShareWithUser).toHaveBeenCalledWith('u9', 'viewer');
    expect(baseProps.onShareWithUser).toHaveBeenCalledWith('u9', 'signer');
  });

  it('handles existing shared group and users for owner role', () => {
    render(
      <AccessTab
        {...baseProps}
        accessSubTab="sharing"
        walletShareInfo={{
          users: [
            { id: 'owner-1', username: 'alice', role: 'owner' },
            { id: 'user-3', username: 'eve', role: 'viewer' },
          ],
          group: { id: 'g1', name: 'Team A', role: 'viewer' },
        } as any}
      />
    );

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'signer' } });
    fireEvent.click(screen.getAllByRole('button').find(b => b.querySelector('svg'))!);
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'signer' } });
    fireEvent.click(screen.getAllByRole('button').filter(b => b.querySelector('svg')).at(-1)!);

    expect(baseProps.onUpdateGroupRole).toHaveBeenCalledWith('signer');
    expect(baseProps.onRemoveGroup).toHaveBeenCalled();
    expect(baseProps.onShareWithUser).toHaveBeenCalledWith('user-3', 'signer');
    expect(baseProps.onRemoveUserAccess).toHaveBeenCalledWith('user-3');
  });

  it('renders non-owner sharing view with static roles and no owner controls', () => {
    render(
      <AccessTab
        {...baseProps}
        accessSubTab="sharing"
        userRole="viewer"
        walletShareInfo={{
          users: [
            { id: 'owner-1', username: 'alice', role: 'owner' },
            { id: 'user-3', username: 'eve', role: 'signer' },
          ],
          group: { id: 'g1', name: 'Team A', role: 'viewer' },
        } as any}
      />
    );

    expect(screen.queryByPlaceholderText('Add user...')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryByText('Not shared with anyone yet.')).not.toBeInTheDocument();
    expect(screen.getByText('viewer')).toBeInTheDocument();
    expect(screen.getByText('signer')).toBeInTheDocument();
  });

  it('shows search loading spinner when searching users', () => {
    render(
      <AccessTab
        {...baseProps}
        accessSubTab="sharing"
        searchingUsers={true}
      />
    );

    const spinner = document.querySelector('.animate-spin');
    expect(spinner).not.toBeNull();
  });
});
