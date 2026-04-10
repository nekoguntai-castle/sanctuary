/**
 * DeviceList Component Tests
 *
 * Tests for the device list display including view modes,
 * sorting, filtering, editing, and deletion.
 */

import { render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import type { Device,HardwareDeviceModel } from '../../types';

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

// Mock UserContext
const mockUpdatePreferences = vi.fn();
const mockUser = {
  id: 'user-123',
  preferences: {
    viewSettings: {
      devices: {
        layout: 'list',
        sortBy: 'label',
        sortOrder: 'asc',
        ownershipFilter: 'all',
      },
    },
  },
};

const resetUserPreferences = () => {
  mockUser.preferences = {
    viewSettings: {
      devices: {
        layout: 'list',
        sortBy: 'label',
        sortOrder: 'asc',
        ownershipFilter: 'all',
      },
    },
  };
};
vi.mock('../../contexts/UserContext', () => ({
  useUser: () => ({
    user: mockUser,
    updatePreferences: mockUpdatePreferences,
  }),
}));

// Mock device API
const mockGetDevices = vi.fn();
const mockUpdateDevice = vi.fn();
const mockDeleteDevice = vi.fn();
const mockGetDeviceModels = vi.fn();

vi.mock('../../src/api/devices', () => ({
  getDevices: () => mockGetDevices(),
  updateDevice: (...args: unknown[]) => mockUpdateDevice(...args),
  deleteDevice: (...args: unknown[]) => mockDeleteDevice(...args),
  getDeviceModels: () => mockGetDeviceModels(),
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  HardDrive: () => <span data-testid="hard-drive-icon" />,
  Plus: () => <span data-testid="plus-icon" />,
  LayoutGrid: () => <span data-testid="grid-icon" />,
  List: () => <span data-testid="list-icon" />,
  Users: () => <span data-testid="users-icon" />,
  User: () => <span data-testid="user-icon" />,
  Edit2: () => <span data-testid="edit-icon" />,
  Save: () => <span data-testid="save-icon" />,
  X: () => <span data-testid="x-icon" />,
  Trash2: () => <span data-testid="trash-icon" />,
  Wallet: () => <span data-testid="wallet-icon-lucide" />,
  ChevronDown: () => <span data-testid="chevron-down-icon" />,
}));

// Mock custom icons
vi.mock('../../components/ui/CustomIcons', () => ({
  getDeviceIcon: () => <span data-testid="device-icon" />,
  getWalletIcon: () => <span data-testid="wallet-icon" />,
}));

// Mock Button
vi.mock('../../components/ui/Button', () => ({
  Button: ({ children, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick} {...props}>{children}</button>
  ),
}));

// Mock ConfigurableTable
vi.mock('../../components/ui/ConfigurableTable', () => ({
  ConfigurableTable: ({
    data,
    onRowClick,
    onSort,
  }: {
    data: unknown[];
    onRowClick?: (item: unknown) => void;
    onSort?: (field: string) => void;
  }) => (
    <div>
      <button onClick={() => onSort?.('label')}>Sort Label</button>
      <button onClick={() => onSort?.('type')}>Sort Type</button>
      <table data-testid="configurable-table">
        <tbody>
          {data.map((item: unknown, index) => (
            <tr key={index} onClick={() => onRowClick?.(item)} data-testid="device-row">
              <td>{(item as Device).label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ),
}));

// Mock ColumnConfigButton
vi.mock('../../components/ui/ColumnConfigButton', () => ({
  ColumnConfigButton: ({
    onOrderChange,
    onVisibilityChange,
    onReset,
  }: {
    onOrderChange: (order: string[]) => void;
    onVisibilityChange: (columnId: string, visible: boolean) => void;
    onReset: () => void;
  }) => (
    <div>
      <button data-testid="column-config-button">Columns</button>
      <button onClick={() => onOrderChange(['type', 'label', 'fingerprint'])}>Change Order</button>
      <button onClick={() => onVisibilityChange('type', false)}>Hide Type</button>
      <button onClick={onReset}>Reset Columns</button>
    </div>
  ),
}));

// Mock device column utilities
vi.mock('../../components/columns/deviceColumns', () => ({
  DEVICE_COLUMNS: [],
  DEFAULT_DEVICE_COLUMN_ORDER: ['label', 'type', 'fingerprint'],
  DEFAULT_DEVICE_VISIBLE_COLUMNS: ['label', 'type', 'fingerprint'],
  mergeDeviceColumnOrder: (order?: string[]) => order || ['label', 'type', 'fingerprint'],
}));

// Mock cell renderers
vi.mock('../../components/cells/DeviceCells', () => ({
  createDeviceCellRenderers: () => ({}),
}));

// Create mock device
const createMockModel = (overrides: Partial<HardwareDeviceModel> = {}): HardwareDeviceModel => ({
  id: 'model-1',
  slug: 'ledger-nano-s',
  name: 'Ledger Nano S',
  manufacturer: 'Ledger',
  connectivity: ['usb'],
  secureElement: true,
  openSource: false,
  airGapped: false,
  supportsBitcoinOnly: false,
  supportsMultisig: true,
  supportsTaproot: true,
  supportsPassphrase: true,
  scriptTypes: ['native_segwit', 'nested_segwit', 'taproot'],
  hasScreen: true,
  integrationTested: true,
  discontinued: false,
  ...overrides,
});

const createMockDevice = (overrides: Partial<Device> = {}): Device => ({
  id: 'device-1',
  userId: 'user-123',
  label: 'My Ledger',
  type: 'ledger',
  fingerprint: 'abc123def',
  xpub: 'xpub661MyMwAqRbcF...',
  derivationPath: "m/84'/0'/0'",
  model: createMockModel(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  wallets: [],
  isOwner: true,
  ...overrides,
});

const mockDeviceModels: HardwareDeviceModel[] = [
  createMockModel(),
  createMockModel({
    id: 'model-2',
    slug: 'trezor-model-t',
    name: 'Trezor Model T',
    manufacturer: 'Trezor',
    secureElement: false,
    openSource: true,
  }),
];

describe('DeviceList Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetUserPreferences();
    mockGetDevices.mockResolvedValue([]);
    mockGetDeviceModels.mockResolvedValue(mockDeviceModels);
  });

  it('should render empty state when no devices', async () => {
    mockGetDevices.mockResolvedValue([]);

    const { DeviceList } = await import('../../components/DeviceList');

    render(<DeviceList />);

    await waitFor(() => {
      expect(mockGetDevices).toHaveBeenCalled();
    });
  });

  it('should render devices in the list', async () => {
    const devices = [
      createMockDevice({ id: 'device-1', label: 'My Ledger' }),
      createMockDevice({ id: 'device-2', label: 'My Trezor', type: 'trezor' }),
    ];
    mockGetDevices.mockResolvedValue(devices);

    const { DeviceList } = await import('../../components/DeviceList');

    render(<DeviceList />);

    await waitFor(() => {
      expect(screen.getByText('My Ledger')).toBeInTheDocument();
      expect(screen.getByText('My Trezor')).toBeInTheDocument();
    });
  });

  it('should render add device button', async () => {
    mockGetDevices.mockResolvedValue([]);

    const { DeviceList } = await import('../../components/DeviceList');

    render(<DeviceList />);

    await waitFor(() => {
      expect(screen.getByTestId('plus-icon')).toBeInTheDocument();
    });
  });
});

describe('DeviceList - View Modes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetUserPreferences();
    mockGetDevices.mockResolvedValue([createMockDevice()]);
    mockGetDeviceModels.mockResolvedValue(mockDeviceModels);
  });

  it('should render list view by default', async () => {
    const { DeviceList } = await import('../../components/DeviceList');

    render(<DeviceList />);

    await waitFor(() => {
      expect(screen.getByTestId('configurable-table')).toBeInTheDocument();
    });
  });
});

