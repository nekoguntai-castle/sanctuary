import { beforeEach, vi } from 'vitest';

import { DeviceDetail } from '../../../components/DeviceDetail';

const deviceDetailMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  isSecureContext: vi.fn(() => false),
  hardwareConnect: vi.fn(),
  hardwareGetAllXpubs: vi.fn(),
  hardwareDisconnect: vi.fn(),
  getAccountTypeInfo: vi.fn((_account?: any) => ({
    title: 'Test',
    description: '',
    addressPrefix: '',
  })),
  getDevice: vi.fn(),
  updateDevice: vi.fn(),
  getDeviceModels: vi.fn(),
  getDeviceShareInfo: vi.fn(),
  shareDeviceWithUser: vi.fn(),
  removeUserFromDevice: vi.fn(),
  shareDeviceWithGroup: vi.fn(),
  addDeviceAccount: vi.fn(),
  searchUsers: vi.fn(),
  getUserGroups: vi.fn(),
  parseDeviceJson: vi.fn(),
  scannerScanPayload: [{ rawValue: 'invalid' }] as { rawValue: string }[],
  scannerErrorPayload: new Error('camera failed') as unknown,
}));

export const mocks = deviceDetailMocks;
export const DeviceDetailComponent = DeviceDetail;

const mockCurrentUser = {
  id: 'user-1',
  username: 'alice',
  isAdmin: false,
  preferences: {},
};

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'device-1' }),
  useNavigate: () => deviceDetailMocks.navigate,
}));

vi.mock('@yudiel/react-qr-scanner', () => ({
  Scanner: ({ onScan, onError }: any) => (
    <div data-testid="scanner">
      <button onClick={() => onScan(deviceDetailMocks.scannerScanPayload)}>Emit scan</button>
      <button onClick={() => onError(deviceDetailMocks.scannerErrorPayload)}>Emit error</button>
    </div>
  ),
}));

vi.mock('../../../components/DeviceDetail/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../components/DeviceDetail/index')>();
  return {
    ...actual,
    ManualAccountForm: () => <div data-testid="manual-account-form" />,
    AccountList: () => <div data-testid="account-list" />,
    getAccountTypeInfo: deviceDetailMocks.getAccountTypeInfo,
  };
});

vi.mock('../../../components/TransferOwnershipModal', () => ({
  TransferOwnershipModal: ({ onTransferInitiated, onClose }: any) => (
    <div data-testid="transfer-modal">
      <button onClick={onTransferInitiated}>Initiate transfer</button>
      <button onClick={onClose}>Close transfer</button>
    </div>
  ),
}));

vi.mock('../../../components/PendingTransfersPanel', () => ({
  PendingTransfersPanel: ({ onTransferComplete }: any) => (
    <div data-testid="pending-transfers">
      <button onClick={onTransferComplete}>Complete transfer</button>
    </div>
  ),
}));

vi.mock('../../../services/deviceParsers', () => ({
  parseDeviceJson: deviceDetailMocks.parseDeviceJson,
}));

vi.mock('../../../services/hardwareWallet/environment', () => ({
  isSecureContext: () => deviceDetailMocks.isSecureContext(),
}));

vi.mock('../../../services/hardwareWallet/runtime', () => ({
  hardwareWalletService: {
    connect: deviceDetailMocks.hardwareConnect,
    getAllXpubs: deviceDetailMocks.hardwareGetAllXpubs,
    disconnect: deviceDetailMocks.hardwareDisconnect,
  },
}));

vi.mock('../../../components/ui/CustomIcons', () => ({
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

vi.mock('../../../contexts/UserContext', () => ({
  useUser: () => ({
    user: mockCurrentUser,
  }),
}));

vi.mock('../../../src/api/devices', () => ({
  getDevice: deviceDetailMocks.getDevice,
  updateDevice: deviceDetailMocks.updateDevice,
  getDeviceModels: deviceDetailMocks.getDeviceModels,
  getDeviceShareInfo: deviceDetailMocks.getDeviceShareInfo,
  shareDeviceWithUser: deviceDetailMocks.shareDeviceWithUser,
  removeUserFromDevice: deviceDetailMocks.removeUserFromDevice,
  shareDeviceWithGroup: deviceDetailMocks.shareDeviceWithGroup,
  addDeviceAccount: deviceDetailMocks.addDeviceAccount,
}));

vi.mock('../../../src/api/auth', () => ({
  getUserGroups: deviceDetailMocks.getUserGroups,
  searchUsers: deviceDetailMocks.searchUsers,
}));

vi.mock('../../../src/api/admin', () => ({
  getGroups: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

export const deviceData = {
  id: 'device-1',
  type: 'passport',
  label: 'Passport One',
  fingerprint: 'abcd1234',
  isOwner: true,
  userRole: 'owner',
  wallets: [{ wallet: { id: 'wallet-1', name: 'Main Wallet', type: 'single_sig' } }],
  accounts: [],
};

export const setupDeviceDetailHarness = () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.navigate.mockReset();
    mocks.isSecureContext.mockReturnValue(false);
    mocks.hardwareConnect.mockReset();
    mocks.hardwareGetAllXpubs.mockReset();
    mocks.hardwareDisconnect.mockReset();
    mocks.hardwareDisconnect.mockResolvedValue(undefined);
    mocks.getAccountTypeInfo.mockReset();
    mocks.getAccountTypeInfo.mockReturnValue({ title: 'Test', description: '', addressPrefix: '' });
    mocks.scannerScanPayload = [{ rawValue: 'invalid' }];
    mocks.scannerErrorPayload = new Error('camera failed');
    mocks.getDevice.mockResolvedValue(deviceData as any);
    mocks.getDeviceModels.mockResolvedValue([{ slug: 'passport', manufacturer: 'Foundation', name: 'Passport' }] as any);
    mocks.getDeviceShareInfo.mockResolvedValue({
      users: [{ id: 'user-1', username: 'alice', role: 'owner' }],
      group: null,
    } as any);
    mocks.getUserGroups.mockResolvedValue([{ id: 'g1', name: 'Team A' }] as any);
    mocks.searchUsers.mockResolvedValue([]);
    mocks.shareDeviceWithUser.mockResolvedValue(undefined as any);
    mocks.removeUserFromDevice.mockResolvedValue(undefined as any);
    mocks.shareDeviceWithGroup.mockResolvedValue(undefined as any);
    mocks.addDeviceAccount.mockResolvedValue(undefined as any);
    mocks.parseDeviceJson.mockReturnValue(null as any);
  });
};
