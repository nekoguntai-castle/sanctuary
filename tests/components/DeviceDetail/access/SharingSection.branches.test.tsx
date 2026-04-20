import { fireEvent,render,screen,within } from '@testing-library/react';
import { describe,expect,it,vi } from 'vitest';
import { SharingSection } from '../../../../components/DeviceDetail/access/SharingSection';
import type { DeviceShareInfo } from '../../../../types';

const baseProps = {
  isOwner: true,
  deviceShareInfo: null,
  groups: [
    { id: 'group-1', name: 'Ops' },
    { id: 'group-2', name: 'Treasury' },
  ],
  selectedGroupToAdd: '',
  setSelectedGroupToAdd: vi.fn(),
  userSearchQuery: '',
  userSearchResults: [],
  searchingUsers: false,
  sharingLoading: false,
  onSearchUsers: vi.fn(),
  onShareWithUser: vi.fn(),
  onRemoveUserAccess: vi.fn(),
  onAddGroup: vi.fn(),
  onRemoveGroup: vi.fn(),
};

describe('SharingSection branch coverage', () => {
  it('renders owner sharing controls and invokes group/user add callbacks', () => {
    const props = {
      ...baseProps,
      selectedGroupToAdd: 'group-1',
      userSearchQuery: 'bo',
      userSearchResults: [{ id: 'user-2', username: 'bob' }],
    };

    render(<SharingSection {...props} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'group-2' } });
    expect(props.setSelectedGroupToAdd).toHaveBeenCalledWith('group-2');

    fireEvent.click(screen.getAllByRole('button', { name: 'Add as Viewer' })[0]);
    expect(props.onAddGroup).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByPlaceholderText('Add user...'), { target: { value: 'alice' } });
    expect(props.onSearchUsers).toHaveBeenCalledWith('alice');

    const bobRow = screen.getByText('bob').closest('div')?.parentElement;
    expect(bobRow).not.toBeNull();
    fireEvent.click(within(bobRow as HTMLElement).getByRole('button', { name: 'Add as Viewer' }));
    expect(props.onShareWithUser).toHaveBeenCalledWith('user-2');
  });

  it('renders shared group/users, filters owner rows, and removes access for owners', () => {
    const shareInfo: DeviceShareInfo = {
      group: { id: 'group-1', name: 'Ops' },
      users: [
        { id: 'owner-1', username: 'ownerAlice', role: 'owner' },
        { id: 'viewer-1', username: 'bob', role: 'viewer' },
      ],
    };

    const props = { ...baseProps, deviceShareInfo: shareInfo };
    render(<SharingSection {...props} />);

    expect(screen.getByText('Ops')).toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();
    expect(screen.queryByText('ownerAlice')).not.toBeInTheDocument();

    const removeButtons = screen.getAllByRole('button');
    fireEvent.click(removeButtons[0]);
    fireEvent.click(removeButtons[1]);

    expect(props.onRemoveGroup).toHaveBeenCalledTimes(1);
    expect(props.onRemoveUserAccess).toHaveBeenCalledWith('viewer-1');
  });

  it('hides owner-only controls for non-owners and shows the empty state without shared access', () => {
    render(<SharingSection {...baseProps} isOwner={false} />);

    expect(screen.queryByPlaceholderText('Add user...')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('Not shared with anyone yet.')).toBeInTheDocument();
  });
});
