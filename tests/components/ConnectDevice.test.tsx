/**
 * ConnectDevice Component Tests
 *
 * Tests the hardware wallet device connection wizard.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { parseDeviceJson } from '../../services/deviceParsers';
import { hardwareWalletService } from '../../services/hardwareWallet/runtime';
import { isSecureContext } from '../../services/hardwareWallet/environment';

// Mock navigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock devices API
const mockGetDeviceModels = vi.fn();
const mockCreateDeviceWithConflictHandling = vi.fn();
const mockMergeDeviceAccounts = vi.fn();
const mockParseDeviceJson = vi.mocked(parseDeviceJson);
const mockIsSecureContext = vi.mocked(isSecureContext);
const mockHardwareWalletService = vi.mocked(hardwareWalletService);

vi.mock('../../src/api/devices', () => ({
  getDeviceModels: () => mockGetDeviceModels(),
  createDeviceWithConflictHandling: (...args: unknown[]) => mockCreateDeviceWithConflictHandling(...args),
  mergeDeviceAccounts: (...args: unknown[]) => mockMergeDeviceAccounts(...args),
}));

// Mock device parsers
vi.mock('../../services/deviceParsers', () => ({
  parseDeviceJson: vi.fn(),
  parseDeviceData: vi.fn(),
}));

// Mock BBQr
vi.mock('../../services/bbqr', () => ({
  BBQrDecoder: vi.fn(),
  isBBQr: vi.fn().mockReturnValue(false),
  BBQrFileTypes: {},
  BBQrEncodings: {},
}));

// Mock hardware wallet service
vi.mock('../../services/hardwareWallet/runtime', () => ({
  hardwareWalletService: {
    connect: vi.fn(),
    getAllXpubs: vi.fn(),
  },
}));

vi.mock('../../services/hardwareWallet/environment', () => ({
  isSecureContext: vi.fn().mockReturnValue(false), // Assume not secure context for simplicity
}));

// Mock sidebar context
vi.mock('../../contexts/SidebarContext', () => ({
  useSidebar: () => ({
    refreshSidebar: vi.fn(),
  }),
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock lucide-react icons
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

// Mock custom icons
vi.mock('../../components/ui/CustomIcons', () => ({
  getDeviceIcon: (name: string, className?: string) => <span data-testid={`device-icon-${name}`} className={className} />,
}));

// Mock Button component
vi.mock('../../components/ui/Button', () => ({
  Button: ({ children, onClick, disabled, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

// Mock QR Scanner
vi.mock('@yudiel/react-qr-scanner', () => ({
  Scanner: () => <div data-testid="qr-scanner" />,
}));

// Mock UR Registry
vi.mock('@keystonehq/bc-ur-registry', () => ({
  URRegistryDecoder: vi.fn(),
  CryptoOutput: vi.fn(),
  CryptoHDKey: vi.fn(),
  CryptoAccount: vi.fn(),
  RegistryTypes: {},
}));

// Mock UR Decoder
vi.mock('@ngraveio/bc-ur', () => ({
  URDecoder: vi.fn(),
}));

const mockDeviceModels = [
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

describe('ConnectDevice Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDeviceModels.mockResolvedValue(mockDeviceModels);
  });

  it('should render loading state initially', async () => {
    // Delay the mock to see loading state
    mockGetDeviceModels.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(mockDeviceModels), 100)));

    const { ConnectDevice } = await import('../../components/ConnectDevice');

    render(<ConnectDevice />, { wrapper: createWrapper() });

    expect(screen.getByText(/loading device models/i)).toBeInTheDocument();
  });

  it('should render page title after loading', async () => {
    const { ConnectDevice } = await import('../../components/ConnectDevice');

    render(<ConnectDevice />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/connect hardware device/i)).toBeInTheDocument();
    });
  });

  it('should show back to devices button', async () => {
    const { ConnectDevice } = await import('../../components/ConnectDevice');

    render(<ConnectDevice />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/back to devices/i)).toBeInTheDocument();
    });
  });

  it('should navigate back when clicking back button', async () => {
    const { ConnectDevice } = await import('../../components/ConnectDevice');
    const user = userEvent.setup();

    render(<ConnectDevice />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText(/back to devices/i)).toBeInTheDocument();
    });

    const backButton = screen.getByText(/back to devices/i);
    await user.click(backButton);

    expect(mockNavigate).toHaveBeenCalledWith('/devices');
  });

  it('should display device models', async () => {
    const { ConnectDevice } = await import('../../components/ConnectDevice');

    render(<ConnectDevice />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Ledger Nano S')).toBeInTheDocument();
      expect(screen.getByText('Coldcard MK4')).toBeInTheDocument();
      expect(screen.getByText('Trezor Model T')).toBeInTheDocument();
    });
  });

  it('should show manufacturer filter buttons', async () => {
    const { ConnectDevice } = await import('../../components/ConnectDevice');

    render(<ConnectDevice />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('All')).toBeInTheDocument();
    });

    // All manufacturer buttons should be present
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ledger' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Coinkite' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trezor' })).toBeInTheDocument();
  });

  it('should filter devices by manufacturer', async () => {
    const { ConnectDevice } = await import('../../components/ConnectDevice');
    const user = userEvent.setup();

    render(<ConnectDevice />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Ledger Nano S')).toBeInTheDocument();
    });

    // Click on Ledger filter button
    const ledgerButton = screen.getByRole('button', { name: 'Ledger' });
    await user.click(ledgerButton);

    // Should only show Ledger device
    await waitFor(() => {
      expect(screen.getByText('Ledger Nano S')).toBeInTheDocument();
      expect(screen.queryByText('Coldcard MK4')).not.toBeInTheDocument();
      expect(screen.queryByText('Trezor Model T')).not.toBeInTheDocument();
    });
  });

  it('should allow searching devices', async () => {
    const { ConnectDevice } = await import('../../components/ConnectDevice');
    const user = userEvent.setup();

    render(<ConnectDevice />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search devices/i)).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/search devices/i);
    await user.type(searchInput, 'cold');

    // Should only show Coldcard
    expect(screen.getByText('Coldcard MK4')).toBeInTheDocument();
    expect(screen.queryByText('Ledger Nano S')).not.toBeInTheDocument();
    expect(screen.queryByText('Trezor Model T')).not.toBeInTheDocument();
  });

  it('should clear search when X is clicked', async () => {
    const { ConnectDevice } = await import('../../components/ConnectDevice');
    const user = userEvent.setup();

    render(<ConnectDevice />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search devices/i)).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/search devices/i);
    await user.type(searchInput, 'cold');

    // Click clear button
    const clearButton = screen.getByTestId('x-icon').closest('button');
    await user.click(clearButton!);

    // Should show all devices again
    expect(screen.getByText('Coldcard MK4')).toBeInTheDocument();
    expect(screen.getByText('Ledger Nano S')).toBeInTheDocument();
    expect(screen.getByText('Trezor Model T')).toBeInTheDocument();
  });
});

describe('ConnectDevice Component - Device Selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDeviceModels.mockResolvedValue(mockDeviceModels);
  });

  it('should show connection methods when device is selected', async () => {
    const { ConnectDevice } = await import('../../components/ConnectDevice');
    const user = userEvent.setup();

    render(<ConnectDevice />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Coldcard MK4')).toBeInTheDocument();
    });

    // Select Coldcard (has sd_card and qr_code)
    const coldcardButton = screen.getByText('Coldcard MK4').closest('button');
    await user.click(coldcardButton!);

    await waitFor(() => {
      expect(screen.getByText(/2\. connection method/i)).toBeInTheDocument();
    });

    expect(screen.getByText('SD Card')).toBeInTheDocument();
    expect(screen.getByText('Manual Entry')).toBeInTheDocument();
  });

  it('should highlight selected device', async () => {
    const { ConnectDevice } = await import('../../components/ConnectDevice');
    const user = userEvent.setup();

    render(<ConnectDevice />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Coldcard MK4')).toBeInTheDocument();
    });

    const coldcardButton = screen.getByText('Coldcard MK4').closest('button');
    await user.click(coldcardButton!);

    // Should have selection styling
    expect(coldcardButton).toHaveClass('ring-1');
  });

  it('should show device capabilities', async () => {
    const { ConnectDevice } = await import('../../components/ConnectDevice');
    const user = userEvent.setup();

    render(<ConnectDevice />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Coldcard MK4')).toBeInTheDocument();
    });

    // Select Coldcard
    await user.click(screen.getByText('Coldcard MK4'));

    await waitFor(() => {
      expect(screen.getByText(/air-gapped/i)).toBeInTheDocument();
      expect(screen.getByText(/secure element/i)).toBeInTheDocument();
      expect(screen.getByText(/open source/i)).toBeInTheDocument();
      expect(screen.getByText(/bitcoin only/i)).toBeInTheDocument();
    });
  });

  it('should show device details form when device is selected', async () => {
    const { ConnectDevice } = await import('../../components/ConnectDevice');
    const user = userEvent.setup();

    render(<ConnectDevice />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Coldcard MK4')).toBeInTheDocument();
    });

    // Select Coldcard
    await user.click(screen.getByText('Coldcard MK4'));

    await waitFor(() => {
      expect(screen.getByText(/device details/i)).toBeInTheDocument();
      expect(screen.getByText(/device label/i)).toBeInTheDocument();
      expect(screen.getByText(/master fingerprint/i)).toBeInTheDocument();
    });
  });

  it('should auto-populate device label based on selected model', async () => {
    const { ConnectDevice } = await import('../../components/ConnectDevice');
    const user = userEvent.setup();

    render(<ConnectDevice />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Coldcard MK4')).toBeInTheDocument();
    });

    // Select Coldcard
    await user.click(screen.getByText('Coldcard MK4'));

    await waitFor(() => {
      const labelInput = screen.getByPlaceholderText(/my coldcard mk4/i);
      expect(labelInput).toHaveValue('My Coldcard MK4');
    });
  });
});

describe('ConnectDevice Component - Manual Entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDeviceModels.mockResolvedValue(mockDeviceModels);
  });

  it('should show manual entry warning', async () => {
    const { ConnectDevice } = await import('../../components/ConnectDevice');
    const user = userEvent.setup();

    render(<ConnectDevice />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Coldcard MK4')).toBeInTheDocument();
    });

    // Select Coldcard
    await user.click(screen.getByText('Coldcard MK4'));

    await waitFor(() => {
      expect(screen.getByText('Manual Entry')).toBeInTheDocument();
    });

    // Select manual entry
    await user.click(screen.getByText('Manual Entry'));

    await waitFor(() => {
      expect(screen.getByText(/manually entering xpubs is for advanced users/i)).toBeInTheDocument();
    });
  });

  it('should show derivation path and xpub inputs for manual entry', async () => {
    const { ConnectDevice } = await import('../../components/ConnectDevice');
    const user = userEvent.setup();

    render(<ConnectDevice />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Coldcard MK4')).toBeInTheDocument();
    });

    // Select Coldcard
    const coldcardButton = screen.getByText('Coldcard MK4').closest('button');
    await user.click(coldcardButton!);

    await waitFor(() => {
      expect(screen.getByText('Manual Entry')).toBeInTheDocument();
    });

    // Select manual entry - it's a button
    const manualEntryButton = screen.getByText('Manual Entry').closest('button');
    await user.click(manualEntryButton!);

    // Derivation path and xpub inputs should be in the form
    expect(screen.getByText('Derivation Path')).toBeInTheDocument();
    expect(screen.getByText('Extended Public Key')).toBeInTheDocument();
  });

  it('should disable save button when required fields are empty', async () => {
    const { ConnectDevice } = await import('../../components/ConnectDevice');
    const user = userEvent.setup();

    render(<ConnectDevice />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Coldcard MK4')).toBeInTheDocument();
    });

    // Select Coldcard
    await user.click(screen.getByText('Coldcard MK4'));

    await waitFor(() => {
      expect(screen.getByText('Manual Entry')).toBeInTheDocument();
    });

    // Select manual entry
    await user.click(screen.getByText('Manual Entry'));

    const saveButton = screen.getByText(/save device/i);
    expect(saveButton).toBeDisabled();
  });

  it('should enable save button when fingerprint and xpub are provided', async () => {
    const { ConnectDevice } = await import('../../components/ConnectDevice');
    const user = userEvent.setup();

    render(<ConnectDevice />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Coldcard MK4')).toBeInTheDocument();
    });

    // Select Coldcard
    await user.click(screen.getByText('Coldcard MK4'));

    await waitFor(() => {
      expect(screen.getByText('Manual Entry')).toBeInTheDocument();
    });

    // Select manual entry
    await user.click(screen.getByText('Manual Entry'));

    // Fill in required fields
    const fingerprintInput = screen.getByPlaceholderText(/00000000/i);
    const xpubTextarea = screen.getByPlaceholderText(/xpub/i);

    await user.type(fingerprintInput, 'abc12345');
    await user.type(xpubTextarea, 'xpub6CUGRUonZSQ4TWtTMmzXdq9hYfQGx4Zz5r7rRBNwZ');

    const saveButton = screen.getByText(/save device/i);
    expect(saveButton).not.toBeDisabled();
  });
});

describe('ConnectDevice Component - Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDeviceModels.mockResolvedValue(mockDeviceModels);
  });

  it('should show no results message when search has no matches', async () => {

    const { ConnectDevice } = await import('../../components/ConnectDevice');
    const user = userEvent.setup();

    render(<ConnectDevice />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search devices/i)).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/search devices/i);
    await user.type(searchInput, 'nonexistentdevice');

    expect(screen.getByText(/no devices match your search/i)).toBeInTheDocument();
  });
});

describe('ConnectDevice Component - SD Card & Conflict Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDeviceModels.mockResolvedValue(mockDeviceModels);
  });

  it('imports SD card accounts and saves with parsed account payload', async () => {
    const { ConnectDevice } = await import('../../components/ConnectDevice');
    const user = userEvent.setup();

    mockParseDeviceJson.mockReturnValue({
      fingerprint: 'f00dbabe',
      accounts: [
        {
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/0'",
          xpub: 'xpub-imported-account',
        },
      ],
    } as any);

    mockCreateDeviceWithConflictHandling.mockResolvedValue({
      status: 'created',
      device: { id: 'device-new' },
    });

    render(<ConnectDevice />, { wrapper: createWrapper() });

    await waitFor(() => expect(screen.getByText('Coldcard MK4')).toBeInTheDocument());
    await user.click(screen.getByText('Coldcard MK4'));
    await waitFor(() => expect(screen.getByText('SD Card')).toBeInTheDocument());
    await user.click(screen.getByText('SD Card'));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(['{}'], 'coldcard-export.json', { type: 'application/json' })] },
    });

    await waitFor(() => {
      expect(screen.getByText(/File Imported Successfully/i)).toBeInTheDocument();
    });

    const saveButton = screen.getByRole('button', { name: /Save Device/i });
    expect(saveButton).not.toBeDisabled();
    await user.click(saveButton);

    await waitFor(() => {
      expect(mockCreateDeviceWithConflictHandling).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'Coldcard MK4',
          label: 'My Coldcard MK4',
          fingerprint: 'f00dbabe',
          modelSlug: 'coldcard-mk4',
          accounts: [
            {
              purpose: 'single_sig',
              scriptType: 'native_segwit',
              derivationPath: "m/84'/0'/0'",
              xpub: 'xpub-imported-account',
            },
          ],
        })
      );
    });
  });

  it('shows conflict dialog after save and merges accounts into existing device', async () => {
    const { ConnectDevice } = await import('../../components/ConnectDevice');
    const user = userEvent.setup();

    mockParseDeviceJson.mockReturnValue({
      fingerprint: 'f00dbabe',
      accounts: [
        {
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/1'",
          xpub: 'xpub-merge-account',
        },
      ],
    } as any);

    mockCreateDeviceWithConflictHandling.mockResolvedValue({
      status: 'conflict',
      conflict: {
        existingDevice: {
          id: 'existing-device-1',
          type: 'coldcard',
          label: 'Existing Coldcard',
          fingerprint: 'f00dbabe',
          accounts: [{}],
        },
        comparison: {
          newAccounts: [{ derivationPath: "m/84'/0'/1'" }],
          matchingAccounts: [],
          conflictingAccounts: [],
        },
      },
    });

    mockMergeDeviceAccounts.mockResolvedValue({
      device: { id: 'existing-device-1' },
      added: 1,
    });

    render(<ConnectDevice />, { wrapper: createWrapper() });

    await waitFor(() => expect(screen.getByText('Coldcard MK4')).toBeInTheDocument());
    await user.click(screen.getByText('Coldcard MK4'));
    await waitFor(() => expect(screen.getByText('SD Card')).toBeInTheDocument());
    await user.click(screen.getByText('SD Card'));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(['{}'], 'coldcard-export.json', { type: 'application/json' })] },
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Save Device/i })).not.toBeDisabled();
    });

    await user.click(screen.getByRole('button', { name: /Save Device/i }));

    await waitFor(() => {
      expect(screen.getByText(/Device Already Exists/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Merge 1 New Account/i }));

    await waitFor(() => {
      expect(mockMergeDeviceAccounts).toHaveBeenCalledWith(
        expect.objectContaining({
          merge: true,
          type: 'Coldcard MK4',
          label: 'My Coldcard MK4',
          fingerprint: 'f00dbabe',
          modelSlug: 'coldcard-mk4',
          accounts: [
            {
              purpose: 'single_sig',
              scriptType: 'native_segwit',
              derivationPath: "m/84'/0'/1'",
              xpub: 'xpub-merge-account',
            },
          ],
        })
      );
    });
  });

  it('shows warning when SD card file cannot be parsed', async () => {
    const { ConnectDevice } = await import('../../components/ConnectDevice');
    const user = userEvent.setup();

    mockParseDeviceJson.mockReturnValue(null);

    render(<ConnectDevice />, { wrapper: createWrapper() });

    await waitFor(() => expect(screen.getByText('Coldcard MK4')).toBeInTheDocument());
    await user.click(screen.getByText('Coldcard MK4'));
    await waitFor(() => expect(screen.getByText('SD Card')).toBeInTheDocument());
    await user.click(screen.getByText('SD Card'));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(['bad'], 'invalid.json', { type: 'application/json' })] },
    });

    await waitFor(() => {
      expect(mockParseDeviceJson).toHaveBeenCalled();
      expect(screen.getByText('Select File')).toBeInTheDocument();
      expect(screen.queryByText(/File Imported Successfully/i)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Save Device/i })).toBeDisabled();
    });
  });

  it('allows viewing existing device and dismissing conflict dialog', async () => {
    const { ConnectDevice } = await import('../../components/ConnectDevice');
    const user = userEvent.setup();

    mockParseDeviceJson.mockReturnValue({
      fingerprint: 'f00dbabe',
      accounts: [
        {
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/1'",
          xpub: 'xpub-merge-account',
        },
      ],
    } as any);

    mockCreateDeviceWithConflictHandling.mockResolvedValue({
      status: 'conflict',
      conflict: {
        existingDevice: {
          id: 'existing-device-2',
          type: 'coldcard',
          label: 'Existing Coldcard',
          fingerprint: 'f00dbabe',
          accounts: [{}],
        },
        comparison: {
          newAccounts: [{ derivationPath: "m/84'/0'/1'" }],
          matchingAccounts: [],
          conflictingAccounts: [],
        },
      },
    });

    render(<ConnectDevice />, { wrapper: createWrapper() });

    await waitFor(() => expect(screen.getByText('Coldcard MK4')).toBeInTheDocument());
    await user.click(screen.getByText('Coldcard MK4'));
    await waitFor(() => expect(screen.getByText('SD Card')).toBeInTheDocument());
    await user.click(screen.getByText('SD Card'));

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(['{}'], 'coldcard-export.json', { type: 'application/json' })] },
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Save Device/i })).not.toBeDisabled();
    });

    await user.click(screen.getByRole('button', { name: /Save Device/i }));

    await waitFor(() => {
      expect(screen.getByText(/Device Already Exists/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /View Existing Device/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/devices/existing-device-2');

    await user.click(screen.getByRole('button', { name: /Cancel/i }));
    await waitFor(() => {
      expect(screen.queryByText(/Device Already Exists/i)).not.toBeInTheDocument();
    });
  });

  it('connects a USB device when secure context is available', async () => {
    const { ConnectDevice } = await import('../../components/ConnectDevice');
    const user = userEvent.setup();

    mockIsSecureContext.mockReturnValue(true);
    mockHardwareWalletService.connect.mockResolvedValue({ connected: true } as any);
    mockHardwareWalletService.getAllXpubs.mockResolvedValue([
      {
        purpose: 'single_sig',
        scriptType: 'native_segwit',
        path: "m/84'/0'/0'",
        xpub: 'xpub-usb',
        fingerprint: 'c0ffeebb',
      },
    ] as any);

    render(<ConnectDevice />, { wrapper: createWrapper() });

    await waitFor(() => expect(screen.getByText('Ledger Nano S')).toBeInTheDocument());
    await user.click(screen.getByText('Ledger Nano S'));

    await waitFor(() => {
      expect(screen.getByText('USB')).toBeInTheDocument();
    });

    await user.click(screen.getByText('USB'));
    await user.click(screen.getByRole('button', { name: /Connect Device/i }));

    await waitFor(() => {
      expect(mockHardwareWalletService.connect).toHaveBeenCalled();
      expect(screen.getByText(/Device Connected/i)).toBeInTheDocument();
    });

    mockIsSecureContext.mockReturnValue(false);
  });
});
