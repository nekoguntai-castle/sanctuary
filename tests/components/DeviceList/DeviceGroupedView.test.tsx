import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Device, HardwareDeviceModel } from '../../../types';
import { DeviceGroupedView } from '../../../components/DeviceList/DeviceGroupedView';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('lucide-react', () => ({
  HardDrive: (props: React.HTMLAttributes<HTMLSpanElement>) => (
    <span data-testid="icon-hard-drive" {...props} />
  ),
  Edit2: (props: React.HTMLAttributes<HTMLSpanElement>) => (
    <span data-testid="icon-edit" {...props} />
  ),
  Save: (props: React.HTMLAttributes<HTMLSpanElement>) => (
    <span data-testid="icon-save" {...props} />
  ),
  X: (props: React.HTMLAttributes<HTMLSpanElement>) => <span data-testid="icon-x" {...props} />,
  Trash2: (props: React.HTMLAttributes<HTMLSpanElement>) => (
    <span data-testid="icon-trash" {...props} />
  ),
  Users: (props: React.HTMLAttributes<HTMLSpanElement>) => (
    <span data-testid="icon-users" {...props} />
  ),
}));

const getDeviceIconMock = vi.fn(() => <span data-testid="device-type-icon" />);
const getWalletIconMock = vi.fn(() => <span data-testid="wallet-type-icon" />);
vi.mock('../../../components/ui/CustomIcons', () => ({
  getDeviceIcon: (...args: unknown[]) => getDeviceIconMock(...args),
  getWalletIcon: (...args: unknown[]) => getWalletIconMock(...args),
}));

const deviceModels: HardwareDeviceModel[] = [
  {
    id: 'ledger-model',
    slug: 'ledger-nano-s',
    name: 'Nano S',
    manufacturer: 'Ledger',
    connectivity: ['usb'],
    secureElement: true,
    openSource: false,
    airGapped: false,
    supportsBitcoinOnly: true,
    supportsMultisig: true,
    supportsTaproot: true,
    supportsPassphrase: true,
    scriptTypes: ['native_segwit'],
    hasScreen: true,
    integrationTested: true,
    discontinued: false,
  },
];

const makeDevice = (overrides: Partial<Device> = {}): Device => ({
  id: 'device-1',
  userId: 'user-1',
  label: 'My Device',
  type: 'ledger',
  fingerprint: 'abcd1234',
  xpub: 'xpub-1',
  derivationPath: "m/84'/0'/0'",
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  wallets: [],
  isShared: false,
  isOwner: true,
  ...overrides,
});

const renderGroupedView = ({
  groupedDevices = { ledger: [makeDevice()] },
  editingId = null,
  editValue = '',
  editType = '',
  deleteConfirmId = null,
  walletCounts = new Map<string, number>([['device-1', 0]]),
}: {
  groupedDevices?: Record<string, Device[]>;
  editingId?: string | null;
  editValue?: string;
  editType?: string;
  deleteConfirmId?: string | null;
  walletCounts?: Map<string, number>;
} = {}) => {
  const setEditingId = vi.fn();
  const setEditValue = vi.fn();
  const setEditType = vi.fn();
  const setDeleteConfirmId = vi.fn();
  const setDeleteError = vi.fn();
  const handleEdit = vi.fn();
  const handleSave = vi.fn();
  const handleDelete = vi.fn();
  const getWalletCount = vi.fn((device: Device) => walletCounts.get(device.id) ?? 0);

  render(
    <DeviceGroupedView
      groupedDevices={groupedDevices}
      editState={{
        editingId,
        editValue,
        editType,
        setEditingId,
        setEditValue,
        setEditType,
      }}
      deleteState={{
        deleteConfirmId,
        deleteError: null,
        setDeleteConfirmId,
        setDeleteError,
      }}
      deviceModels={deviceModels}
      getDeviceDisplayName={(type) => type.toUpperCase()}
      getWalletCount={getWalletCount}
      handleEdit={handleEdit}
      handleSave={handleSave}
      handleDelete={handleDelete}
    />
  );

  return {
    setEditingId,
    setEditValue,
    setEditType,
    setDeleteConfirmId,
    setDeleteError,
    handleEdit,
    handleSave,
    handleDelete,
  };
};

