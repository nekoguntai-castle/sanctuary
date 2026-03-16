/**
 * CreateWallet Component Tests
 *
 * Tests the multi-step wallet creation wizard.
 */

import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { beforeEach,describe,expect,it,vi } from 'vitest';

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
vi.mock('../../src/api/devices', () => ({
  getDevices: vi.fn().mockResolvedValue([
    {
      id: 'device-1',
      label: 'Test Ledger',
      type: 'ledger',
      xpub: 'xpub123',
      masterFingerprint: 'abc12345',
      derivationPath: "m/84'/0'/0'",
      accounts: [
        { id: 'acc-1', purpose: 'single_sig', scriptType: 'native_segwit', derivationPath: "m/84'/0'/0'" },
      ],
    },
    {
      id: 'device-2',
      label: 'Test Trezor',
      type: 'trezor',
      xpub: 'xpub456',
      masterFingerprint: 'def67890',
      derivationPath: "m/48'/0'/0'/2'",
      accounts: [
        { id: 'acc-2', purpose: 'multisig', scriptType: 'native_segwit', derivationPath: "m/48'/0'/0'/2'" },
      ],
    },
    {
      id: 'device-3',
      label: 'Test Coldcard',
      type: 'coldcard',
      xpub: 'xpub789',
      masterFingerprint: 'ghi11111',
      derivationPath: "m/48'/0'/0'/2'",
      accounts: [
        { id: 'acc-3', purpose: 'multisig', scriptType: 'native_segwit', derivationPath: "m/48'/0'/0'/2'" },
        { id: 'acc-4', purpose: 'single_sig', scriptType: 'native_segwit', derivationPath: "m/84'/0'/0'" },
      ],
    },
  ]),
}));

// Mock wallets API
const mockMutateAsync = vi.fn().mockResolvedValue({ id: 'new-wallet-id', name: 'Test Wallet' });
vi.mock('../../hooks/queries/useWallets', () => ({
  useCreateWallet: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
    isError: false,
  }),
}));

