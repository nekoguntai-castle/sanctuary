import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceDetail } from '../../../components/DeviceDetail';
import * as devicesApi from '../../../src/api/devices';

const { mockNavigate, useDeviceDataMock, loggerSpies } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  useDeviceDataMock: vi.fn(),
  loggerSpies: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({ id: 'dev-1' }),
}));

vi.mock('../../../components/DeviceDetail/hooks/useDeviceData', () => ({
  useDeviceData: () => useDeviceDataMock(),
}));

vi.mock('../../../components/DeviceDetail/DeviceDetail/DeviceAccountsSection', () => ({
  DeviceAccountsSection: () => <div data-testid="device-accounts" />,
}));

vi.mock('../../../components/DeviceDetail/DeviceDetail/DeviceDetailTabs', () => ({
  DeviceDetailTabs: () => <div data-testid="device-tabs" />,
}));

vi.mock('../../../components/DeviceDetail/DeviceDetail/DeviceDetailTabContent', () => ({
  DeviceDetailTabContent: () => <div data-testid="device-tab-content" />,
}));

vi.mock('../../../components/DeviceDetail/DeviceDetail/DeviceTransferModal', () => ({
  DeviceTransferModal: () => <div data-testid="device-transfer-modal" />,
}));

vi.mock('../../../components/ui/CustomIcons', () => ({
  getDeviceIcon: () => <span data-testid="device-icon" />,
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => loggerSpies,
}));

vi.mock('../../../src/api/devices', () => ({
  deleteDevice: vi.fn(),
}));

const createDeviceData = (overrides: Record<string, unknown> = {}) => {
  const { device: deviceOverrides, ...resultOverrides } = overrides;

  return {
    device: {
      id: 'dev-1',
      label: 'TestNet NanoSPlus',
      type: 'ledger',
      fingerprint: 'abcd1234',
      isOwner: true,
      userRole: 'owner',
      walletCount: 0,
      ...((deviceOverrides as Record<string, unknown>) || {}),
    },
    setDevice: vi.fn(),
    wallets: [],
    loading: false,
    user: { id: 'user-1', username: 'alice' },
    isEditing: false,
    setIsEditing: vi.fn(),
    editLabel: 'TestNet NanoSPlus',
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
    handleTransferComplete: vi.fn(),
    getDeviceDisplayName: () => 'Ledger',
    ...resultOverrides,
  };
};

describe('DeviceDetail delete action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(devicesApi.deleteDevice).mockResolvedValue(undefined);
    useDeviceDataMock.mockReturnValue(createDeviceData());
  });

  it('deletes an owner-owned unassigned device from the detail page', async () => {
    const user = userEvent.setup();
    render(<DeviceDetail />);

    await user.click(screen.getByRole('button', { name: 'Delete device' }));
    expect(screen.getByText('Delete?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm delete device' }));

    await waitFor(() => {
      expect(devicesApi.deleteDevice).toHaveBeenCalledWith('dev-1');
      expect(mockNavigate).toHaveBeenCalledWith('/devices', { replace: true });
    });
  });

  it('hides the delete action when the device is attached to a wallet', () => {
    useDeviceDataMock.mockReturnValue(
      createDeviceData({
        wallets: [{ id: 'wallet-1', name: 'Vault', type: 'single_sig' }],
        device: { walletCount: 1 },
      }),
    );

    render(<DeviceDetail />);

    expect(screen.queryByRole('button', { name: 'Delete device' })).not.toBeInTheDocument();
  });

  it('keeps the confirmation open and shows an API error when deletion fails', async () => {
    const user = userEvent.setup();
    vi.mocked(devicesApi.deleteDevice).mockRejectedValueOnce(new Error('Device is linked to a wallet'));
    render(<DeviceDetail />);

    await user.click(screen.getByRole('button', { name: 'Delete device' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete device' }));

    expect(await screen.findByText('Device is linked to a wallet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm delete device' })).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalledWith('/devices', { replace: true });
    expect(loggerSpies.error).toHaveBeenCalledWith('Failed to delete device', expect.any(Object));
  });
});