describe('DeviceList - Ownership Filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetUserPreferences();
    mockGetDeviceModels.mockResolvedValue(mockDeviceModels);
  });

  it('should show all devices by default', async () => {
    const devices = [
      createMockDevice({ id: 'device-1', label: 'Owned Device', isOwner: true }),
      createMockDevice({ id: 'device-2', label: 'Shared Device', isOwner: false }),
    ];
    mockGetDevices.mockResolvedValue(devices);

    const { DeviceList } = await import('../../components/DeviceList');

    render(<DeviceList />);

    await waitFor(() => {
      expect(screen.getByText('Owned Device')).toBeInTheDocument();
      expect(screen.getByText('Shared Device')).toBeInTheDocument();
    });
  });
});

describe('DeviceList - Device Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetUserPreferences();
    mockGetDevices.mockResolvedValue([createMockDevice()]);
    mockGetDeviceModels.mockResolvedValue(mockDeviceModels);
  });

  it('should navigate to device detail on row click', async () => {
    const devices = [createMockDevice({ id: 'device-123' })];
    mockGetDevices.mockResolvedValue(devices);

    const { DeviceList } = await import('../../components/DeviceList');
    const user = userEvent.setup();

    render(<DeviceList />);

    await waitFor(() => {
      expect(screen.getByText('My Ledger')).toBeInTheDocument();
    });

    const row = screen.getByTestId('device-row');
    await user.click(row);

    expect(mockNavigate).toHaveBeenCalledWith('/devices/device-123');
  });
});

