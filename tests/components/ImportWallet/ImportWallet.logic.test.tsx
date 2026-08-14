import { render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { ImportWallet } from '../../../src/components/ImportWallet/ImportWallet';
import { ApiError } from '../../../src/api/client';

const mockNavigate = vi.fn();
const mockUseImportState = vi.fn();
const mockUseImportWallet = vi.fn();
const mockValidateImportData = vi.fn();
const mockBuildDescriptorFromXpub = vi.fn();

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../../src/hooks/queries/useWallets', () => ({
  useImportWallet: () => mockUseImportWallet(),
}));

vi.mock('../../../src/contexts/ActiveNetworkContext', () => ({
  useActiveNetwork: () => ({
    selectedNetwork: 'mainnet',
    isMainnet: true,
    setSelectedNetwork: vi.fn(),
  }),
}));

vi.mock('../../../src/components/ImportWallet/hooks/useImportState', () => ({
  useImportState: () => mockUseImportState(),
}));

vi.mock('../../../src/components/ImportWallet/importHelpers', async () => {
  const actual = await vi.importActual('../../../src/components/ImportWallet/importHelpers');
  return {
    ...actual,
    buildDescriptorFromXpub: (...args: unknown[]) => mockBuildDescriptorFromXpub(...args),
    validateImportData: (...args: unknown[]) => mockValidateImportData(...args),
  };
});

vi.mock('../../../src/components/ImportWallet/steps/FormatSelection', () => ({
  FormatSelection: () => <div data-testid="step-format-selection" />,
}));

vi.mock('../../../src/components/ImportWallet/steps/DescriptorInput', () => ({
  DescriptorInput: () => <div data-testid="step-descriptor-input" />,
}));

vi.mock('../../../src/components/ImportWallet/steps/HardwareImport', () => ({
  HardwareImport: () => <div data-testid="step-hardware-import" />,
}));

vi.mock('../../../src/components/ImportWallet/steps/QrScanStep', () => ({
  QrScanStep: () => <div data-testid="step-qr-scan" />,
}));

vi.mock('../../../src/components/ImportWallet/DeviceResolution', () => ({
  DeviceResolutionStep: () => <div data-testid="step-device-resolution" />,
}));

vi.mock('../../../src/components/ImportWallet/ImportReview', () => ({
  ImportReview: () => <div data-testid="step-import-review" />,
}));

function createState(overrides: Record<string, unknown> = {}) {
  return {
    step: 1,
    setStep: vi.fn(),
    format: null,
    setFormat: vi.fn(),
    importData: '',
    setImportData: vi.fn(),
    walletName: '',
    setWalletName: vi.fn(),
    network: 'mainnet',
    setNetwork: vi.fn(),
    validationResult: null,
    setValidationResult: vi.fn(),
    isValidating: false,
    setIsValidating: vi.fn(),
    validationError: null,
    setValidationError: vi.fn(),
    isImporting: false,
    setIsImporting: vi.fn(),
    importError: null,
    setImportError: vi.fn(),
    hardwareDeviceType: 'ledger',
    setHardwareDeviceType: vi.fn(),
    deviceConnected: false,
    setDeviceConnected: vi.fn(),
    deviceLabel: null,
    setDeviceLabel: vi.fn(),
    scriptType: 'native_segwit',
    setScriptType: vi.fn(),
    accountIndex: 0,
    setAccountIndex: vi.fn(),
    xpubData: null,
    setXpubData: vi.fn(),
    isFetchingXpub: false,
    setIsFetchingXpub: vi.fn(),
    isConnecting: false,
    setIsConnecting: vi.fn(),
    hardwareError: null,
    setHardwareError: vi.fn(),
    cameraActive: false,
    setCameraActive: vi.fn(),
    cameraError: null,
    setCameraError: vi.fn(),
    urProgress: 0,
    setUrProgress: vi.fn(),
    qrScanned: false,
    setQrScanned: vi.fn(),
    bytesDecoderRef: { current: null },
    getNetworkOwner: vi.fn(() => ({ network: 'mainnet', generation: 0 })),
    isNetworkOwnerCurrent: vi.fn(() => true),
    resetHardwareState: vi.fn(),
    resetQrState: vi.fn(),
    resetValidation: vi.fn(),
    ...overrides,
  };
}