// Mock error handler
vi.mock('../../hooks/useErrorHandler', () => ({
  useErrorHandler: () => ({
    handleError: vi.fn(),
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

// Mock error handler util
vi.mock('../../utils/errorHandler', () => ({
  logError: vi.fn(),
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  ArrowLeft: () => <span data-testid="arrow-left" />,
  ArrowRight: () => <span data-testid="arrow-right" />,
  Check: () => <span data-testid="check" />,
  Plus: () => <span data-testid="plus" />,
  Cpu: () => <span data-testid="cpu" />,
  Shield: () => <span data-testid="shield" />,
  Settings: () => <span data-testid="settings" />,
  CheckCircle: () => <span data-testid="check-circle" />,
  AlertCircle: () => <span data-testid="alert-circle" />,
  Wallet: () => <span data-testid="wallet-icon" />,
  ClipboardCheck: () => <span data-testid="clipboard-check" />,
}));

// Mock custom icons
vi.mock('../../components/ui/CustomIcons', () => ({
  SingleSigIcon: ({ className }: { className?: string }) => <span data-testid="single-sig-icon" className={className} />,
  MultiSigIcon: ({ className }: { className?: string }) => <span data-testid="multi-sig-icon" className={className} />,
  getDeviceIcon: () => <span data-testid="device-icon" />,
}));

// Mock Button component
vi.mock('../../components/ui/Button', () => ({
  Button: ({ children, onClick, disabled, isLoading, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { isLoading?: boolean }) => (
    <button onClick={onClick} disabled={disabled || isLoading} {...props}>
      {isLoading ? 'Loading...' : children}
    </button>
  ),
}));

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

const renderCreateWallet = async (CreateWallet: React.ComponentType) => {
  render(<CreateWallet />, { wrapper: createWrapper() });
  await waitFor(() => {
    expect(screen.getByText(/select wallet topology/i)).toBeInTheDocument();
  });
};

describe('CreateWallet Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render step 1 with wallet type selection', async () => {
    const { CreateWallet } = await import('../../components/CreateWallet');

    await renderCreateWallet(CreateWallet);

    expect(screen.getByText(/select wallet topology/i)).toBeInTheDocument();
    expect(screen.getByText(/single signature/i)).toBeInTheDocument();
    expect(screen.getByText(/multi signature/i)).toBeInTheDocument();
  });

  it('should highlight single-sig option when selected', async () => {
    const { CreateWallet } = await import('../../components/CreateWallet');
    const user = userEvent.setup();

    await renderCreateWallet(CreateWallet);

    const singleSigButton = screen.getByText(/single signature/i).closest('button');
    await user.click(singleSigButton!);

    expect(singleSigButton).toHaveClass('border-emerald-600');
  });

  it('should highlight multi-sig option when selected', async () => {
    const { CreateWallet } = await import('../../components/CreateWallet');
    const user = userEvent.setup();

    await renderCreateWallet(CreateWallet);

    const multiSigButton = screen.getByText(/multi signature/i).closest('button');
    await user.click(multiSigButton!);

    expect(multiSigButton).toHaveClass('border-warning-600');
  });

  it('should advance to step 2 when wallet type selected and Next clicked', async () => {
    const { CreateWallet } = await import('../../components/CreateWallet');
    const user = userEvent.setup();

    await renderCreateWallet(CreateWallet);

    // Select single-sig
    const singleSigButton = screen.getByText(/single signature/i).closest('button');
    await user.click(singleSigButton!);

    // Click Next
    const nextButton = screen.getByText(/next/i);
    await user.click(nextButton);

    // Should be on step 2
    await waitFor(() => {
      expect(screen.getByText(/select signers/i)).toBeInTheDocument();
    });
  });

  it('should filter devices by wallet type compatibility', async () => {
    const { CreateWallet } = await import('../../components/CreateWallet');
    const user = userEvent.setup();

    await renderCreateWallet(CreateWallet);

    // Select single-sig
    const singleSigButton = screen.getByText(/single signature/i).closest('button');
    await user.click(singleSigButton!);

    // Click Next
    const nextButton = screen.getByText(/next/i);
    await user.click(nextButton);

    // Should show single-sig compatible devices (Test Ledger and Test Coldcard have single_sig accounts)
    await waitFor(() => {
      expect(screen.getByText('Test Ledger')).toBeInTheDocument();
      expect(screen.getByText('Test Coldcard')).toBeInTheDocument();
    });
  });

  it('should show warning for incompatible devices', async () => {
    const { CreateWallet } = await import('../../components/CreateWallet');
    const user = userEvent.setup();

    await renderCreateWallet(CreateWallet);

    // Select single-sig
    const singleSigButton = screen.getByText(/single signature/i).closest('button');
    await user.click(singleSigButton!);

    // Click Next
    const nextButton = screen.getByText(/next/i);
    await user.click(nextButton);

    // Test Trezor only has multisig account, should be shown as hidden
    await waitFor(() => {
      expect(screen.getByText(/device.* hidden/i)).toBeInTheDocument();
    });
  });

  it('should allow device selection in single-sig mode', async () => {
    const { CreateWallet } = await import('../../components/CreateWallet');
    const user = userEvent.setup();

    await renderCreateWallet(CreateWallet);

    // Select single-sig
    const singleSigButton = screen.getByText(/single signature/i).closest('button');
    await user.click(singleSigButton!);

    // Click Next
    const nextButton = screen.getByText(/next/i);
    await user.click(nextButton);

    // Wait for devices to load and select one
    await waitFor(() => {
      expect(screen.getByText('Test Ledger')).toBeInTheDocument();
    });

    // Devices are div elements, not buttons
    const deviceDiv = screen.getByText('Test Ledger').closest('div[class*="cursor-pointer"]');
    await user.click(deviceDiv!);

    // Device should be selected - has ring-1 class when selected
    expect(deviceDiv).toHaveClass('ring-1');
  });
});

describe('CreateWallet Component - Multi-step Navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should go back to previous step when Back is clicked', async () => {
    const { CreateWallet } = await import('../../components/CreateWallet');
    const user = userEvent.setup();

    await renderCreateWallet(CreateWallet);

    // Go to step 2
    const singleSigButton = screen.getByText(/single signature/i).closest('button');
    await user.click(singleSigButton!);
    await user.click(screen.getByText(/next/i));

    await waitFor(() => {
      expect(screen.getByText(/select signers/i)).toBeInTheDocument();
    });

    // Click Back
    const backButton = screen.getByText(/back/i);
    await user.click(backButton);

    // Should be back on step 1
    expect(screen.getByText(/select wallet topology/i)).toBeInTheDocument();
  });

  it('should complete full wallet creation flow', async () => {
    const { CreateWallet } = await import('../../components/CreateWallet');
    const user = userEvent.setup();

    await renderCreateWallet(CreateWallet);

    // Step 1: Select single-sig
    const singleSigButton = screen.getByText(/single signature/i).closest('button');
    await user.click(singleSigButton!);
    await user.click(screen.getByText(/next/i));

    // Step 2: Select device - devices are div elements with cursor-pointer
    await waitFor(() => {
      expect(screen.getByText('Test Ledger')).toBeInTheDocument();
    });
    const deviceDiv = screen.getByText('Test Ledger').closest('div[class*="cursor-pointer"]');
    await user.click(deviceDiv!);
    await user.click(screen.getByText(/next/i));

    // Step 3: Enter wallet details - look for the Configuration heading
    await waitFor(() => {
      expect(screen.getByText(/configuration/i)).toBeInTheDocument();
    });
    const walletNameInput = screen.getByPlaceholderText(/my coldcard wallet/i);
    await user.type(walletNameInput, 'My Test Wallet');
    await user.click(screen.getByText(/next/i));

    // Step 4: Review and create - button text is "Construct Wallet"
    await waitFor(() => {
      expect(screen.getByText(/review wallet details/i)).toBeInTheDocument();
    });
    await user.click(screen.getByText(/construct wallet/i));

    // Should call the mutation and navigate
    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My Test Wallet',
          type: 'single_sig',
          deviceIds: ['device-1'],
        })
      );
    });

    expect(mockNavigate).toHaveBeenCalledWith('/wallets/new-wallet-id');
  });
});