describe('DeviceList - Column Configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetUserPreferences();
    mockGetDevices.mockResolvedValue([createMockDevice()]);
    mockGetDeviceModels.mockResolvedValue(mockDeviceModels);
  });

  it('should render column configuration button', async () => {
    const { DeviceList } = await import('../../components/DeviceList');

    render(<DeviceList />);

    await waitFor(() => {
      expect(screen.getByTestId('column-config-button')).toBeInTheDocument();
    });
  });

  it('updates preferences for column order, visibility, reset, and sort changes', async () => {
    const { DeviceList } = await import('../../components/DeviceList');
    const user = userEvent.setup();

    render(<DeviceList />);

    await waitFor(() => {
      expect(screen.getByTestId('configurable-table')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Change Order'));
    await user.click(screen.getByText('Hide Type'));
    await user.click(screen.getByText('Reset Columns'));
    await user.click(screen.getByText('Sort Label'));
    await user.click(screen.getByText('Sort Type'));

    expect(mockUpdatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        viewSettings: expect.objectContaining({
          devices: expect.objectContaining({
            columnOrder: ['type', 'label', 'fingerprint'],
          }),
        }),
      })
    );
    expect(mockUpdatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        viewSettings: expect.objectContaining({
          devices: expect.objectContaining({
            visibleColumns: ['label', 'fingerprint'],
          }),
        }),
      })
    );
    expect(mockUpdatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        viewSettings: expect.objectContaining({
          devices: expect.objectContaining({
            columnOrder: ['label', 'type', 'fingerprint'],
            visibleColumns: ['label', 'type', 'fingerprint'],
          }),
        }),
      })
    );
    expect(mockUpdatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        viewSettings: expect.objectContaining({
          devices: expect.objectContaining({
            sortBy: 'label',
            sortOrder: 'desc',
          }),
        }),
      })
    );
    expect(mockUpdatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        viewSettings: expect.objectContaining({
          devices: expect.objectContaining({
            sortBy: 'type',
            sortOrder: 'asc',
          }),
        }),
      })
    );
  });
});