function renderImportWalletWithState(state: Record<string, unknown>) {
  const mutateAsync = vi.fn();
  mockUseImportState.mockReturnValue(state);
  mockUseImportWallet.mockReturnValue({
    mutateAsync,
    isLoading: false,
  });

  const view = render(<ImportWallet />);
  return { mutateAsync, unmount: view.unmount };
}

describe('ImportWallet logic branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateImportData.mockResolvedValue(true);
    mockBuildDescriptorFromXpub.mockReturnValue('wpkh([abcd]xpub/<0;1>/*)');
  });

  it('moves from step 1 to step 2 when format is selected', async () => {
    const user = userEvent.setup();
    const state = createState({
      step: 1,
      format: 'descriptor',
    });
    renderImportWalletWithState(state);

    await user.click(screen.getByRole('button', { name: /Next Step/i }));
    expect(state.setStep).toHaveBeenCalledWith(2);
  });

  it('handles step 2 hardware validation flow with descriptor build override', async () => {
    const user = userEvent.setup();
    const state = createState({
      step: 2,
      format: 'hardware',
      xpubData: {
        fingerprint: 'a1b2c3d4',
        path: "m/84'/0'/0'",
        xpub: 'xpub123',
      },
      scriptType: 'native_segwit',
      importData: '',
      walletName: '',
    });
    renderImportWalletWithState(state);

    await user.click(screen.getByRole('button', { name: /Next Step/i }));

    await waitFor(() => {
      expect(mockBuildDescriptorFromXpub).toHaveBeenCalledWith(
        'native_segwit',
        'a1b2c3d4',
        "m/84'/0'/0'",
        'xpub123',
      );
    });
    expect(state.setImportData).toHaveBeenCalledWith('wpkh([abcd]xpub/<0;1>/*)');
    expect(mockValidateImportData).toHaveBeenCalledWith(
      'hardware',
      '',
      '',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      'mainnet',
      'wpkh([abcd]xpub/<0;1>/*)',
    );
    expect(state.setIsValidating).toHaveBeenNthCalledWith(1, true);
    expect(state.setStep).toHaveBeenCalledWith(3);
    expect(state.setIsValidating).toHaveBeenLastCalledWith(false);
  });

  it('handles qr-code and descriptor validation paths on step 2', async () => {
    const user = userEvent.setup();
    const qrState = createState({
      step: 2,
      format: 'qr_code',
      qrScanned: true,
      importData: '{"type":"single_sig"}',
    });
    const qrRender = renderImportWalletWithState(qrState);

    await user.click(screen.getByRole('button', { name: /Next Step/i }));
    await waitFor(() => {
      expect(mockValidateImportData).toHaveBeenCalled();
    });
    expect(qrState.setStep).toHaveBeenCalledWith(3);
    qrRender.unmount();

    vi.clearAllMocks();
    mockValidateImportData.mockResolvedValue(false);
    const descriptorState = createState({
      step: 2,
      format: 'descriptor',
      importData: 'wpkh([abcd]xpub/0/*)',
    });
    renderImportWalletWithState(descriptorState);

    await user.click(screen.getByRole('button', { name: /Next Step/i }));
    await waitFor(() => {
      expect(mockValidateImportData).toHaveBeenCalled();
    });
    expect(descriptorState.setStep).not.toHaveBeenCalledWith(3);
  });

  it('does not advance or clear new loading state when validation resolves after A-B-A', async () => {
    const user = userEvent.setup();
    let resolveValidation!: (valid: boolean) => void;
    mockValidateImportData.mockReturnValue(new Promise<boolean>((resolve) => {
      resolveValidation = resolve;
    }));
    const originalOwner = { network: 'mainnet', generation: 0 };
    let activeOwner = originalOwner;
    const state = createState({
      step: 2,
      format: 'descriptor',
      importData: 'wpkh(old)',
      getNetworkOwner: () => originalOwner,
      isNetworkOwnerCurrent: (owner: unknown) => owner === activeOwner,
    });
    renderImportWalletWithState(state);

    await user.click(screen.getByRole('button', { name: /Next Step/i }));
    await waitFor(() => expect(mockValidateImportData).toHaveBeenCalled());
    activeOwner = { network: 'mainnet', generation: 2 };
    const staleSetValidationError = mockValidateImportData.mock.calls[0][4] as (
      error: string | null,
    ) => void;
    staleSetValidationError('stale validation failure');
    resolveValidation(true);

    await waitFor(() => expect(state.setStep).not.toHaveBeenCalledWith(3));
    expect(state.setIsValidating).toHaveBeenCalledTimes(1);
    expect(state.setValidationError).not.toHaveBeenCalled();
  });

  it('advances from step 3 to step 4 when wallet name is present', async () => {
    const user = userEvent.setup();
    const state = createState({
      step: 3,
      walletName: '  Vault  ',
      validationResult: { valid: true },
    });
    renderImportWalletWithState(state);

    await user.click(screen.getByRole('button', { name: /Next Step/i }));
    expect(state.setStep).toHaveBeenCalledWith(4);
  });

  it('applies back navigation cleanup across steps and exits at step 1', async () => {
    const user = userEvent.setup();

    const step3State = createState({
      step: 3,
      walletName: 'Wallet',
      validationResult: { valid: true },
    });
    const step3Render = renderImportWalletWithState(step3State);
    await user.click(screen.getByRole('button', { name: /Back/i }));
    expect(step3State.setStep).toHaveBeenCalledWith(2);
    expect(step3State.resetValidation).toHaveBeenCalledTimes(1);
    step3Render.unmount();

    const step2State = createState({
      step: 2,
      format: 'descriptor',
      importData: 'wpkh(...)',
    });
    const step2Render = renderImportWalletWithState(step2State);
    await user.click(screen.getByRole('button', { name: /Back/i }));
    expect(step2State.setStep).toHaveBeenCalledWith(1);
    expect(step2State.resetHardwareState).toHaveBeenCalledTimes(1);
    expect(step2State.resetQrState).toHaveBeenCalledTimes(1);
    step2Render.unmount();

    const step1State = createState({ step: 1 });
    renderImportWalletWithState(step1State);
    await user.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/wallets');
  });

  it('imports wallet successfully and navigates to wallet detail', async () => {
    const user = userEvent.setup();
    const state = createState({
      step: 4,
      importData: 'wpkh(...)',
      walletName: '  Imported Vault  ',
      network: 'testnet3',
      validationResult: { valid: true },
      getNetworkOwner: () => ({ network: 'testnet3', generation: 0 }),
    });
    const { mutateAsync } = renderImportWalletWithState(state);
    mutateAsync.mockResolvedValueOnce({ wallet: { id: 'wallet-123' } });

    await user.click(screen.getByRole('button', { name: /Import Wallet/i }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        data: 'wpkh(...)',
        name: 'Imported Vault',
        network: 'testnet3',
      });
    });
    expect(state.setIsImporting).toHaveBeenNthCalledWith(1, true);
    expect(state.setImportError).toHaveBeenNthCalledWith(1, null);
    expect(mockNavigate).toHaveBeenCalledWith('/wallets/wallet-123');
    expect(state.setIsImporting).toHaveBeenLastCalledWith(false);
  });

  it('suppresses stale import resolve and finally commits', async () => {
    const user = userEvent.setup();
    let resolveImport!: (result: { wallet: { id: string } }) => void;
    const originalOwner = { network: 'mainnet', generation: 0 };
    let activeOwner = originalOwner;
    const state = createState({
      step: 4,
      importData: 'wpkh(old)',
      walletName: 'Old Wallet',
      validationResult: { valid: true },
      getNetworkOwner: () => originalOwner,
      isNetworkOwnerCurrent: (owner: unknown) => owner === activeOwner,
    });
    const { mutateAsync } = renderImportWalletWithState(state);
    mutateAsync.mockReturnValue(new Promise((resolve) => {
      resolveImport = resolve;
    }));

    await user.click(screen.getByRole('button', { name: /Import Wallet/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    activeOwner = { network: 'mainnet', generation: 2 };
    resolveImport({ wallet: { id: 'stale-wallet' } });

    await waitFor(() => expect(mockNavigate).not.toHaveBeenCalledWith('/wallets/stale-wallet'));
    expect(state.setImportError).toHaveBeenCalledTimes(1);
    expect(state.setIsImporting).toHaveBeenCalledTimes(1);
  });

  it('suppresses stale import rejection and its finally commit after unmount', async () => {
    const user = userEvent.setup();
    let rejectImport!: (error: Error) => void;
    let mounted = true;
    const state = createState({
      step: 4,
      importData: 'wpkh(old)',
      walletName: 'Old Wallet',
      validationResult: { valid: true },
      isNetworkOwnerCurrent: () => mounted,
    });
    const { mutateAsync, unmount } = renderImportWalletWithState(state);
    mutateAsync.mockReturnValue(new Promise((_, reject) => {
      rejectImport = reject;
    }));

    await user.click(screen.getByRole('button', { name: /Import Wallet/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    mounted = false;
    unmount();
    rejectImport(new Error('stale import failure'));

    await waitFor(() => expect(state.setImportError).toHaveBeenCalledTimes(1));
    expect(state.setIsImporting).toHaveBeenCalledTimes(1);
  });

  it('blocks submit when the rendered review owner is stale', async () => {
    const user = userEvent.setup();
    const owner = { network: 'mainnet', generation: 0 };
    const state = createState({
      step: 4,
      importData: 'wpkh(old)',
      walletName: 'Old Wallet',
      validationResult: { valid: true },
      getNetworkOwner: () => owner,
      isNetworkOwnerCurrent: () => false,
    });
    const { mutateAsync } = renderImportWalletWithState(state);

    expect(screen.getByRole('button', { name: /Import Wallet/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Import Wallet/i }));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('handles ApiError and generic import failures', async () => {
    const user = userEvent.setup();

    const apiErrorState = createState({
      step: 4,
      importData: 'data',
      walletName: 'Wallet',
      validationResult: { valid: true },
    });
    const apiErrorRender = renderImportWalletWithState(apiErrorState);
    apiErrorRender.mutateAsync.mockRejectedValueOnce(new ApiError('Import denied', 400));

    await user.click(screen.getByRole('button', { name: /Import Wallet/i }));
    await waitFor(() => {
      expect(apiErrorState.setImportError).toHaveBeenCalledWith('Import denied');
    });
    expect(apiErrorState.setIsImporting).toHaveBeenLastCalledWith(false);
    apiErrorRender.unmount();

    const genericErrorState = createState({
      step: 4,
      importData: 'data',
      walletName: 'Wallet',
      validationResult: { valid: true },
    });
    const genericRender = renderImportWalletWithState(genericErrorState);
    genericRender.mutateAsync.mockRejectedValueOnce(new Error('boom'));

    await user.click(screen.getByRole('button', { name: /Import Wallet/i }));
    await waitFor(() => {
      expect(genericErrorState.setImportError).toHaveBeenCalledWith(
        'Failed to import wallet. Please try again.',
      );
    });
  });

  it('keeps next button disabled for invalid step state guards', () => {
    const step1State = createState({ step: 1, format: null });
    const step1Render = renderImportWalletWithState(step1State);
    expect(screen.getByRole('button', { name: /Next Step/i })).toBeDisabled();
    step1Render.unmount();

    const hardwareState = createState({
      step: 2,
      format: 'hardware',
      xpubData: null,
    });
    renderImportWalletWithState(hardwareState);
    expect(screen.getByRole('button', { name: /Next Step/i })).toBeDisabled();
  });
});
