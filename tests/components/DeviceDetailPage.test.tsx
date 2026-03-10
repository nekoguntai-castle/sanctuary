import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeviceDetail } from '../../components/DeviceDetail';

const mockNavigate = vi.fn();
const mockIsSecureContext = vi.fn(() => false);
const mockHardwareConnect = vi.fn();
const mockHardwareGetAllXpubs = vi.fn();
const mockHardwareDisconnect = vi.fn();
const mockGetAccountTypeInfo = vi.fn(() => ({
  title: 'Test',
  description: '',
  addressPrefix: '',
}));

let scannerScanPayload: { rawValue: string }[] = [{ rawValue: 'invalid' }];
let scannerErrorPayload: unknown = new Error('camera failed');

const mockCurrentUser = {
  id: 'user-1',
  username: 'alice',
  isAdmin: false,
  preferences: {},
};

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'device-1' }),
  useNavigate: () => mockNavigate,
}));

vi.mock('@yudiel/react-qr-scanner', () => ({
  Scanner: ({ onScan, onError }: any) => (
    <div data-testid="scanner">
      <button onClick={() => onScan(scannerScanPayload)}>Emit scan</button>
      <button onClick={() => onError(scannerErrorPayload)}>Emit error</button>
    </div>
  ),
}));

vi.mock('../../components/DeviceDetail/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/DeviceDetail/index')>();
  return {
    ...actual,
    ManualAccountForm: () => <div data-testid="manual-account-form" />,
    AccountList: () => <div data-testid="account-list" />,
    getAccountTypeInfo: (...args: unknown[]) => mockGetAccountTypeInfo(...args),
  };
});

vi.mock('../../components/TransferOwnershipModal', () => ({
  TransferOwnershipModal: ({ onTransferInitiated, onClose }: any) => (
    <div data-testid="transfer-modal">
      <button onClick={onTransferInitiated}>Initiate transfer</button>
      <button onClick={onClose}>Close transfer</button>
    </div>
  ),
}));

vi.mock('../../components/PendingTransfersPanel', () => ({
  PendingTransfersPanel: ({ onTransferComplete }: any) => (
    <div data-testid="pending-transfers">
      <button onClick={onTransferComplete}>Complete transfer</button>
    </div>
  ),
}));

vi.mock('../../services/deviceParsers', () => ({
  parseDeviceJson: vi.fn(),
}));

vi.mock('../../services/hardwareWallet/environment', () => ({
  isSecureContext: () => mockIsSecureContext(),
}));

vi.mock('../../services/hardwareWallet', () => ({
  hardwareWalletService: {
    connect: (...args: unknown[]) => mockHardwareConnect(...args),
    getAllXpubs: (...args: unknown[]) => mockHardwareGetAllXpubs(...args),
    disconnect: (...args: unknown[]) => mockHardwareDisconnect(...args),
  },
  DeviceType: {},
}));

vi.mock('../../components/ui/CustomIcons', () => ({
  getDeviceIcon: () => <span data-testid="device-icon" />,
  getWalletIcon: () => <span data-testid="wallet-icon" />,
}));

vi.mock('lucide-react', () => ({
  Edit2: () => <span data-testid="edit-icon" />,
  Save: () => <span data-testid="save-icon" />,
  X: () => <span data-testid="x-icon" />,
  ArrowLeft: () => <span data-testid="arrow-left" />,
  ChevronDown: () => <span data-testid="chevron-down" />,
  Users: () => <span data-testid="users-icon" />,
  Shield: () => <span data-testid="shield-icon" />,
  Send: () => <span data-testid="send-icon" />,
  User: () => <span data-testid="user-icon" />,
  Plus: () => <span data-testid="plus-icon" />,
  Loader2: () => <span data-testid="loader-icon" />,
  Usb: () => <span data-testid="usb-icon" />,
  QrCode: () => <span data-testid="qr-icon" />,
  HardDrive: () => <span data-testid="drive-icon" />,
  Camera: () => <span data-testid="camera-icon" />,
  Upload: () => <span data-testid="upload-icon" />,
  AlertCircle: () => <span data-testid="alert-icon" />,
  Check: () => <span data-testid="check-icon" />,
  AlertTriangle: () => <span data-testid="alert-triangle-icon" />,
}));

