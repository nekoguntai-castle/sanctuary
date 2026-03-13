import { render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll,beforeEach,describe,expect,it,vi } from 'vitest';
import { ConnectDevice } from '../../../components/ConnectDevice/ConnectDevice';

const mockNavigate = vi.fn();
const parseDeviceJsonMock = vi.hoisted(() => vi.fn());
const saveDeviceMock = vi.hoisted(() => vi.fn());
const mergeDeviceMock = vi.hoisted(() => vi.fn());
const clearConflictMock = vi.hoisted(() => vi.fn());
const connectUsbMock = vi.hoisted(() => vi.fn());

const hookState = vi.hoisted(() => ({
  model: {
    id: 'model-1',
    slug: 'coldcard-mk4',
    name: 'Coldcard MK4',
    manufacturer: 'Coinkite',
    connectivity: ['usb', 'sd_card', 'qr_code', 'manual'],
  },
  qr: {
    qrMode: 'camera',
    cameraActive: false,
    setCameraActive: vi.fn(),
    setQrMode: vi.fn(),
    cameraError: null as string | null,
    urProgress: null as any,
    scanning: false,
    scanResult: null as any,
    error: null as string | null,
    handleQrScan: vi.fn(),
    handleCameraError: vi.fn(),
    handleFileContent: vi.fn(),
    reset: vi.fn(),
    stopCamera: vi.fn(),
  },
  usb: {
    scanning: false,
    usbProgress: null as any,
    connectionResult: null as any,
    error: null as string | null,
    connectUsb: (...args: unknown[]) => connectUsbMock(...args),
    reset: vi.fn(),
  },
  save: {
    saving: false,
    merging: false,
    error: null as string | null,
    conflictData: {
      existingDevice: { id: 'existing-1' },
    } as any,
    saveDevice: (...args: unknown[]) => saveDeviceMock(...args),
    mergeDevice: (...args: unknown[]) => mergeDeviceMock(...args),
    clearConflict: () => clearConflictMock(),
    reset: vi.fn(),
  },
  models: {
    filteredModels: [] as any[],
    manufacturers: ['Coinkite'],
    loading: false,
    error: null as string | null,
    selectedManufacturer: 'all',
    searchQuery: '',
    setSelectedManufacturer: vi.fn(),
    setSearchQuery: vi.fn(),
    clearFilters: vi.fn(),
  },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../../services/deviceParsers', () => ({
  parseDeviceJson: (...args: unknown[]) => parseDeviceJsonMock(...args),
}));

vi.mock('../../../services/hardwareWallet', () => ({
  isSecureContext: () => false,
}));

vi.mock('../../../hooks/useDeviceModels', () => ({
  useDeviceModels: () => hookState.models,
}));

vi.mock('../../../hooks/useDeviceSave', () => ({
  useDeviceSave: () => hookState.save,
}));

vi.mock('../../../hooks/qr/useQrScanner', () => ({
  useQrScanner: () => hookState.qr,
}));

vi.mock('../../../hooks/useDeviceConnection', () => ({
  useDeviceConnection: () => hookState.usb,
}));

vi.mock('../../../utils/deviceConnection', () => ({
  getAvailableMethods: () => ['usb', 'sd_card', 'qr_code', 'manual'],
  normalizeDerivationPath: (path: string) => `norm:${path}`,
}));

vi.mock('../../../components/ConnectDevice/DeviceModelSelector', () => ({
  DeviceModelSelector: ({ onSelectModel }: any) => (
    <button onClick={() => onSelectModel(hookState.model)}>select-model</button>
  ),
}));

vi.mock('../../../components/ConnectDevice/ConnectionMethodSelector', () => ({
  ConnectionMethodSelector: ({ onSelectMethod }: any) => (
    <div>
      <button onClick={() => onSelectMethod('usb')}>method-usb</button>
      <button onClick={() => onSelectMethod('sd_card')}>method-sd</button>
      <button onClick={() => onSelectMethod('qr_code')}>method-qr</button>
      <button onClick={() => onSelectMethod('manual')}>method-manual</button>
    </div>
  ),
}));

