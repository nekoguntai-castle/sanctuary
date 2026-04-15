import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { beforeEach, vi } from 'vitest';

const connectDeviceMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  getDeviceModels: vi.fn(),
  createDeviceWithConflictHandling: vi.fn(),
  mergeDeviceAccounts: vi.fn(),
  parseDeviceJson: vi.fn(),
  isSecureContext: vi.fn(),
  hardwareWalletService: {
    connect: vi.fn(),
    getAllXpubs: vi.fn(),
  },
}));

export const mocks = connectDeviceMocks;

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => connectDeviceMocks.navigate,
  };
});

vi.mock('../../../src/api/devices', () => ({
  getDeviceModels: connectDeviceMocks.getDeviceModels,
  createDeviceWithConflictHandling: connectDeviceMocks.createDeviceWithConflictHandling,
  mergeDeviceAccounts: connectDeviceMocks.mergeDeviceAccounts,
}));

vi.mock('../../../services/deviceParsers', () => ({
  parseDeviceJson: connectDeviceMocks.parseDeviceJson,
  parseDeviceData: vi.fn(),
}));

vi.mock('../../../services/bbqr', () => ({
  BBQrDecoder: vi.fn(),
  isBBQr: vi.fn().mockReturnValue(false),
  BBQrFileTypes: {},
  BBQrEncodings: {},
}));

vi.mock('../../../services/hardwareWallet/runtime', () => ({
  hardwareWalletService: connectDeviceMocks.hardwareWalletService,
}));

vi.mock('../../../services/hardwareWallet/environment', () => ({
  isSecureContext: connectDeviceMocks.isSecureContext,
}));

vi.mock('../../../contexts/SidebarContext', () => ({
  useSidebar: () => ({
    refreshSidebar: vi.fn(),
  }),
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('lucide-react', () => ({
  ArrowLeft: () => <span data-testid="arrow-left" />,
  Usb: () => <span data-testid="usb-icon" />,
  FileJson: () => <span data-testid="file-json-icon" />,
  PenTool: () => <span data-testid="pen-tool-icon" />,
  Check: () => <span data-testid="check-icon" />,
  AlertCircle: () => <span data-testid="alert-circle-icon" />,
  Wifi: () => <span data-testid="wifi-icon" />,
  QrCode: () => <span data-testid="qr-code-icon" />,
  HardDrive: () => <span data-testid="hard-drive-icon" />,
  Shield: () => <span data-testid="shield-icon" />,
  Code: () => <span data-testid="code-icon" />,
  Lock: () => <span data-testid="lock-icon" />,
  Loader2: () => <span data-testid="loader-icon" />,
  ChevronRight: () => <span data-testid="chevron-right" />,
  ChevronDown: () => <span data-testid="chevron-down" />,
  Search: () => <span data-testid="search-icon" />,
  X: () => <span data-testid="x-icon" />,
  Camera: () => <span data-testid="camera-icon" />,
  Upload: () => <span data-testid="upload-icon" />,
  Info: () => <span data-testid="info-icon" />,
  GitMerge: () => <span data-testid="git-merge-icon" />,
  ExternalLink: () => <span data-testid="external-link-icon" />,
  AlertTriangle: () => <span data-testid="alert-triangle-icon" />,
}));

vi.mock('../../../components/ui/CustomIcons', () => ({
  getDeviceIcon: (name: string, className?: string) => <span data-testid={`device-icon-${name}`} className={className} />,
}));

vi.mock('../../../components/ui/Button', () => ({
  Button: ({ children, onClick, disabled, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@yudiel/react-qr-scanner', () => ({
  Scanner: () => <div data-testid="qr-scanner" />,
}));

vi.mock('@keystonehq/bc-ur-registry', () => ({
  URRegistryDecoder: vi.fn(),
  CryptoOutput: vi.fn(),
  CryptoHDKey: vi.fn(),
  CryptoAccount: vi.fn(),
  RegistryTypes: {},
}));

vi.mock('@ngraveio/bc-ur', () => ({
  URDecoder: vi.fn(),
}));

export const mockDeviceModels = [
  {
    id: 'model-1',
    slug: 'ledger-nano-s',
    name: 'Ledger Nano S',
    manufacturer: 'Ledger',
    connectivity: ['usb'],
    airGapped: false,
    secureElement: true,
    openSource: false,
    supportsBitcoinOnly: false,
    integrationTested: true,
  },
  {
    id: 'model-2',
    slug: 'coldcard-mk4',
    name: 'Coldcard MK4',
    manufacturer: 'Coinkite',
    connectivity: ['sd_card', 'qr_code'],
    airGapped: true,
    secureElement: true,
    openSource: true,
    supportsBitcoinOnly: true,
    integrationTested: true,
  },
  {
    id: 'model-3',
    slug: 'trezor-model-t',
    name: 'Trezor Model T',
    manufacturer: 'Trezor',
    connectivity: ['usb'],
    airGapped: false,
    secureElement: false,
    openSource: true,
    supportsBitcoinOnly: false,
    integrationTested: true,
  },
];

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>{children}</BrowserRouter>
    </QueryClientProvider>
  );
};

export const renderConnectDevice = async () => {
  const { ConnectDevice } = await import('../../../components/ConnectDevice');

  const result = render(<ConnectDevice />, { wrapper: createWrapper() });

  await act(async () => {
    await Promise.resolve();
  });

  return result;
};

export const setupConnectDeviceHarness = () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDeviceModels.mockReset();
    mocks.createDeviceWithConflictHandling.mockReset();
    mocks.mergeDeviceAccounts.mockReset();
    mocks.parseDeviceJson.mockReset();
    mocks.isSecureContext.mockReset();
    mocks.hardwareWalletService.connect.mockReset();
    mocks.hardwareWalletService.getAllXpubs.mockReset();

    mocks.getDeviceModels.mockResolvedValue(mockDeviceModels);
    mocks.isSecureContext.mockReturnValue(false);
  });
};