vi.mock('../../contexts/UserContext', () => ({
  useUser: () => ({
    user: mockCurrentUser,
  }),
}));

vi.mock('../../src/api/devices', () => ({
  getDevice: vi.fn(),
  updateDevice: vi.fn(),
  getDeviceModels: vi.fn(),
  getDeviceShareInfo: vi.fn(),
  shareDeviceWithUser: vi.fn(),
  removeUserFromDevice: vi.fn(),
  shareDeviceWithGroup: vi.fn(),
  addDeviceAccount: vi.fn(),
}));

vi.mock('../../src/api/auth', () => ({
  getUserGroups: vi.fn().mockResolvedValue([]),
  searchUsers: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/api/admin', () => ({
  getGroups: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import * as devicesApi from '../../src/api/devices';
import * as authApi from '../../src/api/auth';
import * as deviceParsers from '../../services/deviceParsers';

const mockGetDevice = vi.mocked(devicesApi.getDevice);
const mockGetDeviceModels = vi.mocked(devicesApi.getDeviceModels);
const mockUpdateDevice = vi.mocked(devicesApi.updateDevice);
const mockGetDeviceShareInfo = vi.mocked(devicesApi.getDeviceShareInfo);
const mockShareDeviceWithUser = vi.mocked(devicesApi.shareDeviceWithUser);
const mockRemoveUserFromDevice = vi.mocked(devicesApi.removeUserFromDevice);
const mockShareDeviceWithGroup = vi.mocked(devicesApi.shareDeviceWithGroup);
const mockAddDeviceAccount = vi.mocked(devicesApi.addDeviceAccount);
const mockSearchUsers = vi.mocked(authApi.searchUsers);
const mockGetUserGroups = vi.mocked(authApi.getUserGroups);
const mockParseDeviceJson = vi.mocked(deviceParsers.parseDeviceJson);

const deviceData = {
  id: 'device-1',
  type: 'passport',
  label: 'Passport One',
  fingerprint: 'abcd1234',
  isOwner: true,
  userRole: 'owner',
  wallets: [{ wallet: { id: 'wallet-1', name: 'Main Wallet', type: 'single_sig' } }],
  accounts: [],
};

describe('DeviceDetail page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockReset();
    mockIsSecureContext.mockReturnValue(false);
    mockHardwareConnect.mockReset();
    mockHardwareGetAllXpubs.mockReset();
    mockHardwareDisconnect.mockReset();
    mockHardwareDisconnect.mockResolvedValue(undefined);
    mockGetAccountTypeInfo.mockReset();
    mockGetAccountTypeInfo.mockReturnValue({ title: 'Test', description: '', addressPrefix: '' });
    scannerScanPayload = [{ rawValue: 'invalid' }];
    scannerErrorPayload = new Error('camera failed');
    mockGetDevice.mockResolvedValue(deviceData as any);
    mockGetDeviceModels.mockResolvedValue([{ slug: 'passport', manufacturer: 'Foundation', name: 'Passport' }] as any);
    mockGetDeviceShareInfo.mockResolvedValue({
      users: [{ id: 'user-1', username: 'alice', role: 'owner' }],
      group: null,
    } as any);
    mockGetUserGroups.mockResolvedValue([{ id: 'g1', name: 'Team A' }] as any);
    mockSearchUsers.mockResolvedValue([]);
    mockShareDeviceWithUser.mockResolvedValue(undefined as any);
    mockRemoveUserFromDevice.mockResolvedValue(undefined as any);
    mockShareDeviceWithGroup.mockResolvedValue(undefined as any);
    mockAddDeviceAccount.mockResolvedValue(undefined as any);
    mockParseDeviceJson.mockReturnValue(null as any);
  });

  it('renders device details after load', async () => {
    render(<DeviceDetail />);

    await waitFor(() => {
      expect(screen.getByText('Passport One')).toBeInTheDocument();
    });

    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getByTestId('device-icon')).toBeInTheDocument();
  });

  it('navigates back and handles device-type select changes in edit mode', async () => {
    const user = userEvent.setup();
    render(<DeviceDetail />);

    await waitFor(() => {
      expect(screen.getByText('Back to Devices')).toBeInTheDocument();
      expect(screen.getByLabelText('Edit label')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Back to Devices'));
    expect(mockNavigate).toHaveBeenCalledWith('/devices');

    await user.click(screen.getByLabelText('Edit label'));
    const modelSelect = screen.getByRole('combobox');
    fireEvent.change(modelSelect, { target: { value: '' } });

    expect((modelSelect as HTMLSelectElement).value).toBe('');
  });

  it('renders not-found state when API returns no device', async () => {
    mockGetDevice.mockResolvedValueOnce(null as any);
    render(<DeviceDetail />);

    await waitFor(() => {
      expect(screen.getByText('Device not found.')).toBeInTheDocument();
    });
  });

  it('allows entering edit mode and canceling', async () => {
    const user = userEvent.setup();
    render(<DeviceDetail />);

    await waitFor(() => {
      expect(screen.getByLabelText('Edit label')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Edit label'));
    expect(screen.getByDisplayValue('Passport One')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Cancel editing'));
    expect(screen.getByText('Passport One')).toBeInTheDocument();
  });

  it('saves updated label', async () => {
    const user = userEvent.setup();
    mockUpdateDevice.mockResolvedValue({ label: 'Passport Updated' } as any);

    render(<DeviceDetail />);

    await waitFor(() => {
      expect(screen.getByLabelText('Edit label')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Edit label'));
    const input = screen.getByDisplayValue('Passport One');
    await user.clear(input);
    await user.type(input, 'Passport Updated');

    await user.click(screen.getByLabelText('Save label'));

    await waitFor(() => {
      expect(mockUpdateDevice).toHaveBeenCalled();
    });
  });

  it('handles access sharing flows for group and user', async () => {
    const user = userEvent.setup();

    mockSearchUsers.mockResolvedValue([{ id: 'user-2', username: 'bob' }] as any);

    render(<DeviceDetail />);

    await screen.findByText('Passport One');

    await user.click(screen.getByRole('button', { name: /access/i }));
    await user.click(screen.getByRole('button', { name: 'sharing' }));

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'g1' } });
    await user.click(screen.getByRole('button', { name: 'Add as Viewer' }));

    await waitFor(() => {
      expect(mockShareDeviceWithGroup).toHaveBeenCalledWith('device-1', { groupId: 'g1' });
    });

    await user.clear(screen.getByPlaceholderText('Add user...'));
    await user.type(screen.getByPlaceholderText('Add user...'), 'bo');

    await waitFor(() => {
      expect(mockSearchUsers).toHaveBeenCalledWith('bo');
    });

    const bob = await screen.findByText('bob');
    const bobRow = bob.parentElement?.parentElement;
    expect(bobRow).not.toBeNull();
    await user.click(within(bobRow as HTMLElement).getByRole('button', { name: 'Add as Viewer' }));

    await waitFor(() => {
      expect(mockShareDeviceWithUser).toHaveBeenCalledWith('device-1', { targetUserId: 'user-2' });
    });
  });

  it('removes shared group and user access', async () => {
    const user = userEvent.setup();

    mockGetDeviceShareInfo.mockResolvedValue({
      users: [
        { id: 'user-1', username: 'alice', role: 'owner' },
        { id: 'user-2', username: 'bob', role: 'viewer' },
      ],
      group: { id: 'g1', name: 'Team A', role: 'viewer' },
    } as any);

    render(<DeviceDetail />);

    await screen.findByText('Passport One');

    await user.click(screen.getByRole('button', { name: /access/i }));
    await user.click(screen.getByRole('button', { name: 'sharing' }));

    const removeIcons = screen.getAllByTestId('x-icon');
    await user.click(removeIcons[0].closest('button')!);
    await user.click(removeIcons[1].closest('button')!);

    await waitFor(() => {
      expect(mockShareDeviceWithGroup).toHaveBeenCalledWith('device-1', { groupId: null });
      expect(mockRemoveUserFromDevice).toHaveBeenCalledWith('device-1', 'user-2');
    });
  });

  it('handles transfer actions from ownership and transfers sub-tabs', async () => {
    const user = userEvent.setup();
    render(<DeviceDetail />);

    await screen.findByText('Passport One');

    await user.click(screen.getByRole('button', { name: /access/i }));
    await user.click(screen.getByText('Transfer'));
    expect(screen.getByTestId('transfer-modal')).toBeInTheDocument();

    await user.click(screen.getByText('Initiate transfer'));
    await waitFor(() => {
      expect(screen.queryByTestId('transfer-modal')).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'transfers' }));
    const callsBeforeComplete = mockGetDevice.mock.calls.length;
    await user.click(screen.getByText('Complete transfer'));

    await waitFor(() => {
      expect(mockGetDevice.mock.calls.length).toBeGreaterThan(callsBeforeComplete);
    });
  });

  it('adds manual account and refreshes device data', async () => {
    const user = userEvent.setup();
    render(<DeviceDetail />);

    await screen.findByText('Passport One');
    await user.click(screen.getByText('Add Derivation Path'));
    await user.click(screen.getByText('Enter Manually'));
    await user.type(screen.getByPlaceholderText('xpub...'), 'xpub-test-value');

    await user.click(screen.getByText('Add Account'));

    await waitFor(() => {
      expect(mockAddDeviceAccount).toHaveBeenCalledWith(
        'device-1',
        expect.objectContaining({
          xpub: 'xpub-test-value',
        })
      );
    });
  });

  it('shows manual account add errors', async () => {
    const user = userEvent.setup();
    mockAddDeviceAccount.mockRejectedValueOnce(new Error('manual add failed'));

    render(<DeviceDetail />);

    await screen.findByText('Passport One');
    await user.click(screen.getByText('Add Derivation Path'));
    await user.click(screen.getByText('Enter Manually'));
    await user.type(screen.getByPlaceholderText('xpub...'), 'xpub-test-value');
    await user.click(screen.getByText('Add Account'));

    expect(await screen.findByText('manual add failed')).toBeInTheDocument();
  });

  it('imports accounts from SD card and adds selected entries', async () => {
    const user = userEvent.setup();

    mockParseDeviceJson.mockReturnValue({
      format: 'json',
      fingerprint: 'abcd1234',
      accounts: [
        {
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/0'",
          xpub: 'xpub-sd-1',
        },
      ],
    } as any);

    render(<DeviceDetail />);

    await screen.findByText('Passport One');
    await user.click(screen.getByText('Add Derivation Path'));
    await user.click(screen.getByText('Import from SD Card'));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, new File(['{}'], 'export.json', { type: 'application/json' }));

    expect(await screen.findByText('Select accounts to add:')).toBeInTheDocument();

    const checkbox = screen.getByRole('checkbox');
    await user.click(checkbox);
    await user.click(checkbox);

    await user.click(screen.getByText('Add 1 Account'));

    await waitFor(() => {
      expect(mockAddDeviceAccount).toHaveBeenCalledWith(
        'device-1',
        expect.objectContaining({
          derivationPath: "m/84'/0'/0'",
          xpub: 'xpub-sd-1',
        })
      );
    });
  });

  it('shows fingerprint mismatch error when imported account belongs to different device', async () => {
    const user = userEvent.setup();

    mockParseDeviceJson.mockReturnValue({
      format: 'json',
      fingerprint: 'ffffffff',
      accounts: [
        {
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/0'",
          xpub: 'xpub-wrong-device',
        },
      ],
    } as any);

    render(<DeviceDetail />);

    await screen.findByText('Passport One');
    await user.click(screen.getByText('Add Derivation Path'));
    await user.click(screen.getByText('Import from SD Card'));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, new File(['{}'], 'export.json', { type: 'application/json' }));

    expect(await screen.findByText(/Fingerprint mismatch/i)).toBeInTheDocument();
  });

  it('renders registered account cards and shared-by state for non-owners', async () => {
    const user = userEvent.setup();

    mockGetDevice.mockResolvedValue({
      ...deviceData,
      isOwner: false,
      userRole: 'viewer',
      sharedBy: 'carol',
      accounts: [
        {
          id: 'acc-1',
          purpose: 'multisig',
          scriptType: 'native_segwit',
          derivationPath: "m/48'/0'/0'/2'",
          xpub: 'xpub-account-1',
        },
        {
          id: 'acc-2',
          purpose: 'single_sig',
          scriptType: 'taproot',
          derivationPath: "m/86'/0'/0'",
          xpub: 'xpub-account-2',
        },
      ],
    } as any);

    mockGetAccountTypeInfo.mockImplementation((account: any) => ({
      title: account.purpose === 'multisig' ? 'Multisig Account' : 'Single Account',
      description: 'Account description',
      addressPrefix: account.scriptType === 'taproot' ? 'bc1p' : 'bc1q',
      recommended: account.purpose === 'multisig',
    }));

    render(<DeviceDetail />);

    await screen.findByText('Passport One');

    expect(screen.getByText(/Shared by carol/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Edit label')).not.toBeInTheDocument();
    expect(screen.queryByText('Add Derivation Path')).not.toBeInTheDocument();

    expect(screen.getByText('Multisig Native SegWit (BIP-48)')).toBeInTheDocument();
    expect(screen.getByText('Taproot (BIP-86)')).toBeInTheDocument();
    expect(screen.getByText('Recommended')).toBeInTheDocument();
    expect(screen.getByText("m/48'/0'/0'/2'")).toBeInTheDocument();
    expect(screen.getByText("m/86'/0'/0'")).toBeInTheDocument();

    await user.click(screen.getByText('Main Wallet'));
    expect(mockNavigate).toHaveBeenCalledWith('/wallets/wallet-1');
  });

  it('does not call user search API for queries shorter than 2 characters', async () => {
    const user = userEvent.setup();
    render(<DeviceDetail />);

    await screen.findByText('Passport One');
    await user.click(screen.getByRole('button', { name: /access/i }));
    await user.click(screen.getByRole('button', { name: 'sharing' }));

    await user.type(screen.getByPlaceholderText('Add user...'), 'b');

    expect(mockSearchUsers).not.toHaveBeenCalled();
  });

  it('shows USB no-new-account message when all fetched paths already exist', async () => {
    const user = userEvent.setup();

    mockIsSecureContext.mockReturnValue(true);
    mockGetDevice.mockResolvedValue({
      ...deviceData,
      type: 'ledger',
      accounts: [
        {
          id: 'acc-existing',
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/0'",
          xpub: 'xpub-existing',
        },
      ],
    } as any);

    mockHardwareConnect.mockResolvedValue({ connected: true });
    mockHardwareGetAllXpubs.mockResolvedValue([
      {
        purpose: 'single_sig',
        scriptType: 'native_segwit',
        path: "m/84'/0'/0'",
        xpub: 'xpub-existing',
        fingerprint: 'abcd1234',
      },
    ]);

    render(<DeviceDetail />);

    await screen.findByText('Passport One');
    await user.click(screen.getByText('Add Derivation Path'));
    await user.click(screen.getByText('Connect via USB'));
    await user.click(screen.getByText('Connect Device'));

    expect(
      await screen.findByText(/No new accounts to add\. All derivation paths already exist on this device\./i)
    ).toBeInTheDocument();
    expect(mockHardwareDisconnect).toHaveBeenCalled();
  });

  it('adds USB-fetched accounts and continues when one add fails', async () => {
    const user = userEvent.setup();

    mockIsSecureContext.mockReturnValue(true);
    mockGetDevice.mockResolvedValue({ ...deviceData, type: 'ledger', accounts: [] } as any);

    mockHardwareConnect.mockResolvedValue({ connected: true });
    mockHardwareGetAllXpubs.mockResolvedValue([
      {
        purpose: 'single_sig',
        scriptType: 'native_segwit',
        path: "m/84'/0'/0'",
        xpub: 'xpub-new-1',
        fingerprint: 'abcd1234',
      },
      {
        purpose: 'single_sig',
        scriptType: 'taproot',
        path: "m/86'/0'/0'",
        xpub: 'xpub-new-2',
        fingerprint: 'abcd1234',
      },
    ]);

    mockAddDeviceAccount
      .mockRejectedValueOnce(new Error('first add failed'))
      .mockResolvedValueOnce(undefined as any);

    render(<DeviceDetail />);

    await screen.findByText('Passport One');
    await user.click(screen.getByText('Add Derivation Path'));
    await user.click(screen.getByText('Connect via USB'));
    await user.click(screen.getByText('Connect Device'));

    await waitFor(() => {
      expect(mockAddDeviceAccount).toHaveBeenCalledTimes(2);
    });
    expect(mockHardwareDisconnect).toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.queryByText('Connect Device')).not.toBeInTheDocument();
      expect(screen.queryByText('← Back to options')).not.toBeInTheDocument();
    });
  });

  it('handles QR camera scan import and adds decoded account', async () => {
    const user = userEvent.setup();

    scannerScanPayload = [{ rawValue: 'qr-payload' }];
    mockParseDeviceJson.mockReturnValue({
      format: 'json',
      fingerprint: 'abcd1234',
      xpub: 'xpub-from-qr',
      derivationPath: "m/84'/0'/5'",
    } as any);

    render(<DeviceDetail />);

    await screen.findByText('Passport One');
    await user.click(screen.getByText('Add Derivation Path'));
    await user.click(screen.getByText('Scan QR Code'));

    expect(screen.getByText(/Camera requires HTTPS/i)).toBeInTheDocument();
    await user.click(screen.getByText('Start Camera'));

    expect(await screen.findByTestId('scanner')).toBeInTheDocument();
    await user.click(screen.getByText('Emit scan'));

    expect(await screen.findByText('Select accounts to add:')).toBeInTheDocument();
    await user.click(screen.getByText('Add 1 Account'));

    await waitFor(() => {
      expect(mockAddDeviceAccount).toHaveBeenCalledWith(
        'device-1',
        expect.objectContaining({
          xpub: 'xpub-from-qr',
          derivationPath: "m/84'/0'/5'",
        })
      );
    });
  });

  it('shows camera permission denied message for NotAllowedError', async () => {
    const user = userEvent.setup();

    scannerErrorPayload = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });

    render(<DeviceDetail />);

    await screen.findByText('Passport One');
    await user.click(screen.getByText('Add Derivation Path'));
    await user.click(screen.getByText('Scan QR Code'));
    await user.click(screen.getByText('Start Camera'));
    await user.click(screen.getByText('Emit error'));

    expect(await screen.findByText(/Camera access denied/i)).toBeInTheDocument();
    expect(screen.getByText('Try Again')).toBeInTheDocument();
  });

  it('shows conflict error for imported account with matching path but different xpub', async () => {
    const user = userEvent.setup();

    mockGetDevice.mockResolvedValue({
      ...deviceData,
      accounts: [
        {
          id: 'acc-1',
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/0'",
          xpub: 'xpub-old',
        },
      ],
    } as any);

    mockParseDeviceJson.mockReturnValue({
      format: 'json',
      fingerprint: 'abcd1234',
      accounts: [
        {
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/0'",
          xpub: 'xpub-different',
        },
      ],
    } as any);

    render(<DeviceDetail />);

    await screen.findByText('Passport One');
    await user.click(screen.getByText('Add Derivation Path'));
    await user.click(screen.getByText('Import from SD Card'));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, new File(['{}'], 'export.json', { type: 'application/json' }));

    expect(await screen.findByText(/conflicting xpubs/i)).toBeInTheDocument();
  });

  it('shows USB connection errors when device connect fails', async () => {
    const user = userEvent.setup();

    mockIsSecureContext.mockReturnValue(true);
    mockGetDevice.mockResolvedValue({ ...deviceData, type: 'ledger', accounts: [] } as any);
    mockHardwareConnect.mockRejectedValue(new Error('usb connect failed'));

    render(<DeviceDetail />);

    await screen.findByText('Passport One');
    await user.click(screen.getByText('Add Derivation Path'));
    await user.click(screen.getByText('Connect via USB'));
    await user.click(screen.getByText('Connect Device'));

    expect(await screen.findByText('usb connect failed')).toBeInTheDocument();
    expect(mockHardwareDisconnect).toHaveBeenCalled();
  });

  it('imports a single-account SD payload and creates selectable account entry', async () => {
    const user = userEvent.setup();

    mockParseDeviceJson.mockReturnValue({
      format: 'json',
      fingerprint: 'abcd1234',
      xpub: 'xpub-single-import',
      derivationPath: "m/48'/0'/0'/1'",
    } as any);

    render(<DeviceDetail />);

    await screen.findByText('Passport One');
    await user.click(screen.getByText('Add Derivation Path'));
    await user.click(screen.getByText('Import from SD Card'));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, new File(['{}'], 'single.json', { type: 'application/json' }));

    expect(await screen.findByText('Select accounts to add:')).toBeInTheDocument();
    expect(screen.getByText("m/48'/0'/0'/1'")).toBeInTheDocument();
  });

  it('toggles QR modes, handles camera close, and non-Error camera failure', async () => {
    const user = userEvent.setup();

    scannerErrorPayload = 'plain-camera-error';

    render(<DeviceDetail />);

    await screen.findByText('Passport One');
    await user.click(screen.getByText('Add Derivation Path'));
    await user.click(screen.getByText('Scan QR Code'));

    await user.click(screen.getByText('File'));
    await user.click(screen.getByText('Camera'));
    await user.click(screen.getByText('Start Camera'));
    await user.click(screen.getByText('Emit error'));

    expect(await screen.findByText(/Failed to access camera/i)).toBeInTheDocument();
    await user.click(screen.getByText('Try Again'));
    expect(await screen.findByTestId('scanner')).toBeInTheDocument();

    const stopCameraButton = document.querySelector('button.absolute') as HTMLButtonElement;
    await user.click(stopCameraButton);
    expect(screen.queryByTestId('scanner')).not.toBeInTheDocument();
  });

  it('updates manual account fields and returns to options', async () => {
    const user = userEvent.setup();

    render(<DeviceDetail />);

    await screen.findByText('Passport One');
    await user.click(screen.getByText('Add Derivation Path'));
    await user.click(screen.getByText('Enter Manually'));

    const [purposeSelect, scriptTypeSelect] = screen.getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(purposeSelect, { target: { value: 'single_sig' } });
    fireEvent.change(scriptTypeSelect, { target: { value: 'legacy' } });
    fireEvent.change(screen.getByPlaceholderText("m/48'/0'/0'/2'"), { target: { value: "m/44'/0'/0'" } });

    expect(purposeSelect.value).toBe('single_sig');
    expect(scriptTypeSelect.value).toBe('legacy');
    expect((screen.getByPlaceholderText("m/48'/0'/0'/2'") as HTMLInputElement).value).toBe("m/44'/0'/0'");

    await user.click(screen.getByText('← Back to options'));
    expect(screen.getByText(/Choose how to add a new derivation path/i)).toBeInTheDocument();
  });

  it('closes transfer modal and switches back to details tab', async () => {
    const user = userEvent.setup();
    render(<DeviceDetail />);

    await screen.findByText('Passport One');
    await user.click(screen.getByRole('button', { name: /access/i }));
    await user.click(screen.getByText('Transfer'));
    expect(screen.getByTestId('transfer-modal')).toBeInTheDocument();

    await user.click(screen.getByText('Close transfer'));
    expect(screen.queryByTestId('transfer-modal')).not.toBeInTheDocument();

    await user.click(screen.getByText('Details'));
    expect(screen.getByText('Associated Wallets')).toBeInTheDocument();
  });

  it('shows QR parse error when scanned payload has no valid account data', async () => {
    const user = userEvent.setup();

    scannerScanPayload = [{ rawValue: 'bad-qr-payload' }];
    mockParseDeviceJson.mockReturnValue(null);

    render(<DeviceDetail />);

    await screen.findByText('Passport One');
    await user.click(screen.getByText('Add Derivation Path'));
    await user.click(screen.getByText('Scan QR Code'));
    await user.click(screen.getByText('Start Camera'));
    await user.click(screen.getByText('Emit scan'));

    expect(await screen.findByText(/Could not find valid account data in QR code/i)).toBeInTheDocument();
  });
});
