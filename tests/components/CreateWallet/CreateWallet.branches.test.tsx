import { act,render,renderHook,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { CreateWallet } from '../../../src/components/CreateWallet';
import { useCreateWalletController } from '../../../src/components/CreateWallet/useCreateWalletController';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  getDevices: vi.fn(),
  mutateAsync: vi.fn(),
  handleError: vi.fn(),
  selectedNetwork: 'mainnet',
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
    selectedNetwork: mocks.selectedNetwork,
    isMainnet: mocks.selectedNetwork === 'mainnet',
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
    const exact = compatibleDevices[0];
    const mismatch = all.find(d => d.id === 'ambiguous-single');

    return (
      <div data-testid="signer-step">
        <span data-testid="compatible-count">{compatibleDevices.length}</span>
        <span data-testid="incompatible-count">{incompatibleDevices.length}</span>
        <span data-testid="exact-display">{exact ? getDisplayAccount(exact, walletType)?.id ?? 'null' : 'null'}</span>
        <span data-testid="mismatch-display">{mismatch ? String(getDisplayAccount(mismatch, 'single_sig')) : 'null'}</span>
        <button onClick={() => toggleDevice('multi-one')}>toggle-multi-one</button>
        <button onClick={() => toggleDevice('multi-one')}>toggle-multi-one-again</button>
        <button onClick={() => toggleDevice('multi-two')}>toggle-multi-two</button>
        <button onClick={() => toggleDevice('single-only')}>toggle-single</button>
        <button onClick={() => toggleDevice('ambiguous-single')}>toggle-ambiguous</button>
      </div>
    );
  },
}));

vi.mock('../../../src/components/CreateWallet/ConfigurationStep', () => ({
  ConfigurationStep: ({ setWalletName, setScriptType }: any) => (
    <div data-testid="config-step">
      <button onClick={() => setWalletName('Branch Wallet')}>set-name</button>
      <button onClick={() => setScriptType('nested_segwit')}>change-script</button>
    </div>
  ),
}));

vi.mock('../../../src/components/CreateWallet/ReviewStep', () => ({
  ReviewStep: () => <div data-testid="review-step">review</div>,
}));