describe('CreateWallet Component - Multi-sig Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should require at least 2 devices for multisig', async () => {
    const mockHandleError = vi.fn();
    vi.doMock('../../hooks/useErrorHandler', () => ({
      useErrorHandler: () => ({
        handleError: mockHandleError,
      }),
    }));

    vi.resetModules();
    const { CreateWallet } = await import('../../components/CreateWallet');
    const user = userEvent.setup();

    await renderCreateWallet(CreateWallet);

    // Select multi-sig
    const multiSigButton = screen.getByText(/multi signature/i).closest('button');
    await user.click(multiSigButton!);
    await user.click(screen.getByText(/next/i));

    // Select only one multisig device - devices are div elements
    await waitFor(() => {
      expect(screen.getByText('Test Trezor')).toBeInTheDocument();
    });
    const deviceDiv = screen.getByText('Test Trezor').closest('div[class*="cursor-pointer"]');
    await user.click(deviceDiv!);

    // Try to proceed - should show error
    await user.click(screen.getByText(/next/i));

    // Should show validation error (handled by handleError mock)
    await waitFor(() => {
      expect(mockHandleError).toHaveBeenCalledWith(
        expect.stringContaining('at least 2 devices'),
        expect.any(String)
      );
    });
  });

  it('should allow proceeding with 2+ devices for multisig', async () => {
    const { CreateWallet } = await import('../../components/CreateWallet');
    const user = userEvent.setup();

    await renderCreateWallet(CreateWallet);

    // Select multi-sig
    const multiSigButton = screen.getByText(/multi signature/i).closest('button');
    await user.click(multiSigButton!);
    await user.click(screen.getByText(/next/i));

    // Select two multisig-compatible devices - devices are div elements
    await waitFor(() => {
      expect(screen.getByText('Test Trezor')).toBeInTheDocument();
      expect(screen.getByText('Test Coldcard')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Test Trezor').closest('div[class*="cursor-pointer"]')!);
    await user.click(screen.getByText('Test Coldcard').closest('div[class*="cursor-pointer"]')!);

    // Try to proceed - should work
    await user.click(screen.getByText(/next/i));

    // Should be on step 3 - look for Configuration heading
    await waitFor(() => {
      expect(screen.getByText(/configuration/i)).toBeInTheDocument();
    });
  });
});