describe('DeviceList - Grouped Mode Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetUserPreferences();
    mockUser.preferences.viewSettings.devices.layout = 'grouped';
    mockGetDeviceModels.mockResolvedValue(mockDeviceModels);
  });

  it('renders grouped view and supports editing/saving a device', async () => {
    const user = userEvent.setup();
    mockUpdateDevice.mockResolvedValue({ label: 'Renamed Device' });
    mockGetDevices.mockResolvedValue([
      createMockDevice({
        id: 'device-edit',
        label: 'Edit Me',
        model: { slug: 'ledger-nano-s' } as any,
      }),
    ]);

    const { DeviceList } = await import('../../components/DeviceList');
    render(<DeviceList />);

    await waitFor(() => {
      expect(screen.getByText('Edit Me')).toBeInTheDocument();
    });

    const editButton = screen.getByTestId('edit-icon').closest('button') as HTMLButtonElement;
    await user.click(editButton);
    const labelInput = screen.getByDisplayValue('Edit Me');
    await user.clear(labelInput);
    await user.type(labelInput, 'Renamed Device');
    await user.selectOptions(screen.getByRole('combobox'), 'trezor-model-t');

    await user.click(screen.getByLabelText('Save device'));

    await waitFor(() => {
      expect(mockUpdateDevice).toHaveBeenCalledWith('device-edit', {
        label: 'Renamed Device',
        modelSlug: 'trezor-model-t',
      });
    });
    expect(screen.getByText('Renamed Device')).toBeInTheDocument();
  });

  it('shows delete confirmation and removes device after delete', async () => {
    const user = userEvent.setup();
    mockDeleteDevice.mockResolvedValue(undefined);
    mockGetDevices.mockResolvedValue([
      createMockDevice({
        id: 'device-delete',
        label: 'Delete Me',
        wallets: [],
        walletCount: 0,
      }),
    ]);

    const { DeviceList } = await import('../../components/DeviceList');
    render(<DeviceList />);

    await waitFor(() => {
      expect(screen.getByText('Delete Me')).toBeInTheDocument();
    });

    await user.click(screen.getByTitle('Delete device'));
    expect(screen.getByText('Delete?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() => {
      expect(mockDeleteDevice).toHaveBeenCalledWith('device-delete');
    });

    expect(screen.queryByText('Delete Me')).not.toBeInTheDocument();
  });
});

describe('DeviceList - Preference Controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetUserPreferences();
    mockGetDeviceModels.mockResolvedValue(mockDeviceModels);
    mockGetDevices.mockResolvedValue([
      createMockDevice({ id: 'owned-1', label: 'Owned Device', isOwner: true }),
      createMockDevice({ id: 'shared-1', label: 'Shared Device', isOwner: false }),
    ]);
  });

  it('updates preferences from ownership and view mode controls', async () => {
    const user = userEvent.setup();
    const { DeviceList } = await import('../../components/DeviceList');
    render(<DeviceList />);

    await waitFor(() => {
      expect(screen.getByText('Owned (1)')).toBeInTheDocument();
      expect(screen.getByText('Shared (1)')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Owned (1)'));
    await user.click(screen.getByText('Shared (1)'));
    await user.click(screen.getByTitle('Grouped View'));

    expect(mockUpdatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        viewSettings: expect.objectContaining({
          devices: expect.objectContaining({ ownershipFilter: 'owned' }),
        }),
      })
    );
    expect(mockUpdatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        viewSettings: expect.objectContaining({
          devices: expect.objectContaining({ ownershipFilter: 'shared' }),
        }),
      })
    );
    expect(mockUpdatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        viewSettings: expect.objectContaining({
          devices: expect.objectContaining({ layout: 'grouped' }),
        }),
      })
    );
  });

  it('navigates to connect page from connect new device button', async () => {
    const user = userEvent.setup();
    const { DeviceList } = await import('../../components/DeviceList');
    render(<DeviceList />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /connect new device/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /connect new device/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/devices/connect');
  });
});
