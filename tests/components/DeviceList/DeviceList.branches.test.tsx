import { render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import type { Device } from '../../../types';

const {
  mockNavigate,
  mockGetDevices,
  mockGetDeviceModels,
  mockUpdateDevice,
  mockDeleteDevice,
  mockUpdatePreferences,
  extractErrorMessageMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockGetDevices: vi.fn(),
  mockGetDeviceModels: vi.fn(),
  mockUpdateDevice: vi.fn(),
  mockDeleteDevice: vi.fn(),
  mockUpdatePreferences: vi.fn(),
  extractErrorMessageMock: vi.fn((error: unknown, fallback: string) => {
    const message = error instanceof Error ? error.message : '';
    return message || fallback;
  }),
  loggerErrorMock: vi.fn(),
}));

let currentUser: any = null;

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../../../src/api/devices', () => ({
  getDevices: () => mockGetDevices(),
  getDeviceModels: () => mockGetDeviceModels(),
  updateDevice: mockUpdateDevice,
  deleteDevice: mockDeleteDevice,
}));

vi.mock('../../../contexts/UserContext', () => ({
  useUser: () => ({
    user: currentUser,
    updatePreferences: mockUpdatePreferences,
  }),
}));

vi.mock('../../../hooks/useLoadingState', () => ({
  useLoadingState: () => ({
    loading: false,
    execute: async (fn: () => Promise<void>) => {
      await fn();
    },
  }),
}));

vi.mock('../../../utils/errorHandler', () => ({
  extractErrorMessage: extractErrorMessageMock,
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: loggerErrorMock,
  }),
}));

vi.mock('../../../components/DeviceList/EmptyState', () => ({
  EmptyState: () => <div data-testid="empty-state">EMPTY</div>,
}));

vi.mock('../../../components/columns/deviceColumns', () => ({
  DEVICE_COLUMNS: [],
  DEFAULT_DEVICE_COLUMN_ORDER: ['label', 'type', 'fingerprint'],
  DEFAULT_DEVICE_VISIBLE_COLUMNS: ['label', 'type', 'fingerprint'],
  mergeDeviceColumnOrder: (order?: string[]) => order || ['label', 'type', 'fingerprint'],
}));

vi.mock('../../../components/cells/DeviceCells', () => ({
  createDeviceCellRenderers: vi.fn(() => ({})),
}));

vi.mock('../../../components/DeviceList/DeviceListHeader', () => ({
  DeviceListHeader: ({
    setViewMode,
    setOwnershipFilter,
    setWalletFilter,
    onColumnVisibilityChange,
  }: {
    setViewMode: (mode: 'list' | 'grouped') => void;
    setOwnershipFilter: (mode: 'all' | 'owned' | 'shared') => void;
    setWalletFilter: (filter: string) => void;
    onColumnVisibilityChange: (columnId: string, visible: boolean) => void;
  }) => (
    <div>
      <button onClick={() => setViewMode('list')}>Set List</button>
      <button onClick={() => setViewMode('grouped')}>Set Grouped</button>
      <button onClick={() => setOwnershipFilter('owned')}>Filter Owned</button>
      <button onClick={() => setOwnershipFilter('shared')}>Filter Shared</button>
      <button onClick={() => setWalletFilter('w1')}>Filter Wallet W1</button>
      <button onClick={() => setWalletFilter('unassigned')}>Filter Unassigned</button>
      <button onClick={() => onColumnVisibilityChange('type', true)}>Show Type Column</button>
    </div>
  ),
}));