describe('DeviceGroupedView', () => {
  it('renders grouped header and navigates to device detail on row click', () => {
    renderGroupedView();

    expect(screen.getByText('LEDGER')).toBeInTheDocument();
    expect(screen.getByText('My Device')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(getDeviceIconMock).toHaveBeenCalled();

    fireEvent.click(screen.getByText('My Device'));
    expect(mockNavigate).toHaveBeenCalledWith('/devices/device-1');
  });

  it('renders editing controls and wires save/cancel/type handlers', () => {
    const device = makeDevice({ id: 'device-edit', label: 'Edit Device' });
    const handlers = renderGroupedView({
      groupedDevices: { ledger: [device] },
      editingId: 'device-edit',
      editValue: 'Edit Device',
      editType: 'ledger-nano-s',
      walletCounts: new Map([['device-edit', 0]]),
    });

    fireEvent.change(screen.getByDisplayValue('Edit Device'), { target: { value: 'Renamed' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ledger-nano-s' } });
    fireEvent.click(screen.getByLabelText('Save device'));
    fireEvent.click(screen.getByLabelText('Cancel editing'));

    expect(handlers.setEditValue).toHaveBeenCalledWith('Renamed');
    expect(handlers.setEditType).toHaveBeenCalledWith('ledger-nano-s');
    expect(handlers.handleSave).toHaveBeenCalledWith(device);
    expect(handlers.setEditingId).toHaveBeenCalledWith(null);
  });

  it('handles owner edit/delete actions and delete confirmation controls', () => {
    const device = makeDevice({ id: 'device-delete', label: 'Delete Device' });
    const handlers = renderGroupedView({
      groupedDevices: { ledger: [device] },
      deleteConfirmId: 'device-delete',
      walletCounts: new Map([['device-delete', 0]]),
    });

    fireEvent.click(screen.getByTestId('icon-edit').closest('button') as HTMLButtonElement);
    expect(handlers.handleEdit).toHaveBeenCalledWith(device);
    expect(mockNavigate).not.toHaveBeenCalledWith('/devices/device-delete');

    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(handlers.handleDelete).toHaveBeenCalledWith(device);

    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(handlers.setDeleteConfirmId).toHaveBeenCalledWith(null);
    expect(handlers.setDeleteError).toHaveBeenCalledWith(null);
  });

  it('renders shared device metadata and wallet badges by wallet type', () => {
    const shared = makeDevice({
      id: 'device-shared',
      label: 'Shared Device',
      isOwner: false,
      isShared: true,
      sharedBy: 'alice',
      wallets: [
        { wallet: { id: 'w1', name: 'Multisig Vault', type: 'multi_sig' } },
        { wallet: { id: 'w2', name: 'Singlesig Vault', type: 'single_sig' } },
      ] as any,
    });

    renderGroupedView({
      groupedDevices: { ledger: [shared] },
      walletCounts: new Map([['device-shared', 2]]),
    });

    expect(screen.getByText('Shared by alice')).toBeInTheDocument();
    expect(screen.getByText('Multisig Vault')).toBeInTheDocument();
    expect(screen.getByText('Singlesig Vault')).toBeInTheDocument();
    expect(getWalletIconMock).toHaveBeenCalledWith('multi_sig', 'w-2 h-2 mr-1 flex-shrink-0');
    expect(getWalletIconMock).toHaveBeenCalledWith('single_sig', 'w-2 h-2 mr-1 flex-shrink-0');
  });

  it('renders wallet-count fallback and unused fallback badges', () => {
    const countOnly = makeDevice({ id: 'device-count', label: 'Count Device', wallets: undefined });
    const countPlural = makeDevice({ id: 'device-count-plural', label: 'Count Device Plural', wallets: undefined });
    const unused = makeDevice({ id: 'device-unused', label: 'Unused Device', wallets: [] });

    renderGroupedView({
      groupedDevices: { ledger: [countOnly, countPlural, unused] },
      walletCounts: new Map([
        ['device-count', 1],
        ['device-count-plural', 2],
        ['device-unused', 0],
      ]),
    });

    expect(screen.getByText('1 wallet')).toBeInTheDocument();
    expect(screen.getByText('2 wallets')).toBeInTheDocument();
    expect(screen.getByText('Unused')).toBeInTheDocument();
    expect(screen.getAllByTestId('icon-hard-drive')).toHaveLength(2);
  });

  it('falls back wallet type to single_sig when wallet type is missing', () => {
    const unknownTypeWallet = makeDevice({
      id: 'device-unknown-wallet-type',
      label: 'Unknown Type Wallet Device',
      wallets: [{ wallet: { id: 'w-missing-type', name: 'Missing Type Wallet' } }] as any,
    });

    renderGroupedView({
      groupedDevices: { ledger: [unknownTypeWallet] },
      walletCounts: new Map([['device-unknown-wallet-type', 1]]),
    });

    expect(screen.getByText('Missing Type Wallet')).toBeInTheDocument();
    expect(getWalletIconMock).toHaveBeenCalledWith('single_sig', 'w-2 h-2 mr-1 flex-shrink-0');
  });
});
