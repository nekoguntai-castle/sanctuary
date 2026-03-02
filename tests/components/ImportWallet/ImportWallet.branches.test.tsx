import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportWallet } from '../../../components/ImportWallet/ImportWallet';

const mockNavigate = vi.fn();
const mockUseImportState = vi.fn();
const mockUseImportWallet = vi.fn();
const mockValidateImportData = vi.fn();
const mockBuildDescriptorFromXpub = vi.fn();

vi.mock('../../../utils/logger', () => ({
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

vi.mock('../../../hooks/queries/useWallets', () => ({
  useImportWallet: () => mockUseImportWallet(),
}));

vi.mock('../../../components/ImportWallet/hooks/useImportState', () => ({
  useImportState: () => mockUseImportState(),
}));

vi.mock('../../../components/ImportWallet/importHelpers', async () => {
  const actual = await vi.importActual('../../../components/ImportWallet/importHelpers');
  return {
    ...actual,
    buildDescriptorFromXpub: (...args: unknown[]) => mockBuildDescriptorFromXpub(...args),
    validateImportData: (...args: unknown[]) => mockValidateImportData(...args),
  };
});

vi.mock('../../../components/ImportWallet/steps/FormatSelection', () => ({
  FormatSelection: () => <div data-testid="step-format-selection" />,
}));

vi.mock('../../../components/ImportWallet/steps/DescriptorInput', () => ({
  DescriptorInput: () => <div data-testid="step-descriptor-input" />,
}));

vi.mock('../../../components/ImportWallet/steps/HardwareImport', () => ({
  HardwareImport: () => <div data-testid="step-hardware-import" />,
}));

vi.mock('../../../components/ImportWallet/steps/QrScanStep', () => ({
  QrScanStep: () => <div data-testid="step-qr-scan" />,
}));

vi.mock('../../../components/ImportWallet/DeviceResolution', () => ({
  DeviceResolutionStep: () => <div data-testid="step-device-resolution" />,
}));

vi.mock('../../../components/ImportWallet/ImportReview', () => ({
  ImportReview: () => <div data-testid="step-import-review" />,
}));

// Branch tests need to click guarded paths, so this mock intentionally ignores `disabled`.
vi.mock('../../../components/ui/Button', () => ({
  Button: ({
    onClick,
    children,
  }: {
    onClick?: () => void;
    children: React.ReactNode;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
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
    resetHardwareState: vi.fn(),
    resetQrState: vi.fn(),
    resetValidation: vi.fn(),
    ...overrides,
  };
}

function renderImportWalletWithState(state: Record<string, unknown>) {
  mockUseImportState.mockReturnValue(state);
  mockUseImportWallet.mockReturnValue({
    mutateAsync: vi.fn(),
    isLoading: false,
  });
  return render(<ImportWallet />);
}

describe('ImportWallet guard branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateImportData.mockResolvedValue(true);
    mockBuildDescriptorFromXpub.mockReturnValue('wpkh([abcd]xpub/0/*)');
  });

  it('returns early for hardware flow when xpub data is missing', async () => {
    const user = userEvent.setup();
    const state = createState({
      step: 2,
      format: 'hardware',
      xpubData: null,
    });
    renderImportWalletWithState(state);

    await user.click(screen.getByRole('button', { name: /Next Step/i }));

    expect(mockBuildDescriptorFromXpub).not.toHaveBeenCalled();
    expect(mockValidateImportData).not.toHaveBeenCalled();
    expect(state.setStep).not.toHaveBeenCalledWith(3);
  });

  it('stays on step 2 when hardware validation fails', async () => {
    const user = userEvent.setup();
    mockValidateImportData.mockResolvedValueOnce(false);
    const state = createState({
      step: 2,
      format: 'hardware',
      xpubData: {
        fingerprint: 'a1b2c3d4',
        path: "m/84'/0'/0'",
        xpub: 'xpub123',
      },
    });
    renderImportWalletWithState(state);

    await user.click(screen.getByRole('button', { name: /Next Step/i }));

    expect(mockValidateImportData).toHaveBeenCalled();
    expect(state.setStep).not.toHaveBeenCalledWith(3);
  });

  it('stays on step 2 when qr validation fails', async () => {
    const user = userEvent.setup();
    mockValidateImportData.mockResolvedValueOnce(false);
    const state = createState({
      step: 2,
      format: 'qr_code',
      qrScanned: true,
      importData: '{"descriptor":"..."}',
    });
    renderImportWalletWithState(state);

    await user.click(screen.getByRole('button', { name: /Next Step/i }));

    expect(mockValidateImportData).toHaveBeenCalled();
    expect(state.setStep).not.toHaveBeenCalledWith(3);
  });

  it('skips validation when generic step-2 input is empty', async () => {
    const user = userEvent.setup();
    const state = createState({
      step: 2,
      format: 'descriptor',
      importData: '   ',
    });
    renderImportWalletWithState(state);

    await user.click(screen.getByRole('button', { name: /Next Step/i }));

    expect(mockValidateImportData).not.toHaveBeenCalled();
    expect(state.setStep).not.toHaveBeenCalledWith(3);
  });

  it('does not advance from step 3 when wallet name is blank', async () => {
    const user = userEvent.setup();
    const state = createState({
      step: 3,
      walletName: '   ',
      validationResult: { valid: true },
    });
    renderImportWalletWithState(state);

    await user.click(screen.getByRole('button', { name: /Next Step/i }));

    expect(state.setStep).not.toHaveBeenCalledWith(4);
  });
});
