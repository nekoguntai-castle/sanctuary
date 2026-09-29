/**
 * CreateWallet Component Tests
 *
 * Tests the multi-step wallet creation wizard.
 */

import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import * as devicesApi from '../../src/api/devices';
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
vi.mock('../../src/hooks/queries/useWallets', () => ({
  useCreateWallet: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
    isError: false,
  }),
}));

// Mock error handler
vi.mock('../../src/hooks/useErrorHandler', () => ({
  useErrorHandler: () => ({
    handleError: vi.fn(),
  }),
}));

vi.mock('../../src/contexts/ActiveNetworkContext', () => ({
  useActiveNetwork: () => ({
    selectedNetwork: 'mainnet',
    isMainnet: true,
    setSelectedNetwork: vi.fn(),
  }),
}));

// Mock logger
vi.mock('../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock error handler util
vi.mock('../../src/utils/errorHandler', () => ({
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
vi.mock('../../src/components/ui/CustomIcons', () => ({
  SingleSigIcon: ({ className }: { className?: string }) => <span data-testid="single-sig-icon" className={className} />,
  MultiSigIcon: ({ className }: { className?: string }) => <span data-testid="multi-sig-icon" className={className} />,
  getDeviceIcon: () => <span data-testid="device-icon" />,
}));

// Mock Button component
vi.mock('../../src/components/ui/Button', () => ({
  Button: ({ children, onClick, disabled, isLoading, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { isLoading?: boolean }) => (
    <button onClick={onClick} disabled={disabled || isLoading} {...props}>
      {isLoading ? 'Loading...' : children}
    </button>
  ),
}));

vi.mock('../../src/components/ConnectDevice/ConnectDevice', () => ({
  ConnectDevice: ({ onBack, onComplete }: { onBack: () => void; onComplete: (id: string) => void }) => (
    <div>
      <h1>Embedded device connection</h1>
      <button onClick={onBack}>Return to Signers</button>
      <button onClick={() => onComplete('new-device')}>Finish connection</button>
    </div>
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
    const { CreateWallet } = await import('../../src/components/CreateWallet');

    await renderCreateWallet(CreateWallet);

    expect(screen.getByText(/select wallet topology/i)).toBeInTheDocument();
    expect(screen.getByText(/single signature/i)).toBeInTheDocument();
    expect(screen.getByText(/multi signature/i)).toBeInTheDocument();
  });

  it('lets a failed initial device load reach a visible retry on the signer step', async () => {
    vi.mocked(devicesApi.getDevices).mockRejectedValueOnce(new Error('offline'));
    const { CreateWallet } = await import('../../src/components/CreateWallet');
    const user = userEvent.setup();
    await renderCreateWallet(CreateWallet);
    await user.click(screen.getByRole('button', { name: /Single Signature/ }));
    await user.click(screen.getByRole('button', { name: /Next Step/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/retry before continuing/i);
    expect(screen.getByRole('button', { name: /Next Step/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Retry signer refresh' }));
    await waitFor(() => expect(screen.getByText('Test Ledger')).toBeInTheDocument());
  });

  it.each(['return', 'completion'] as const)('keeps a named wallet draft through embedded device %s', async outcome => {
    const { CreateWallet } = await import('../../src/components/CreateWallet');
    const user = userEvent.setup();
    await renderCreateWallet(CreateWallet);
    await user.click(screen.getByRole('button', { name: /Single Signature/ }));
    await user.click(screen.getByRole('button', { name: /Next Step/ }));
    await user.click(await screen.findByRole('button', { name: /Select signer Test Ledger/ }));
    await user.click(screen.getByRole('button', { name: /Next Step/ }));
    await user.type(screen.getByPlaceholderText('e.g., My ColdCard Wallet'), 'Unfinished wallet');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Connect New Device' }));
    expect(await screen.findByRole('heading', { name: 'Embedded device connection' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Next Step/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: outcome === 'return' ? 'Return to Signers' : 'Finish connection' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Select signer Test Ledger/ })).toHaveAttribute('aria-pressed', 'true'));
    await user.click(screen.getByRole('button', { name: /Next Step/ }));
    expect(screen.getByPlaceholderText('e.g., My ColdCard Wallet')).toHaveValue('Unfinished wallet');
  });

  it('should highlight single-sig option when selected', async () => {
    const { CreateWallet } = await import('../../src/components/CreateWallet');
    const user = userEvent.setup();

    await renderCreateWallet(CreateWallet);

    const singleSigButton = screen.getByText(/single signature/i).closest('button');
    await user.click(singleSigButton!);

    expect(singleSigButton).toHaveClass('border-emerald-600');
  });

  it('should highlight multi-sig option when selected', async () => {
    const { CreateWallet } = await import('../../src/components/CreateWallet');
    const user = userEvent.setup();

    await renderCreateWallet(CreateWallet);

    const multiSigButton = screen.getByText(/multi signature/i).closest('button');
    await user.click(multiSigButton!);

    expect(multiSigButton).toHaveClass('border-warning-600');
  });

  it('should advance to step 2 when wallet type selected and Next clicked', async () => {
    const { CreateWallet } = await import('../../src/components/CreateWallet');
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
    const { CreateWallet } = await import('../../src/components/CreateWallet');
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
    const { CreateWallet } = await import('../../src/components/CreateWallet');
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
    const { CreateWallet } = await import('../../src/components/CreateWallet');
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

    const deviceDiv = screen.getByText('Test Ledger').closest('button');
    await user.click(deviceDiv!);

    expect(deviceDiv).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('CreateWallet Component - Multi-step Navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should go back to previous step when Back is clicked', async () => {
    const { CreateWallet } = await import('../../src/components/CreateWallet');
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
    const { CreateWallet } = await import('../../src/components/CreateWallet');
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
    const deviceDiv = screen.getByText('Test Ledger').closest('button');
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
          signers: [{ deviceId: 'device-1', deviceAccountId: 'acc-1', signerIndex: 0 }],
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
    vi.doMock('../../src/hooks/useErrorHandler', () => ({
      useErrorHandler: () => ({
        handleError: mockHandleError,
      }),
    }));

    vi.resetModules();
    const { CreateWallet } = await import('../../src/components/CreateWallet');
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
    const deviceDiv = screen.getByText('Test Trezor').closest('button');
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
    const { CreateWallet } = await import('../../src/components/CreateWallet');
    const user = userEvent.setup();

    await renderCreateWallet(CreateWallet);

    // Select multi-sig
    const multiSigButton = screen.getByText(/multi signature/i).closest('button');
    await user.click(multiSigButton!);
    await user.click(screen.getByText(/next/i));

    // Select two multisig-compatible devices
    await waitFor(() => {
      expect(screen.getByText('Test Trezor')).toBeInTheDocument();
      expect(screen.getByText('Test Coldcard')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Test Trezor').closest('button')!);
    await user.click(screen.getByText('Test Coldcard').closest('button')!);

    // Try to proceed - should work
    await user.click(screen.getByText(/next/i));

    // Should be on step 3 - look for Configuration heading
    await waitFor(() => {
      expect(screen.getByText(/configuration/i)).toBeInTheDocument();
    });
  });
});
