import { fireEvent,render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe,expect,it,vi } from 'vitest';
import { createDeviceCellRenderers,type DeviceWithWallets } from '../../../components/cells/DeviceCells';
import type { HardwareDeviceModel,TableColumnConfig } from '../../../types';

vi.mock('lucide-react', () => ({
  Edit2: () => <span data-testid="edit-icon" />,
  Save: () => <span data-testid="save-icon" />,
  X: () => <span data-testid="x-icon" />,
  Trash2: () => <span data-testid="trash-icon" />,
  Users: () => <span data-testid="users-icon" />,
  HardDrive: () => <span data-testid="drive-icon" />,
}));

vi.mock('../../../components/ui/CustomIcons', () => ({
  getDeviceIcon: (_name: string, _className?: string) => <span data-testid="device-icon" />,
  getWalletIcon: (_type: string, _className?: string) => <span data-testid="wallet-icon" />,
}));

const baseColumn: TableColumnConfig = { id: 'label', label: 'Label' };

const makeDeviceModel = (overrides: Partial<HardwareDeviceModel> = {}): HardwareDeviceModel => ({
  id: 'model-passport',
  slug: 'passport',
  manufacturer: 'Foundation',
  name: 'Passport',
  connectivity: ['usb'],
  secureElement: true,
  openSource: true,
  airGapped: true,
  supportsBitcoinOnly: true,
  supportsMultisig: true,
  supportsTaproot: true,
  supportsPassphrase: true,
  scriptTypes: ['native_segwit', 'nested_segwit', 'taproot'],
  hasScreen: true,
  integrationTested: true,
  discontinued: false,
  ...overrides,
});

const baseDevice: DeviceWithWallets = {
  id: 'device-1',
  type: 'passport',
  label: 'Passport',
  fingerprint: 'abcd1234',
  isOwner: true,
  accounts: [],
  wallets: [],
};