describe('CreateWallet branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectedNetwork = 'mainnet';
    mocks.getDevices.mockResolvedValue([
      { id: 'legacy-no-path', label: 'Legacy No Path' },
      {
        id: 'single-only',
        label: 'Single Only',
        accounts: [{ id: 'a1', purpose: 'single_sig', scriptType: 'native_segwit', derivationPath: "m/84'/0'/7'" }],
      },
      {
        id: 'multi-one',
        label: 'Multi One',
        accounts: [{ id: 'a2', purpose: 'multisig', scriptType: 'native_segwit', derivationPath: "m/48'/0'/0'/2'" }],
      },
      {
        id: 'multi-two',
        label: 'Multi Two',
        accounts: [{ id: 'a3', purpose: 'multisig', scriptType: 'native_segwit', derivationPath: "m/48'/0'/1'/2'" }],
      },
      {
        id: 'ambiguous-single',
        label: 'Ambiguous Single',
        accounts: [
          { id: 'a4', purpose: 'single_sig', scriptType: 'native_segwit', derivationPath: "m/84'/0'/0'" },
          { id: 'a5', purpose: 'single_sig', scriptType: 'native_segwit', derivationPath: "m/84'/0'/1'" },
        ],
      },
    ]);
    mocks.mutateAsync.mockResolvedValue({ id: 'created-wallet-id' });
  });

  it('fails closed for legacy and ambiguous devices and keeps the step-2 no-selection guard', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CreateWallet />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'pick-single' }));
    await user.click(screen.getByRole('button', { name: /next step/i }));

    expect(screen.getByTestId('signer-step')).toBeInTheDocument();
    expect(screen.getByTestId('compatible-count')).toHaveTextContent('1');
    expect(screen.getByTestId('incompatible-count')).toHaveTextContent('4');
    expect(screen.getByTestId('exact-display')).toHaveTextContent('a1');
    expect(screen.getByTestId('mismatch-display')).toHaveTextContent('null');

    await user.click(screen.getByRole('button', { name: 'toggle-ambiguous' }));

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

    await user.click(screen.getByRole('button', { name: 'toggle-multi-one' }));
    await user.click(screen.getByRole('button', { name: /next step/i }));
    expect(mocks.handleError).toHaveBeenCalledWith(
      'Multisig requires at least 2 devices.',
      'Validation Error'
    );

    // Toggle same ID twice to hit the remove branch before adding it again.
    await user.click(screen.getByRole('button', { name: 'toggle-multi-one-again' }));
    await user.click(screen.getByRole('button', { name: 'toggle-multi-one' }));
    await user.click(screen.getByRole('button', { name: 'toggle-multi-two' }));
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
          signers: [
            { deviceId: 'multi-one', deviceAccountId: 'a2', signerIndex: 0 },
            { deviceId: 'multi-two', deviceAccountId: 'a3', signerIndex: 1 },
          ],
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

    await user.click(screen.getByRole('button', { name: 'toggle-single' }));
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
    await user.click(screen.getByRole('button', { name: 'toggle-single' }));
    await user.click(screen.getByRole('button', { name: /next step/i }));
    await user.click(screen.getByRole('button', { name: 'set-name' }));
    await user.click(screen.getByRole('button', { name: /next step/i }));
    await user.click(screen.getByRole('button', { name: /construct wallet/i }));

    await waitFor(() => {
      expect(mocks.handleError).toHaveBeenCalledWith(expect.any(Error), 'Failed to Create Wallet');
    });
  });

  it('clears exact signer bindings when script type changes', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CreateWallet />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'pick-single' }));
    await user.click(screen.getByRole('button', { name: /next step/i }));
    await user.click(screen.getByRole('button', { name: 'toggle-single' }));
    await user.click(screen.getByRole('button', { name: /next step/i }));
    await user.click(screen.getByRole('button', { name: 'change-script' }));

    expect(screen.getByTestId('signer-step')).toBeInTheDocument();
    expect(screen.getByTestId('compatible-count')).toHaveTextContent('0');
  });

  it('clears exact signer bindings and hidden script state when wallet type changes', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CreateWallet />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'pick-single' }));
    await user.click(screen.getByRole('button', { name: /next step/i }));
    await user.click(screen.getByRole('button', { name: 'toggle-single' }));
    await user.click(screen.getByRole('button', { name: /next step/i }));
    await user.click(screen.getByRole('button', { name: 'change-script' }));
    await user.click(screen.getByRole('button', { name: /back/i }));
    await user.click(screen.getByRole('button', { name: 'pick-multi' }));
    await user.click(screen.getByRole('button', { name: /next step/i }));

    expect(screen.getByTestId('compatible-count')).toHaveTextContent('2');
    await user.click(screen.getByRole('button', { name: /next step/i }));

    expect(screen.getByTestId('signer-step')).toBeInTheDocument();
  });

  it('clears exact signer bindings when the active network changes', async () => {
    const user = userEvent.setup();
    const view = render(
      <MemoryRouter>
        <CreateWallet />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'pick-single' }));
    await user.click(screen.getByRole('button', { name: /next step/i }));
    await user.click(screen.getByRole('button', { name: 'toggle-single' }));
    await user.click(screen.getByRole('button', { name: /next step/i }));
    expect(screen.getByTestId('config-step')).toBeInTheDocument();

    mocks.selectedNetwork = 'testnet3';
    view.rerender(
      <MemoryRouter>
        <CreateWallet />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByTestId('signer-step')).toBeInTheDocument());
    expect(screen.getByTestId('compatible-count')).toHaveTextContent('0');
  });

  it('keeps controller identity changes fail-closed on no-op and unavailable selections', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <MemoryRouter>{children}</MemoryRouter>
    );
    const view = renderHook(() => useCreateWalletController(), { wrapper });

    await waitFor(() => expect(view.result.current.availableDevices).toHaveLength(5));

    act(() => view.result.current.toggleDevice('single-only'));
    expect(view.result.current.selectedSigners).toEqual([]);

    act(() => view.result.current.setWalletType('single_sig'));
    act(() => view.result.current.setWalletType('single_sig'));
    act(() => view.result.current.setScriptType('native_segwit'));
    act(() => view.result.current.toggleDevice('missing-device'));
    act(() => view.result.current.toggleDevice('ambiguous-single'));
    expect(view.result.current.selectedSigners).toEqual([]);

    act(() => view.result.current.setScriptType('nested_segwit'));
    expect(view.result.current.step).toBe(1);

    mocks.selectedNetwork = 'testnet3';
    view.rerender();
    await waitFor(() => expect(view.result.current.network).toBe('testnet3'));
    expect(view.result.current.step).toBe(1);
    expect(view.result.current.selectedSigners).toEqual([]);
  });
});
