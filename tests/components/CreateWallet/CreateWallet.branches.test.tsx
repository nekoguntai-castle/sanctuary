import { render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { CreateWallet } from '../../../src/components/CreateWallet';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  getDevices: vi.fn(),
  mutateAsync: vi.fn(),
  handleError: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock('../../../src/api/devices', () => ({
  getDevices: (...args: any[]) => mocks.getDevices(...args),
}));

vi.mock('../../../src/hooks/queries/useWallets', () => ({
  useCreateWallet: () => ({
    mutateAsync: (...args: any[]) => mocks.mutateAsync(...args),
  }),
}));

vi.mock('../../../src/hooks/useErrorHandler', () => ({
  useErrorHandler: () => ({
    handleError: mocks.handleError,
  }),
}));

vi.mock('../../../src/contexts/ActiveNetworkContext', () => ({
  useActiveNetwork: () => ({
    selectedNetwork: 'mainnet',
    isMainnet: true,
    setSelectedNetwork: vi.fn(),
  }),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../src/utils/errorHandler', () => ({
  logError: vi.fn(),
}));

vi.mock('../../../src/components/ui/Button', () => ({
  Button: ({ children, onClick, isLoading, disabled: _disabled, ...props }: any) => (
    <button onClick={onClick} {...props}>
      {isLoading ? 'loading' : children}
    </button>
  ),
}));

vi.mock('../../../src/components/CreateWallet/WalletTypeStep', () => ({
  WalletTypeStep: ({ setWalletType }: any) => (
    <div data-testid="wallet-type-step">
      <button onClick={() => setWalletType('single_sig')}>pick-single</button>
      <button onClick={() => setWalletType('multi_sig')}>pick-multi</button>
    </div>
  ),
}));

vi.mock('../../../src/components/CreateWallet/SignerSelectionStep', () => ({
  SignerSelectionStep: ({
    walletType,
    compatibleDevices,
    incompatibleDevices,
    toggleDevice,
    getDisplayAccount,
  }: any) => {
    const all = [...compatibleDevices, ...incompatibleDevices];
    const legacy = all.find(d => d.id === 'legacy-no-path');
    const mismatch = all.find(d => d.id === 'multi-only');

    return (
      <div data-testid="signer-step">
        <span data-testid="compatible-count">{compatibleDevices.length}</span>
        <span data-testid="incompatible-count">{incompatibleDevices.length}</span>
        <span data-testid="legacy-display">{String(getDisplayAccount(legacy, walletType))}</span>
        <span data-testid="mismatch-display">{String(getDisplayAccount(mismatch, 'single_sig'))}</span>
        <button onClick={() => toggleDevice('legacy-multi')}>toggle-legacy</button>
        <button onClick={() => toggleDevice('legacy-multi')}>toggle-legacy-again</button>
        <button onClick={() => toggleDevice('multi-only')}>toggle-multi-only</button>
      </div>
    );
  },
}));

vi.mock('../../../src/components/CreateWallet/ConfigurationStep', () => ({
  ConfigurationStep: ({ setWalletName }: any) => (
    <div data-testid="config-step">
      <button onClick={() => setWalletName('Branch Wallet')}>set-name</button>
    </div>
  ),
}));

vi.mock('../../../src/components/CreateWallet/ReviewStep', () => ({
  ReviewStep: () => <div data-testid="review-step">review</div>,
}));

describe('CreateWallet branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDevices.mockResolvedValue([
      { id: 'legacy-no-path', label: 'Legacy No Path' },
      { id: 'legacy-multi', label: 'Legacy Multi Path', derivationPath: "m/48'/0'/0'/2'" },
      {
        id: 'single-only',
        label: 'Single Only',
        accounts: [{ id: 'a1', purpose: 'single_sig' }],
      },
      {
        id: 'multi-only',
        label: 'Multi Only',
        accounts: [{ id: 'a2', purpose: 'multisig' }],
      },
    ]);
    mocks.mutateAsync.mockResolvedValue({ id: 'created-wallet-id' });
  });

  it('covers legacy compatibility and step-2 no-selection guard', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CreateWallet />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'pick-single' }));
    await user.click(screen.getByRole('button', { name: /next step/i }));

    expect(screen.getByTestId('signer-step')).toBeInTheDocument();
    expect(screen.getByTestId('compatible-count')).toHaveTextContent('2');
    expect(screen.getByTestId('incompatible-count')).toHaveTextContent('2');
    expect(screen.getByTestId('legacy-display')).toHaveTextContent('null');
    expect(screen.getByTestId('mismatch-display')).toHaveTextContent('null');

    // No selected devices in step 2 should keep the wizard on signer selection.
    await user.click(screen.getByRole('button', { name: /next step/i }));
    expect(screen.getByTestId('signer-step')).toBeInTheDocument();
  });

  it('covers cancel/back, multisig toggle removal, validation, and multisig payload branches', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CreateWallet />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(mocks.navigate).toHaveBeenCalledWith('/wallets');

    await user.click(screen.getByRole('button', { name: 'pick-multi' }));
    await user.click(screen.getByRole('button', { name: /next step/i }));

    await user.click(screen.getByRole('button', { name: 'toggle-legacy' }));
    await user.click(screen.getByRole('button', { name: /next step/i }));
    expect(mocks.handleError).toHaveBeenCalledWith(
      'Multisig requires at least 2 devices.',
      'Validation Error'
    );

    // Toggle same ID twice to hit the remove branch before adding it again.
    await user.click(screen.getByRole('button', { name: 'toggle-legacy-again' }));
    await user.click(screen.getByRole('button', { name: 'toggle-legacy' }));
    await user.click(screen.getByRole('button', { name: 'toggle-multi-only' }));
    await user.click(screen.getByRole('button', { name: /next step/i }));

    expect(screen.getByTestId('config-step')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'set-name' }));
    await user.click(screen.getByRole('button', { name: /next step/i }));
    expect(screen.getByTestId('review-step')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /construct wallet/i }));

    await waitFor(() => {
      expect(mocks.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Branch Wallet',
          type: 'multi_sig',
          quorum: 2,
          totalSigners: 2,
          deviceIds: expect.arrayContaining(['legacy-multi', 'multi-only']),
        })
      );
    });
    expect(mocks.navigate).toHaveBeenCalledWith('/wallets/created-wallet-id');
  });

  it('advances from signer step in single-sig mode with one selected device', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CreateWallet />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'pick-single' }));
    await user.click(screen.getByRole('button', { name: /next step/i }));

    await user.click(screen.getByRole('button', { name: 'toggle-legacy' }));
    await user.click(screen.getByRole('button', { name: /next step/i }));

    expect(screen.getByTestId('config-step')).toBeInTheDocument();

    // Step-3 guard: wallet name is still empty, so Next should not advance.
    await user.click(screen.getByRole('button', { name: /next step/i }));
    expect(screen.getByTestId('config-step')).toBeInTheDocument();
  });

  it('handles device-load errors by falling back to an empty device list', async () => {
    mocks.getDevices.mockRejectedValueOnce(new Error('load failed'));

    render(
      <MemoryRouter>
        <CreateWallet />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mocks.getDevices).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('wallet-type-step')).toBeInTheDocument();
  });

  it('handles wallet creation errors on the review step', async () => {
    const user = userEvent.setup();
    mocks.mutateAsync.mockRejectedValueOnce(new Error('create failed'));

    render(
      <MemoryRouter>
        <CreateWallet />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'pick-single' }));
    await user.click(screen.getByRole('button', { name: /next step/i }));
    await user.click(screen.getByRole('button', { name: 'toggle-legacy' }));
    await user.click(screen.getByRole('button', { name: /next step/i }));
    await user.click(screen.getByRole('button', { name: 'set-name' }));
    await user.click(screen.getByRole('button', { name: /next step/i }));
    await user.click(screen.getByRole('button', { name: /construct wallet/i }));

    await waitFor(() => {
      expect(mocks.handleError).toHaveBeenCalledWith(expect.any(Error), 'Failed to Create Wallet');
    });
  });
});