vi.mock('../../../components/ConnectDevice/UsbConnectionPanel', () => ({
  UsbConnectionPanel: ({ onConnect, selectedModel }: any) => (
    <button onClick={onConnect}>{`usb-panel-${selectedModel.name}`}</button>
  ),
}));

vi.mock('../../../components/ConnectDevice/QrScannerPanel', () => ({
  QrScannerPanel: ({ selectedModel, onStopCamera }: any) => (
    <div>
      <span>{`qr-panel-${selectedModel.name}`}</span>
      <button onClick={onStopCamera}>stop-camera</button>
    </div>
  ),
}));

vi.mock('../../../components/ConnectDevice/FileUploadPanel', () => ({
  FileUploadPanel: ({ onFileUpload }: any) => (
    <div>
      <button
        onClick={() =>
          onFileUpload({
            target: { files: [new File(['{}'], 'device.json')] },
          })
        }
      >
        upload-valid
      </button>
      <button
        onClick={() =>
          onFileUpload({
            target: { files: [] },
          })
        }
      >
        upload-empty
      </button>
    </div>
  ),
}));

vi.mock('../../../components/ConnectDevice/DeviceDetailsForm', () => ({
  DeviceDetailsForm: ({ formData, onFormDataChange, onToggleAccount, onToggleQrDetails, onSave, warning }: any) => (
    <div>
      <div data-testid="form-label">{formData.label}</div>
      <div data-testid="form-fingerprint">{formData.fingerprint}</div>
      <div data-testid="form-xpub">{formData.xpub}</div>
      <div data-testid="form-derivation">{formData.derivationPath}</div>
      <div data-testid="form-accounts">{formData.parsedAccounts.length}</div>
      {warning && <div>{warning}</div>}
      <button onClick={onSave}>save-device</button>
      <button onClick={() => onToggleAccount(0)}>toggle-account-0</button>
      <button onClick={() => onToggleAccount(0)}>toggle-account-0-again</button>
      <button
        onClick={() =>
          onFormDataChange({
            label: 'Custom Label',
          })
        }
      >
        set-custom-label
      </button>
      <button
        onClick={() =>
          onFormDataChange({
            label: '',
            fingerprint: '',
            xpub: 'manual-xpub',
            derivationPath: "m/84'/0'/9'",
            parsedAccounts: [],
            selectedAccounts: new Set(),
          })
        }
      >
        set-manual-empty
      </button>
      <button
        onClick={() =>
          onFormDataChange({
            parsedAccounts: [{
              purpose: 'single_sig',
              scriptType: 'native_segwit',
              derivationPath: "m/84'/0'/2'",
              xpub: 'xpub-account-1',
            }],
            selectedAccounts: new Set([0]),
          })
        }
      >
        set-one-account
      </button>
      <button
        onClick={() =>
          onFormDataChange({
            label: '',
            fingerprint: '',
            xpub: 'fallback-xpub',
            derivationPath: "m/84'/0'/7'",
            parsedAccounts: [{
              purpose: 'single_sig',
              scriptType: 'native_segwit',
              derivationPath: "m/84'/0'/7'",
              xpub: 'xpub-unselected',
            }],
            selectedAccounts: new Set([99]),
          })
        }
      >
        set-unselected-account
      </button>
      <button onClick={onToggleQrDetails}>toggle-qr-details</button>
    </div>
  ),
}));

