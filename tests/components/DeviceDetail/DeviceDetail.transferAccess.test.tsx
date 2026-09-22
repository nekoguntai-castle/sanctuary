import { queryClient } from '../../../src/providers/QueryProvider';
import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceDetailContent } from '../../../src/components/DeviceDetail/DeviceDetail/DeviceDetailContent';
import { deviceKeys } from '../../../src/hooks/queries/deviceKeys';

const testState = vi.hoisted(() => ({
  navigate: vi.fn(),
  completion: vi.fn(),
  ownsRoute: vi.fn(() => true),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => testState.navigate,
}));

vi.mock('../../../src/components/DeviceDetail/hooks/useDeviceDeletion', () => ({
  useDeviceDeletion: () => ({
    canDelete: false,
    deleteConfirmOpen: false,
    deletePending: false,
    deleteError: null,
    confirmDelete: vi.fn(),
    requestDelete: vi.fn(),
    cancelDelete: vi.fn(),
  }),
}));

vi.mock('../../../src/components/DeviceDetail/DeviceDetail/DeviceDetailHeader', () => ({
  DeviceDetailHeader: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../src/components/DeviceDetail/DeviceDetail/DeviceAccountsSection', () => ({
  DeviceAccountsSection: () => null,
}));
vi.mock('../../../src/components/DeviceDetail/DeviceDetail/DeviceDetailTabs', () => ({
  DeviceDetailTabs: () => null,
}));
vi.mock('../../../src/components/DeviceDetail/DeviceDetail/DeviceTransferModal', () => ({
  DeviceTransferModal: () => null,
}));
vi.mock('../../../src/components/DeviceDetail/DeviceDetail/DeviceDetailTabContent', () => ({
  DeviceDetailTabContent: ({ onTransferComplete }: { onTransferComplete: () => Promise<unknown> }) => (
    <button onClick={() => void onTransferComplete()}>complete transfer</button>
  ),
}));

function deviceData() {
  return {
    device: { id: 'device-1', label: 'Device', wallets: [], isOwner: true, userRole: 'owner' },
    setDevice: vi.fn(),
    ownsCurrentRoute: testState.ownsRoute,
    wallets: [],
    user: { username: 'alice' },
    isEditing: false,
    setIsEditing: vi.fn(),
    editLabel: '',
    setEditLabel: vi.fn(),
    editModelSlug: '',
    setEditModelSlug: vi.fn(),
    deviceModels: [],
    showTransferModal: false,
    setShowTransferModal: vi.fn(),
    deviceShareInfo: null,
    groups: [],
    selectedGroupToAdd: '',
    setSelectedGroupToAdd: vi.fn(),
    userSearchQuery: '',
    userSearchResults: [],
    searchingUsers: false,
    sharingLoading: false,
    isOwner: true,
    userRole: 'owner',
    handleSave: vi.fn(),
    cancelEdit: vi.fn(),
    handleSearchUsers: vi.fn(),
    handleShareWithUser: vi.fn(),
    handleRemoveUserAccess: vi.fn(),
    addGroup: vi.fn(),
    removeGroup: vi.fn(),
    handleTransferComplete: testState.completion,
    getDeviceDisplayName: vi.fn(),
  } as any;
}

describe('DeviceDetailContent transfer access reconciliation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    queryClient.clear();
    testState.ownsRoute.mockReturnValue(true);
    testState.completion.mockResolvedValue({ status: 'access-removed' });
  });

  it('evicts inaccessible device data before replace navigation', async () => {
    queryClient.setQueryData(deviceKeys.lists(), [
      { id: 'device-1' },
      { id: 'device-2' },
    ]);
    queryClient.setQueryData(deviceKeys.detail('device-1'), { id: 'device-1' });
    render(
      <StrictMode>
        <DeviceDetailContent id="device-1" data={deviceData()} />
      </StrictMode>,
    );

    fireEvent.click(screen.getByText('complete transfer'));

    await waitFor(() => expect(testState.navigate).toHaveBeenCalledWith('/devices', { replace: true }));
    expect(queryClient.getQueryData(deviceKeys.lists())).toEqual([{ id: 'device-2' }]);
    expect(queryClient.getQueryData(deviceKeys.detail('device-1'))).toBeUndefined();
  });

  it('allows cache eviction but blocks stale navigation after unmount', async () => {
    queryClient.setQueryData(deviceKeys.lists(), [{ id: 'device-1' }]);
    let finishInvalidation!: () => void;
    const invalidation = new Promise<void>(resolve => {
      finishInvalidation = resolve;
    });
    vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(invalidation);
    const view = render(<DeviceDetailContent id="device-1" data={deviceData()} />);

    fireEvent.click(screen.getByText('complete transfer'));
    await waitFor(() => expect(queryClient.getQueryData(deviceKeys.lists())).toEqual([]));
    view.unmount();
    await act(async () => {
      finishInvalidation();
      await invalidation;
      await Promise.resolve();
    });

    expect(testState.navigate).not.toHaveBeenCalled();
  });

  it('preserves ordinary completion and rejects a route it does not own', async () => {
    testState.completion.mockResolvedValue({ status: 'committed' });
    const view = render(<DeviceDetailContent id="device-1" data={deviceData()} />);

    fireEvent.click(screen.getByText('complete transfer'));
    await waitFor(() => expect(testState.completion).toHaveBeenCalledTimes(1));
    expect(testState.navigate).not.toHaveBeenCalled();

    testState.ownsRoute.mockReturnValue(false);
    fireEvent.click(screen.getByText('complete transfer'));
    await act(async () => Promise.resolve());
    expect(testState.completion).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});