vi.mock('../../../components/ui/ConfigurableTable', () => ({
  ConfigurableTable: ({
    data,
    keyExtractor,
    onSort,
    onRowClick,
  }: {
    data: Device[];
    keyExtractor: (device: Device) => string;
    onSort?: (field: string) => void;
    onRowClick?: (device: Device) => void;
  }) => (
    <div>
      <button onClick={() => onSort?.('label')}>Sort Label</button>
      <button onClick={() => onSort?.('type')}>Sort Type</button>
      <button onClick={() => onSort?.('fingerprint')}>Sort Fingerprint</button>
      <button onClick={() => onSort?.('wallets')}>Sort Wallets</button>
      {data.map((device) => (
        <div
          key={keyExtractor(device)}
          data-testid="table-row"
          onClick={() => onRowClick?.(device)}
        >
          {device.label}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('../../../components/DeviceList/DeviceGroupedView', () => ({
  DeviceGroupedView: ({
    groupedDevices,
    getDeviceDisplayName,
    getWalletCount,
    handleEdit,
    handleSave,
    handleDelete,
  }: {
    groupedDevices: Record<string, Device[]>;
    getDeviceDisplayName: (type: string) => string;
    getWalletCount: (device: Device) => number;
    handleEdit: (device: Device) => void;
    handleSave: (device: Device) => void;
    handleDelete: (device: Device) => void;
  }) => {
    const allDevices = Object.values(groupedDevices).flat();
    const first = allDevices[0];
    return (
      <div data-testid="grouped-view">
        <div data-testid="name-ledger">{getDeviceDisplayName('ledger')}</div>
        <div data-testid="name-mystery">{getDeviceDisplayName('mystery')}</div>
        <div data-testid="name-empty">{getDeviceDisplayName('')}</div>
        {allDevices.map((device, i) => (
          <div key={device.id} data-testid={`wallet-count-${i}`}>
            {getWalletCount(device)}
          </div>
        ))}
        {first && (
          <>
            <button onClick={() => handleEdit(first)}>Edit First</button>
            <button onClick={() => handleSave(first)}>Save First</button>
            <button onClick={() => handleDelete(first)}>Delete First</button>
          </>
        )}
      </div>
    );
  },
}));

import { DeviceList } from '../../../components/DeviceList/DeviceList';

const makeUser = (devicesPrefs: Record<string, unknown>) => ({
  id: 'user-1',
  preferences: {
    viewSettings: {
      devices: devicesPrefs,
    },
  },
});

const makeDevice = (overrides: Partial<Device> = {}): Device => ({
  id: 'device-1',
  userId: 'user-1',
  label: 'Device 1',
  type: 'ledger',
  fingerprint: 'ffff1111',
  xpub: 'xpub-1',
  derivationPath: "m/84'/0'/0'",
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  wallets: [],
  isOwner: true,
  ...overrides,
});

describe('DeviceList branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = null;
    mockGetDevices.mockResolvedValue([]);
    mockGetDeviceModels.mockResolvedValue([]);
    mockUpdateDevice.mockResolvedValue({});
    mockDeleteDevice.mockResolvedValue(undefined);
  });

  it('covers no-user branch and preference fallbacks', async () => {
    render(<DeviceList />);

    expect(await screen.findByTestId('empty-state')).toBeInTheDocument();
    expect(mockGetDevices).not.toHaveBeenCalled();
    expect(mockGetDeviceModels).not.toHaveBeenCalled();
  });

  it('covers sort toggle branch and visible-column add branch', async () => {
    const user = userEvent.setup();
    currentUser = makeUser({
      layout: 'list',
      sortBy: 'label',
      sortOrder: 'desc',
      ownershipFilter: 'all',
      visibleColumns: ['label'],
      columnOrder: ['label'],
    });
    mockGetDevices.mockResolvedValue([makeDevice()]);

    render(<DeviceList />);

    await screen.findByTestId('table-row');

    await user.click(screen.getByRole('button', { name: 'Show Type Column' }));
    await user.click(screen.getByRole('button', { name: 'Sort Label' }));
    await user.click(screen.getByRole('button', { name: 'Sort Type' }));

    expect(mockUpdatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        viewSettings: expect.objectContaining({
          devices: expect.objectContaining({
            visibleColumns: ['label', 'type'],
          }),
        }),
      })
    );
    expect(mockUpdatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        viewSettings: expect.objectContaining({
          devices: expect.objectContaining({
            sortBy: 'label',
            sortOrder: 'asc',
          }),
        }),
      })
    );
  });

  it('covers grouped edit/save unchanged, update error, delete error, and display/wallet fallbacks', async () => {
    const user = userEvent.setup();
    currentUser = makeUser({
      layout: 'grouped',
      sortBy: 'label',
      sortOrder: 'asc',
      ownershipFilter: 'all',
      visibleColumns: ['label', 'type'],
      columnOrder: ['label', 'type'],
    });

    const devices = [
      makeDevice({
        id: 'd1',
        label: 'Alpha',
        type: 'ledger',
        model: undefined,
        walletCount: 7,
      }),
      makeDevice({
        id: 'd2',
        label: 'Beta',
        type: 'trezor',
        walletCount: undefined,
        wallets: [{ wallet: { id: 'w-1', name: 'Wallet 1', type: 'single_sig' } }] as any,
      }),
      makeDevice({
        id: 'd3',
        label: 'Gamma',
        type: 'keystone',
        walletCount: undefined,
        wallets: undefined,
      }),
    ];
    mockGetDevices.mockResolvedValue(devices);
    mockGetDeviceModels.mockResolvedValue([{ slug: 'ledger', name: 'Ledger X' }]);

    render(<DeviceList />);
    await screen.findByTestId('grouped-view');

    expect(screen.getByTestId('name-ledger')).toHaveTextContent('Ledger X');
    expect(screen.getByTestId('name-mystery')).toHaveTextContent('mystery');
    expect(screen.getByTestId('name-empty')).toHaveTextContent('Unknown Device');
    expect(screen.getByTestId('wallet-count-0')).toHaveTextContent('7');
    expect(screen.getByTestId('wallet-count-1')).toHaveTextContent('1');
    expect(screen.getByTestId('wallet-count-2')).toHaveTextContent('0');

    await user.click(screen.getByRole('button', { name: 'Edit First' }));
    await user.click(screen.getByRole('button', { name: 'Save First' }));
    await waitFor(() => {
      expect(mockUpdateDevice).toHaveBeenCalledWith('d1', {});
    });

    mockUpdateDevice.mockRejectedValueOnce(new Error('update failed'));
    await user.click(screen.getByRole('button', { name: 'Save First' }));
    await waitFor(() => {
      expect(loggerErrorMock).toHaveBeenCalledWith('Failed to update device', expect.any(Object));
    });

    mockDeleteDevice.mockRejectedValueOnce(new Error('delete failed'));
    await user.click(screen.getByRole('button', { name: 'Delete First' }));
    await waitFor(() => {
      expect(loggerErrorMock).toHaveBeenCalledWith('Failed to delete device', expect.any(Object));
      expect(extractErrorMessageMock).toHaveBeenCalledWith(expect.any(Error), 'Failed to delete device');
    });
  });

  it('covers ownership filters and sort switch branches', async () => {
    const devices = [
      makeDevice({ id: 'o1', label: 'Owned Trezor', isOwner: true, type: 'trezor', fingerprint: 'ccc', walletCount: 1 }),
      makeDevice({ id: 'o2', label: 'Owned Ledger', isOwner: true, type: 'ledger', fingerprint: 'aaa', wallets: [{ wallet: { id: 'w1', name: 'W1', type: 'single_sig' } }] as any, walletCount: undefined }),
      makeDevice({ id: 's1', label: 'Shared Coldcard', isOwner: false, type: 'coldcard', fingerprint: 'bbb', walletCount: 3 }),
      makeDevice({ id: 's2', label: 'Shared Bitbox', isOwner: false, type: 'bitbox', fingerprint: 'ddd', walletCount: 0 }),
      makeDevice({ id: 'z1', label: 'Unknown Wallets 1', isOwner: true, type: 'jade', fingerprint: 'eee', walletCount: undefined, wallets: undefined }),
      makeDevice({ id: 'z2', label: 'Unknown Wallets 2', isOwner: false, type: 'passport', fingerprint: 'fff', walletCount: undefined, wallets: undefined }),
    ];
    mockGetDevices.mockResolvedValue(devices);

    currentUser = makeUser({
      layout: 'list',
      sortBy: 'type',
      sortOrder: 'asc',
      ownershipFilter: 'owned',
      visibleColumns: ['label'],
      columnOrder: ['label'],
    });
    const ownedView = render(<DeviceList />);
    await waitFor(() => {
      const rows = screen.getAllByTestId('table-row').map(row => row.textContent);
      expect(rows).toEqual(['Unknown Wallets 1', 'Owned Ledger', 'Owned Trezor']);
    });
    ownedView.unmount();

    currentUser = makeUser({
      layout: 'list',
      sortBy: 'fingerprint',
      sortOrder: 'asc',
      ownershipFilter: 'shared',
      visibleColumns: ['label'],
      columnOrder: ['label'],
    });
    const sharedView = render(<DeviceList />);
    await waitFor(() => {
      const rows = screen.getAllByTestId('table-row').map(row => row.textContent);
      expect(rows).toEqual(['Shared Coldcard', 'Shared Bitbox', 'Unknown Wallets 2']);
    });
    sharedView.unmount();

    currentUser = makeUser({
      layout: 'list',
      sortBy: 'wallets',
      sortOrder: 'desc',
      ownershipFilter: 'all',
      visibleColumns: ['label'],
      columnOrder: ['label'],
    });
    const walletsView = render(<DeviceList />);
    await waitFor(() => {
      const rows = screen.getAllByTestId('table-row').map(row => row.textContent);
      expect(rows[0]).toBe('Shared Coldcard');
    });
    walletsView.unmount();

    currentUser = makeUser({
      layout: 'list',
      sortBy: 'unknown',
      sortOrder: 'asc',
      ownershipFilter: 'all',
      visibleColumns: ['label'],
      columnOrder: ['label'],
    });
    render(<DeviceList />);
    await waitFor(() => {
      expect(screen.getAllByTestId('table-row').length).toBe(6);
    });
  });

  it('covers wallet filter by specific wallet ID', async () => {
    const devices = [
      makeDevice({ id: 'd1', label: 'In W1', wallets: [{ wallet: { id: 'w1', name: 'Wallet 1', type: 'single_sig' } }] as any }),
      makeDevice({ id: 'd2', label: 'In W2', wallets: [{ wallet: { id: 'w2', name: 'Wallet 2', type: 'multi_sig' } }] as any }),
      makeDevice({ id: 'd3', label: 'Unused', wallets: [] }),
    ];
    mockGetDevices.mockResolvedValue(devices);

    currentUser = makeUser({
      layout: 'list',
      sortBy: 'label',
      sortOrder: 'asc',
      ownershipFilter: 'all',
      walletFilter: 'w1',
      visibleColumns: ['label'],
      columnOrder: ['label'],
    });
    render(<DeviceList />);
    await waitFor(() => {
      const rows = screen.getAllByTestId('table-row').map(row => row.textContent);
      expect(rows).toEqual(['In W1']);
    });
  });

  it('covers wallet filter for unassigned devices', async () => {
    const devices = [
      makeDevice({ id: 'd1', label: 'In Wallet', wallets: [{ wallet: { id: 'w1', name: 'Wallet 1', type: 'single_sig' } }] as any }),
      makeDevice({ id: 'd2', label: 'Unused 1', wallets: [], walletCount: 0 }),
      makeDevice({ id: 'd3', label: 'Unused 2', wallets: [], walletCount: 0 }),
    ];
    mockGetDevices.mockResolvedValue(devices);

    currentUser = makeUser({
      layout: 'list',
      sortBy: 'label',
      sortOrder: 'asc',
      ownershipFilter: 'all',
      walletFilter: 'unassigned',
      visibleColumns: ['label'],
      columnOrder: ['label'],
    });
    render(<DeviceList />);
    await waitFor(() => {
      const rows = screen.getAllByTestId('table-row').map(row => row.textContent);
      expect(rows).toEqual(['Unused 1', 'Unused 2']);
    });
  });

  it('resets stale wallet filter to all when wallet no longer exists', async () => {
    const devices = [
      makeDevice({ id: 'd1', label: 'Device A', wallets: [{ wallet: { id: 'w1', name: 'Wallet 1', type: 'single_sig' } }] as any }),
      makeDevice({ id: 'd2', label: 'Device B', wallets: [] }),
    ];
    mockGetDevices.mockResolvedValue(devices);

    // walletFilter references a wallet that doesn't exist in device data
    currentUser = makeUser({
      layout: 'list',
      sortBy: 'label',
      sortOrder: 'asc',
      ownershipFilter: 'all',
      walletFilter: 'deleted-wallet-id',
      visibleColumns: ['label'],
      columnOrder: ['label'],
    });
    render(<DeviceList />);
    await waitFor(() => {
      // Should show all devices since filter is invalid
      expect(screen.getAllByTestId('table-row').length).toBe(2);
    });
  });

  it('shows wallet summary banner with exclusive count', async () => {
    const devices = [
      makeDevice({ id: 'd1', label: 'Exclusive Device', wallets: [{ wallet: { id: 'w1', name: 'Wallet 1', type: 'single_sig' } }] as any }),
      makeDevice({ id: 'd2', label: 'Multi Device', wallets: [
        { wallet: { id: 'w1', name: 'Wallet 1', type: 'single_sig' } },
        { wallet: { id: 'w2', name: 'Wallet 2', type: 'multi_sig' } },
      ] as any }),
    ];
    mockGetDevices.mockResolvedValue(devices);

    currentUser = makeUser({
      layout: 'list',
      sortBy: 'label',
      sortOrder: 'asc',
      ownershipFilter: 'all',
      walletFilter: 'w1',
      visibleColumns: ['label'],
      columnOrder: ['label'],
    });
    render(<DeviceList />);
    await waitFor(() => {
      expect(screen.getByText(/Showing 2 devices linked to this wallet/)).toBeInTheDocument();
      expect(screen.getByText(/is exclusive to this wallet/)).toBeInTheDocument();
    });

    // Test clear filter button
    const user = userEvent.setup();
    await user.click(screen.getByText('Clear filter'));
    expect(mockUpdatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        viewSettings: expect.objectContaining({
          devices: expect.objectContaining({ walletFilter: 'all' }),
        }),
      })
    );
  });

  it('shows unassigned summary banner', async () => {
    const devices = [
      makeDevice({ id: 'd1', label: 'Unused 1', wallets: [], walletCount: 0 }),
    ];
    mockGetDevices.mockResolvedValue(devices);

    currentUser = makeUser({
      layout: 'list',
      sortBy: 'label',
      sortOrder: 'asc',
      ownershipFilter: 'all',
      walletFilter: 'unassigned',
      visibleColumns: ['label'],
      columnOrder: ['label'],
    });
    render(<DeviceList />);
    await waitFor(() => {
      expect(screen.getByText(/Showing 1 unassigned device/)).toBeInTheDocument();
    });

    // Test clear filter button
    const user = userEvent.setup();
    await user.click(screen.getByText('Clear filter'));
    expect(mockUpdatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        viewSettings: expect.objectContaining({
          devices: expect.objectContaining({ walletFilter: 'all' }),
        }),
      })
    );
  });

  it('shows plural exclusive count in summary banner', async () => {
    const devices = [
      makeDevice({ id: 'd1', label: 'Excl 1', wallets: [{ wallet: { id: 'w1', name: 'W1', type: 'single_sig' } }] as any }),
      makeDevice({ id: 'd2', label: 'Excl 2', wallets: [{ wallet: { id: 'w1', name: 'W1', type: 'single_sig' } }] as any }),
    ];
    mockGetDevices.mockResolvedValue(devices);

    currentUser = makeUser({
      layout: 'list',
      sortBy: 'label',
      sortOrder: 'asc',
      ownershipFilter: 'all',
      walletFilter: 'w1',
      visibleColumns: ['label'],
      columnOrder: ['label'],
    });
    render(<DeviceList />);
    await waitFor(() => {
      expect(screen.getByText(/are exclusive to this wallet/)).toBeInTheDocument();
    });
  });

  it('shows singular device text in wallet banner', async () => {
    const devices = [
      makeDevice({ id: 'd1', label: 'Only One', wallets: [{ wallet: { id: 'w1', name: 'W1', type: 'single_sig' } }] as any }),
    ];
    mockGetDevices.mockResolvedValue(devices);

    currentUser = makeUser({
      layout: 'list',
      sortBy: 'label',
      sortOrder: 'asc',
      ownershipFilter: 'all',
      walletFilter: 'w1',
      visibleColumns: ['label'],
      columnOrder: ['label'],
    });
    render(<DeviceList />);
    await waitFor(() => {
      expect(screen.getByText(/Showing 1 device linked to this wallet/)).toBeInTheDocument();
    });
  });

  it('shows plural unassigned text in banner', async () => {
    const devices = [
      makeDevice({ id: 'd1', label: 'U1', wallets: [], walletCount: 0 }),
      makeDevice({ id: 'd2', label: 'U2', wallets: [], walletCount: 0 }),
    ];
    mockGetDevices.mockResolvedValue(devices);

    currentUser = makeUser({
      layout: 'list',
      sortBy: 'label',
      sortOrder: 'asc',
      ownershipFilter: 'all',
      walletFilter: 'unassigned',
      visibleColumns: ['label'],
      columnOrder: ['label'],
    });
    render(<DeviceList />);
    await waitFor(() => {
      expect(screen.getByText(/Showing 2 unassigned devices/)).toBeInTheDocument();
    });
  });

  it('hides exclusive count when no devices are exclusive', async () => {
    const devices = [
      makeDevice({ id: 'd1', label: 'Multi', wallets: [
        { wallet: { id: 'w1', name: 'W1', type: 'single_sig' } },
        { wallet: { id: 'w2', name: 'W2', type: 'multi_sig' } },
      ] as any }),
    ];
    mockGetDevices.mockResolvedValue(devices);

    currentUser = makeUser({
      layout: 'list',
      sortBy: 'label',
      sortOrder: 'asc',
      ownershipFilter: 'all',
      walletFilter: 'w1',
      visibleColumns: ['label'],
      columnOrder: ['label'],
    });
    render(<DeviceList />);
    await waitFor(() => {
      expect(screen.getByText(/Showing 1 device linked to this wallet/)).toBeInTheDocument();
      expect(screen.queryByText(/exclusive/)).not.toBeInTheDocument();
    });
  });

  it('covers unassigned filter with undefined walletCount and wallets', async () => {
    const devices = [
      makeDevice({ id: 'd1', label: 'Undefined Both', wallets: undefined, walletCount: undefined }),
    ];
    mockGetDevices.mockResolvedValue(devices);

    currentUser = makeUser({
      layout: 'list',
      sortBy: 'label',
      sortOrder: 'asc',
      ownershipFilter: 'all',
      walletFilter: 'unassigned',
      visibleColumns: ['label'],
      columnOrder: ['label'],
    });
    render(<DeviceList />);
    await waitFor(() => {
      expect(screen.getAllByTestId('table-row').length).toBe(1);
    });
  });

  it('covers exclusive computation with undefined wallets', async () => {
    const devices = [
      makeDevice({ id: 'd1', label: 'No Wallets', wallets: undefined, walletCount: 0 }),
      makeDevice({ id: 'd2', label: 'Has Wallet', wallets: [{ wallet: { id: 'w1', name: 'W1', type: 'single_sig' } }] as any }),
    ];
    mockGetDevices.mockResolvedValue(devices);

    currentUser = makeUser({
      layout: 'list',
      sortBy: 'label',
      sortOrder: 'asc',
      ownershipFilter: 'all',
      walletFilter: 'w1',
      visibleColumns: ['label'],
      columnOrder: ['label'],
    });
    render(<DeviceList />);
    await waitFor(() => {
      // Only 'Has Wallet' should show; 'd1' filtered out (no wallets)
      const rows = screen.getAllByTestId('table-row').map(r => r.textContent);
      expect(rows).toEqual(['Has Wallet']);
    });
  });

  it('covers wallet filter setter via header button', async () => {
    const user = userEvent.setup();
    const devices = [makeDevice()];
    mockGetDevices.mockResolvedValue(devices);

    currentUser = makeUser({
      layout: 'list',
      sortBy: 'label',
      sortOrder: 'asc',
      ownershipFilter: 'all',
      visibleColumns: ['label'],
      columnOrder: ['label'],
    });
    render(<DeviceList />);
    await screen.findByTestId('table-row');

    await user.click(screen.getByRole('button', { name: 'Filter Wallet W1' }));
    expect(mockUpdatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        viewSettings: expect.objectContaining({
          devices: expect.objectContaining({
            walletFilter: 'w1',
          }),
        }),
      })
    );
  });
});