vi.mock('../../../components/ConnectDevice/ConflictDialog', () => ({
  ConflictDialog: ({ onMerge, onViewExisting, onCancel }: any) => (
    <div>
      <button onClick={onMerge}>merge-device</button>
      <button onClick={onViewExisting}>view-existing</button>
      <button onClick={onCancel}>cancel-conflict</button>
    </div>
  ),
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const originalFileReader = globalThis.FileReader;

class MockFileReader {
  onload: ((event: { target?: { result?: string } }) => void) | null = null;
  onerror: (() => void) | null = null;

  readAsText() {
    this.onload?.({ target: { result: '{}' } });
  }
}

class ErrorFileReader {
  onload: ((event: { target?: { result?: string } }) => void) | null = null;
  onerror: (() => void) | null = null;

  readAsText() {
    this.onerror?.();
  }
}

describe('ConnectDevice branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    hookState.qr.scanResult = null;
    hookState.usb.connectionResult = null;
    hookState.save.conflictData = { existingDevice: { id: 'existing-1' } } as any;
    hookState.models.filteredModels = [hookState.model] as any[];

    parseDeviceJsonMock.mockReturnValue(null);
    // @ts-expect-error test override
    globalThis.FileReader = MockFileReader;
  });

  it('covers save/merge guards, QR parse branches, account selection toggles, and save/merge payload paths', async () => {
    const user = userEvent.setup();
    render(<ConnectDevice />);

    // Guard paths when no model selected
    await user.click(screen.getByRole('button', { name: 'save-device' }));
    await user.click(screen.getByRole('button', { name: 'merge-device' }));
    expect(saveDeviceMock).not.toHaveBeenCalled();
    expect(mergeDeviceMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'select-model' }));
    await user.click(screen.getByRole('button', { name: 'toggle-qr-details' }));

    hookState.qr.scanResult = {
      xpub: 'xpub-qr',
      fingerprint: 'f1f1f1f1',
      derivationPath: "m/84'/0'/0'",
      label: 'QR Label',
      accounts: [{
        purpose: 'single_sig',
        scriptType: 'native_segwit',
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub-acc',
      }],
      extractedFields: {
        xpub: true,
        fingerprint: true,
        derivationPath: true,
        label: true,
      },
      warning: 'qr-warning',
    };

    await user.click(screen.getByRole('button', { name: 'method-qr' }));
    expect(screen.getByText('qr-panel-Coldcard MK4')).toBeInTheDocument();

    // QR label should not override default "My ..."
    expect(screen.getByTestId('form-label')).toHaveTextContent('My Coldcard MK4');
    expect(screen.getByTestId('form-accounts')).toHaveTextContent('1');

    await user.click(screen.getByRole('button', { name: 'toggle-account-0' }));
    await user.click(screen.getByRole('button', { name: 'toggle-account-0-again' }));

    await user.click(screen.getByRole('button', { name: 'save-device' }));
    expect(saveDeviceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'Coldcard MK4',
        label: 'My Coldcard MK4',
        fingerprint: 'f1f1f1f1',
        modelSlug: 'coldcard-mk4',
        accounts: [expect.objectContaining({ xpub: 'xpub-acc' })],
      })
    );

    await user.click(screen.getByRole('button', { name: 'set-manual-empty' }));
    await user.click(screen.getByRole('button', { name: 'save-device' }));
    expect(saveDeviceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Coldcard MK4 ',
        fingerprint: '00000000',
        xpub: 'manual-xpub',
        derivationPath: "m/84'/0'/9'",
      })
    );

    await user.click(screen.getByRole('button', { name: 'set-one-account' }));
    await user.click(screen.getByRole('button', { name: 'merge-device' }));
    expect(mergeDeviceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accounts: [expect.objectContaining({ xpub: 'xpub-account-1' })],
      })
    );

    await user.click(screen.getByRole('button', { name: 'set-manual-empty' }));
    await user.click(screen.getByRole('button', { name: 'merge-device' }));
    expect(mergeDeviceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Coldcard MK4 ',
        fingerprint: '00000000',
        xpub: 'manual-xpub',
      })
    );
  });

  it('covers file upload branches including no-file, valid parse, and parse-failure warning', async () => {
    const user = userEvent.setup();
    render(<ConnectDevice />);

    await user.click(screen.getByRole('button', { name: 'select-model' }));
    await user.click(screen.getByRole('button', { name: 'set-custom-label' }));
    await user.click(screen.getByRole('button', { name: 'method-sd' }));

    await user.click(screen.getByRole('button', { name: 'upload-empty' }));
    expect(parseDeviceJsonMock).not.toHaveBeenCalled();

    parseDeviceJsonMock.mockReturnValueOnce({
      xpub: 'xpub-file',
      fingerprint: 'ffff1111',
      derivationPath: "m/84h/0h/1h",
      label: 'Imported Label',
      accounts: [{
        purpose: 'single_sig',
        scriptType: 'native_segwit',
        derivationPath: "m/84'/0'/1'",
        xpub: 'xpub-file-account',
      }],
    });

    await user.click(screen.getByRole('button', { name: 'upload-valid' }));
    expect(screen.getByTestId('form-label')).toHaveTextContent('Imported Label');
    expect(screen.getByTestId('form-fingerprint')).toHaveTextContent('ffff1111');
    expect(screen.getByTestId('form-xpub')).toHaveTextContent('xpub-file');
    expect(screen.getByTestId('form-derivation')).toHaveTextContent("norm:m/84h/0h/1h");
    expect(screen.getByTestId('form-accounts')).toHaveTextContent('1');

    parseDeviceJsonMock.mockReturnValueOnce(null);
    await user.click(screen.getByRole('button', { name: 'upload-valid' }));
    expect(screen.getByText('Could not parse file. Please check the format.')).toBeInTheDocument();
  });

  it('covers file reader onerror branch', async () => {
    const user = userEvent.setup();
    render(<ConnectDevice />);

    // @ts-expect-error test override
    globalThis.FileReader = ErrorFileReader;

    await user.click(screen.getByRole('button', { name: 'select-model' }));
    await user.click(screen.getByRole('button', { name: 'method-sd' }));
    await user.click(screen.getByRole('button', { name: 'upload-valid' }));

    expect(screen.getByText('Failed to read file.')).toBeInTheDocument();
  });

  it('covers QR parse branches when optional fields are missing and label replacement is allowed', async () => {
    const user = userEvent.setup();
    render(<ConnectDevice />);

    await user.click(screen.getByRole('button', { name: 'select-model' }));
    await user.click(screen.getByRole('button', { name: 'set-custom-label' }));

    hookState.qr.scanResult = {
      xpub: 'xpub-qr-minimal',
      fingerprint: 'abcd1234',
      label: 'QR Imported Label',
      extractedFields: {
        xpub: true,
        fingerprint: true,
        derivationPath: false,
        label: true,
      },
      warning: null,
    } as any;

    await user.click(screen.getByRole('button', { name: 'method-qr' }));

    expect(screen.getByTestId('form-label')).toHaveTextContent('QR Imported Label');
    expect(screen.getByTestId('form-fingerprint')).toHaveTextContent('abcd1234');
    expect(screen.getByTestId('form-derivation')).toHaveTextContent("m/84'/0'/0'");
    expect(screen.getByTestId('form-accounts')).toHaveTextContent('0');
  });

  it('covers file parse branches for missing fingerprint/accounts and truthy-but-empty parse results', async () => {
    const user = userEvent.setup();
    render(<ConnectDevice />);

    await user.click(screen.getByRole('button', { name: 'select-model' }));
    await user.click(screen.getByRole('button', { name: 'method-sd' }));

    parseDeviceJsonMock.mockReturnValueOnce({
      xpub: 'xpub-only',
      derivationPath: "m/84h/0h/7h",
    });
    await user.click(screen.getByRole('button', { name: 'upload-valid' }));

    expect(screen.getByTestId('form-xpub')).toHaveTextContent('xpub-only');
    expect(screen.getByTestId('form-fingerprint')).toHaveTextContent('');
    expect(screen.getByTestId('form-derivation')).toHaveTextContent("norm:m/84h/0h/7h");
    expect(screen.getByTestId('form-accounts')).toHaveTextContent('0');

    parseDeviceJsonMock.mockReturnValueOnce({});
    await user.click(screen.getByRole('button', { name: 'upload-valid' }));
    expect(screen.getByText('Could not parse file. Please check the format.')).toBeInTheDocument();
  });

  it('covers save and merge account filtering when selected set does not include parsed account index', async () => {
    const user = userEvent.setup();
    render(<ConnectDevice />);

    await user.click(screen.getByRole('button', { name: 'select-model' }));
    await user.click(screen.getByRole('button', { name: 'set-unselected-account' }));

    await user.click(screen.getByRole('button', { name: 'save-device' }));
    expect(saveDeviceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        xpub: 'fallback-xpub',
        derivationPath: "m/84'/0'/7'",
      })
    );

    await user.click(screen.getByRole('button', { name: 'merge-device' }));
    expect(mergeDeviceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        xpub: 'fallback-xpub',
        derivationPath: "m/84'/0'/7'",
      })
    );
  });
});

afterAll(() => {
  globalThis.FileReader = originalFileReader;
});