describe('DeviceCells', () => {
  it('renders editable label cell and triggers save', async () => {
    const user = userEvent.setup();
    const handleSave = vi.fn();

    const renderers = createDeviceCellRenderers(
      {
        editingId: 'device-1',
        editValue: 'My Device',
        editType: 'passport',
        setEditingId: vi.fn(),
        setEditValue: vi.fn(),
        setEditType: vi.fn(),
      },
      {
        deleteConfirmId: null,
        deleteError: null,
        setDeleteConfirmId: vi.fn(),
        setDeleteError: vi.fn(),
      },
      {
        handleEdit: vi.fn(),
        handleSave,
        handleDelete: vi.fn(),
      },
      {
        getDeviceDisplayName: (type: string) => `Display ${type}`,
        deviceModels: [makeDeviceModel()],
      }
    );

    render(<renderers.label item={baseDevice} column={baseColumn} />);

    expect(screen.getByDisplayValue('My Device')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Save device'));
    expect(handleSave).toHaveBeenCalledWith(baseDevice);
  });

  it('updates edit fields and cancels editing from label cell controls', async () => {
    const user = userEvent.setup();
    const setEditValue = vi.fn();
    const setEditType = vi.fn();
    const setEditingId = vi.fn();

    const renderers = createDeviceCellRenderers(
      {
        editingId: 'device-1',
        editValue: 'My Device',
        editType: 'passport',
        setEditingId,
        setEditValue,
        setEditType,
      },
      {
        deleteConfirmId: null,
        deleteError: null,
        setDeleteConfirmId: vi.fn(),
        setDeleteError: vi.fn(),
      },
      {
        handleEdit: vi.fn(),
        handleSave: vi.fn(),
        handleDelete: vi.fn(),
      },
      {
        getDeviceDisplayName: (type: string) => `Display ${type}`,
        deviceModels: [
          makeDeviceModel(),
          makeDeviceModel({
            id: 'model-safe-3',
            slug: 'trezor-safe-3',
            manufacturer: 'Trezor',
            name: 'Safe 3',
            secureElement: false,
          }),
        ],
      }
    );

    render(<renderers.label item={baseDevice} column={baseColumn} />);

    fireEvent.change(screen.getByPlaceholderText('Label'), { target: { value: 'Renamed' } });
    expect(setEditValue).toHaveBeenCalledWith('Renamed');

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'trezor-safe-3' } });
    expect(setEditType).toHaveBeenCalledWith('trezor-safe-3');

    await user.click(screen.getByLabelText('Cancel editing'));
    expect(setEditingId).toHaveBeenCalledWith(null);
  });

  it('shows edit button for owner and triggers edit', async () => {
    const user = userEvent.setup();
    const handleEdit = vi.fn();

    const renderers = createDeviceCellRenderers(
      {
        editingId: null,
        editValue: '',
        editType: '',
        setEditingId: vi.fn(),
        setEditValue: vi.fn(),
        setEditType: vi.fn(),
      },
      {
        deleteConfirmId: null,
        deleteError: null,
        setDeleteConfirmId: vi.fn(),
        setDeleteError: vi.fn(),
      },
      {
        handleEdit,
        handleSave: vi.fn(),
        handleDelete: vi.fn(),
      },
      {
        getDeviceDisplayName: (type: string) => `Display ${type}`,
        deviceModels: [],
      }
    );

    render(<renderers.label item={baseDevice} column={baseColumn} />);
    await user.click(screen.getByTestId('edit-icon'));
    expect(handleEdit).toHaveBeenCalledWith(baseDevice);
  });

  it('shows shared by label for non-owner', () => {
    const renderers = createDeviceCellRenderers(
      {
        editingId: null,
        editValue: '',
        editType: '',
        setEditingId: vi.fn(),
        setEditValue: vi.fn(),
        setEditType: vi.fn(),
      },
      {
        deleteConfirmId: null,
        deleteError: null,
        setDeleteConfirmId: vi.fn(),
        setDeleteError: vi.fn(),
      },
      {
        handleEdit: vi.fn(),
        handleSave: vi.fn(),
        handleDelete: vi.fn(),
      },
      {
        getDeviceDisplayName: (type: string) => `Display ${type}`,
        deviceModels: [],
      }
    );

    render(
      <renderers.label
        item={{ ...baseDevice, isOwner: false, sharedBy: 'alice' }}
        column={baseColumn}
      />
    );

    expect(screen.getByText('Shared by alice')).toBeInTheDocument();
  });

  it('renders type and fingerprint cells', () => {
    const renderers = createDeviceCellRenderers(
      {
        editingId: null,
        editValue: '',
        editType: '',
        setEditingId: vi.fn(),
        setEditValue: vi.fn(),
        setEditType: vi.fn(),
      },
      {
        deleteConfirmId: null,
        deleteError: null,
        setDeleteConfirmId: vi.fn(),
        setDeleteError: vi.fn(),
      },
      {
        handleEdit: vi.fn(),
        handleSave: vi.fn(),
        handleDelete: vi.fn(),
      },
      {
        getDeviceDisplayName: (type: string) => `Display ${type}`,
        deviceModels: [],
      }
    );

    const { rerender } = render(<renderers.type item={baseDevice} column={baseColumn} />);
    expect(screen.getByText('Display passport')).toBeInTheDocument();

    rerender(<renderers.fingerprint item={baseDevice} column={baseColumn} />);
    expect(screen.getByText('abcd1234')).toBeInTheDocument();
  });

  it('renders accounts fallback and none states', () => {
    const renderers = createDeviceCellRenderers(
      {
        editingId: null,
        editValue: '',
        editType: '',
        setEditingId: vi.fn(),
        setEditValue: vi.fn(),
        setEditType: vi.fn(),
      },
      {
        deleteConfirmId: null,
        deleteError: null,
        setDeleteConfirmId: vi.fn(),
        setDeleteError: vi.fn(),
      },
      {
        handleEdit: vi.fn(),
        handleSave: vi.fn(),
        handleDelete: vi.fn(),
      },
      {
        getDeviceDisplayName: (type: string) => `Display ${type}`,
        deviceModels: [],
      }
    );

    const { rerender } = render(
      <renderers.accounts
        item={{ ...baseDevice, accounts: [], derivationPath: "m/48'/0'/0'/2'" }}
        column={baseColumn}
      />
    );
    expect(screen.getByText("m/48'/0'/0'/2'")).toBeInTheDocument();

    rerender(<renderers.accounts item={{ ...baseDevice, accounts: [] }} column={baseColumn} />);
    expect(screen.getByText('None')).toBeInTheDocument();
  });

  it('renders wallets fallback and count badge', () => {
    const renderers = createDeviceCellRenderers(
      {
        editingId: null,
        editValue: '',
        editType: '',
        setEditingId: vi.fn(),
        setEditValue: vi.fn(),
        setEditType: vi.fn(),
      },
      {
        deleteConfirmId: null,
        deleteError: null,
        setDeleteConfirmId: vi.fn(),
        setDeleteError: vi.fn(),
      },
      {
        handleEdit: vi.fn(),
        handleSave: vi.fn(),
        handleDelete: vi.fn(),
      },
      {
        getDeviceDisplayName: (type: string) => `Display ${type}`,
        deviceModels: [],
      }
    );

    const { rerender } = render(
      <renderers.wallets item={{ ...baseDevice, walletCount: 0 }} column={baseColumn} />
    );
    expect(screen.getByText('Unused')).toBeInTheDocument();

    rerender(
      <renderers.wallets item={{ ...baseDevice, walletCount: 2, wallets: [] }} column={baseColumn} />
    );
    expect(screen.getByText('2 wallets')).toBeInTheDocument();

    rerender(
      <renderers.wallets
        item={{
          ...baseDevice,
          walletCount: undefined,
          wallets: [{ wallet: { id: 'w-1', name: 'One Wallet', type: 'single_sig' } }],
        } as any}
        column={baseColumn}
      />
    );
    expect(screen.getByText('One Wallet')).toBeInTheDocument();
  });

  it('handles delete confirmation flow', async () => {
    const user = userEvent.setup();
    const handleDelete = vi.fn();
    const setDeleteConfirmId = vi.fn();
    const setDeleteError = vi.fn();

    const renderers = createDeviceCellRenderers(
      {
        editingId: null,
        editValue: '',
        editType: '',
        setEditingId: vi.fn(),
        setEditValue: vi.fn(),
        setEditType: vi.fn(),
      },
      {
        deleteConfirmId: null,
        deleteError: null,
        setDeleteConfirmId,
        setDeleteError,
      },
      {
        handleEdit: vi.fn(),
        handleSave: vi.fn(),
        handleDelete,
      },
      {
        getDeviceDisplayName: (type: string) => `Display ${type}`,
        deviceModels: [],
      }
    );

    render(<renderers.actions item={baseDevice} column={baseColumn} />);

    await user.click(screen.getByTitle('Delete device'));
    expect(setDeleteConfirmId).toHaveBeenCalledWith('device-1');

    // Confirm UI
    const renderersConfirm = createDeviceCellRenderers(
      {
        editingId: null,
        editValue: '',
        editType: '',
        setEditingId: vi.fn(),
        setEditValue: vi.fn(),
        setEditType: vi.fn(),
      },
      {
        deleteConfirmId: 'device-1',
        deleteError: null,
        setDeleteConfirmId,
        setDeleteError,
      },
      {
        handleEdit: vi.fn(),
        handleSave: vi.fn(),
        handleDelete,
      },
      {
        getDeviceDisplayName: (type: string) => `Display ${type}`,
        deviceModels: [],
      }
    );

    render(<renderersConfirm.actions item={baseDevice} column={baseColumn} />);
    await user.click(screen.getByText('Yes'));
    expect(handleDelete).toHaveBeenCalledWith(baseDevice);

    await user.click(screen.getByText('No'));
    expect(setDeleteConfirmId).toHaveBeenCalledWith(null);
    expect(setDeleteError).toHaveBeenCalledWith(null);
  });

  it('renders account badges for multisig and singlesig paths, including undefined accounts fallback', () => {
    const renderers = createDeviceCellRenderers(
      {
        editingId: null,
        editValue: '',
        editType: '',
        setEditingId: vi.fn(),
        setEditValue: vi.fn(),
        setEditType: vi.fn(),
      },
      {
        deleteConfirmId: null,
        deleteError: null,
        setDeleteConfirmId: vi.fn(),
        setDeleteError: vi.fn(),
      },
      {
        handleEdit: vi.fn(),
        handleSave: vi.fn(),
        handleDelete: vi.fn(),
      },
      {
        getDeviceDisplayName: (type: string) => `Display ${type}`,
        deviceModels: [],
      }
    );

    const { rerender } = render(
      <renderers.accounts
        item={{ ...baseDevice, accounts: undefined, derivationPath: "m/84'/0'/0'/0/0" } as any}
        column={baseColumn}
      />
    );
    expect(screen.getByText("m/84'/0'/0'/0/0")).toBeInTheDocument();

    rerender(
      <renderers.accounts
        item={{
          ...baseDevice,
          accounts: [
            {
              id: 'acct-multi',
              deviceId: 'device-1',
              derivationPath: "m/48'/0'/0'/2'",
              purpose: 'multisig',
              scriptType: 'native_segwit',
              accountIndex: 0,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            {
              id: 'acct-single',
              deviceId: 'device-1',
              derivationPath: "m/84'/0'/0'",
              purpose: 'single_sig',
              scriptType: 'native_segwit',
              accountIndex: 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        } as any}
        column={baseColumn}
      />
    );

    expect(screen.getByTitle('Multisig (native_segwit)')).toBeInTheDocument();
    expect(screen.getByTitle('Single-sig (native_segwit)')).toBeInTheDocument();
  });

  it('renders wallet badges for multisig, singlesig, and default wallet type fallback', () => {
    const renderers = createDeviceCellRenderers(
      {
        editingId: null,
        editValue: '',
        editType: '',
        setEditingId: vi.fn(),
        setEditValue: vi.fn(),
        setEditType: vi.fn(),
      },
      {
        deleteConfirmId: null,
        deleteError: null,
        setDeleteConfirmId: vi.fn(),
        setDeleteError: vi.fn(),
      },
      {
        handleEdit: vi.fn(),
        handleSave: vi.fn(),
        handleDelete: vi.fn(),
      },
      {
        getDeviceDisplayName: (type: string) => `Display ${type}`,
        deviceModels: [],
      }
    );

    render(
      <renderers.wallets
        item={{
          ...baseDevice,
          walletCount: 3,
          wallets: [
            { wallet: { id: 'w1', name: 'Multi Wallet', type: 'multi_sig' } },
            { wallet: { id: 'w2', name: 'Single Wallet', type: 'single_sig' } },
            { wallet: { id: 'w3', name: 'Legacy Wallet', type: '' } },
          ],
        } as any}
        column={baseColumn}
      />
    );

    expect(screen.getByText('Multi Wallet')).toBeInTheDocument();
    expect(screen.getByText('Single Wallet')).toBeInTheDocument();
    expect(screen.getByText('Legacy Wallet')).toBeInTheDocument();
    expect(screen.getAllByTestId('wallet-icon')).toHaveLength(3);
  });

  it('renders singular wallet fallback badge when count is one and wallets list is missing', () => {
    const renderers = createDeviceCellRenderers(
      {
        editingId: null,
        editValue: '',
        editType: '',
        setEditingId: vi.fn(),
        setEditValue: vi.fn(),
        setEditType: vi.fn(),
      },
      {
        deleteConfirmId: null,
        deleteError: null,
        setDeleteConfirmId: vi.fn(),
        setDeleteError: vi.fn(),
      },
      {
        handleEdit: vi.fn(),
        handleSave: vi.fn(),
        handleDelete: vi.fn(),
      },
      {
        getDeviceDisplayName: (type: string) => `Display ${type}`,
        deviceModels: [],
      }
    );

    render(
      <renderers.wallets
        item={{ ...baseDevice, wallets: undefined, walletCount: 1 } as any}
        column={baseColumn}
      />
    );

    expect(screen.getByText('1 wallet')).toBeInTheDocument();
  });

  it('hides action cell for non-owners or devices with attached wallets', () => {
    const renderers = createDeviceCellRenderers(
      {
        editingId: null,
        editValue: '',
        editType: '',
        setEditingId: vi.fn(),
        setEditValue: vi.fn(),
        setEditType: vi.fn(),
      },
      {
        deleteConfirmId: null,
        deleteError: null,
        setDeleteConfirmId: vi.fn(),
        setDeleteError: vi.fn(),
      },
      {
        handleEdit: vi.fn(),
        handleSave: vi.fn(),
        handleDelete: vi.fn(),
      },
      {
        getDeviceDisplayName: (type: string) => `Display ${type}`,
        deviceModels: [],
      }
    );

    const { container, rerender } = render(
      <renderers.actions item={{ ...baseDevice, isOwner: false, walletCount: 0 }} column={baseColumn} />
    );
    expect(container.firstChild).toBeNull();

    rerender(<renderers.actions item={{ ...baseDevice, isOwner: true, walletCount: 1 }} column={baseColumn} />);
    expect(container.firstChild).toBeNull();
  });

  it('uses zero-wallet fallback when wallet count and wallets are both undefined', () => {
    const renderers = createDeviceCellRenderers(
      {
        editingId: null,
        editValue: '',
        editType: '',
        setEditingId: vi.fn(),
        setEditValue: vi.fn(),
        setEditType: vi.fn(),
      },
      {
        deleteConfirmId: null,
        deleteError: null,
        setDeleteConfirmId: vi.fn(),
        setDeleteError: vi.fn(),
      },
      {
        handleEdit: vi.fn(),
        handleSave: vi.fn(),
        handleDelete: vi.fn(),
      },
      {
        getDeviceDisplayName: (type: string) => `Display ${type}`,
        deviceModels: [],
      }
    );

    render(
      <renderers.actions
        item={{ ...baseDevice, walletCount: undefined, wallets: undefined } as any}
        column={baseColumn}
      />
    );

    expect(screen.getByTitle('Delete device')).toBeInTheDocument();
  });

  it('shows Exclusive badge when filterContext is active and device is exclusive', () => {
    const renderers = createDeviceCellRenderers(
      {
        editingId: null,
        editValue: '',
        editType: '',
        setEditingId: vi.fn(),
        setEditValue: vi.fn(),
        setEditType: vi.fn(),
      },
      {
        deleteConfirmId: null,
        deleteError: null,
        setDeleteConfirmId: vi.fn(),
        setDeleteError: vi.fn(),
      },
      {
        handleEdit: vi.fn(),
        handleSave: vi.fn(),
        handleDelete: vi.fn(),
      },
      {
        getDeviceDisplayName: (type: string) => `Display ${type}`,
        deviceModels: [],
      },
      {
        walletFilter: 'w1',
        exclusiveDeviceIds: new Set(['device-1']),
      }
    );

    render(
      <renderers.wallets
        item={{
          ...baseDevice,
          wallets: [{ wallet: { id: 'w1', name: 'My Wallet', type: 'single_sig' } }],
        } as any}
        column={baseColumn}
      />
    );

    expect(screen.getByText('Exclusive')).toBeInTheDocument();
  });

  it('does not show Exclusive badge when filterContext is undefined', () => {
    const renderers = createDeviceCellRenderers(
      {
        editingId: null,
        editValue: '',
        editType: '',
        setEditingId: vi.fn(),
        setEditValue: vi.fn(),
        setEditType: vi.fn(),
      },
      {
        deleteConfirmId: null,
        deleteError: null,
        setDeleteConfirmId: vi.fn(),
        setDeleteError: vi.fn(),
      },
      {
        handleEdit: vi.fn(),
        handleSave: vi.fn(),
        handleDelete: vi.fn(),
      },
      {
        getDeviceDisplayName: (type: string) => `Display ${type}`,
        deviceModels: [],
      }
    );

    render(
      <renderers.wallets
        item={{
          ...baseDevice,
          wallets: [{ wallet: { id: 'w1', name: 'My Wallet', type: 'single_sig' } }],
        } as any}
        column={baseColumn}
      />
    );

    expect(screen.queryByText('Exclusive')).not.toBeInTheDocument();
  });

  it('does not show Exclusive badge when walletFilter is all', () => {
    const renderers = createDeviceCellRenderers(
      {
        editingId: null,
        editValue: '',
        editType: '',
        setEditingId: vi.fn(),
        setEditValue: vi.fn(),
        setEditType: vi.fn(),
      },
      {
        deleteConfirmId: null,
        deleteError: null,
        setDeleteConfirmId: vi.fn(),
        setDeleteError: vi.fn(),
      },
      {
        handleEdit: vi.fn(),
        handleSave: vi.fn(),
        handleDelete: vi.fn(),
      },
      {
        getDeviceDisplayName: (type: string) => `Display ${type}`,
        deviceModels: [],
      },
      {
        walletFilter: 'all',
        exclusiveDeviceIds: new Set(['device-1']),
      }
    );

    render(
      <renderers.wallets
        item={{
          ...baseDevice,
          wallets: [{ wallet: { id: 'w1', name: 'My Wallet', type: 'single_sig' } }],
        } as any}
        column={baseColumn}
      />
    );

    expect(screen.queryByText('Exclusive')).not.toBeInTheDocument();
  });

  it('shows delete error only for the currently confirmed device id', () => {
    const renderers = createDeviceCellRenderers(
      {
        editingId: null,
        editValue: '',
        editType: '',
        setEditingId: vi.fn(),
        setEditValue: vi.fn(),
        setEditType: vi.fn(),
      },
      {
        deleteConfirmId: 'device-1',
        deleteError: 'Cannot delete device',
        setDeleteConfirmId: vi.fn(),
        setDeleteError: vi.fn(),
      },
      {
        handleEdit: vi.fn(),
        handleSave: vi.fn(),
        handleDelete: vi.fn(),
      },
      {
        getDeviceDisplayName: (type: string) => `Display ${type}`,
        deviceModels: [],
      }
    );

    const { rerender } = render(<renderers.actions item={baseDevice} column={baseColumn} />);
    expect(screen.getByText('Cannot delete device')).toBeInTheDocument();

    const renderersMismatch = createDeviceCellRenderers(
      {
        editingId: null,
        editValue: '',
        editType: '',
        setEditingId: vi.fn(),
        setEditValue: vi.fn(),
        setEditType: vi.fn(),
      },
      {
        deleteConfirmId: 'other-device',
        deleteError: 'Cannot delete device',
        setDeleteConfirmId: vi.fn(),
        setDeleteError: vi.fn(),
      },
      {
        handleEdit: vi.fn(),
        handleSave: vi.fn(),
        handleDelete: vi.fn(),
      },
      {
        getDeviceDisplayName: (type: string) => `Display ${type}`,
        deviceModels: [],
      }
    );

    rerender(<renderersMismatch.actions item={baseDevice} column={baseColumn} />);
    expect(screen.queryByText('Cannot delete device')).not.toBeInTheDocument();
  });
});
