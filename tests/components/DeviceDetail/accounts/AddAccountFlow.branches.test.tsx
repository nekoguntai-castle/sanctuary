import React from 'react';
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddAccountFlow } from '../../../../components/DeviceDetail/accounts/AddAccountFlow';

const parseDeviceJsonMock = vi.hoisted(() => vi.fn());
const connectMock = vi.hoisted(() => vi.fn());
const getAllXpubsMock = vi.hoisted(() => vi.fn());
const disconnectMock = vi.hoisted(() => vi.fn());
const isSecureContextMock = vi.hoisted(() => vi.fn());
const getDeviceMock = vi.hoisted(() => vi.fn());
const addDeviceAccountMock = vi.hoisted(() => vi.fn());
const extractFromUrResultMock = vi.hoisted(() => vi.fn());
const normalizeDerivationPathMock = vi.hoisted(() => vi.fn((path: string) => path));

const loggerSpies = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const decoderConfig = vi.hoisted(() => ({
  bytesQueue: [] as Array<{
    progress?: number;
    complete?: boolean;
    success?: boolean;
    rawBytes?: Uint8Array;
  }>,
  urQueue: [] as Array<{
    progress?: number;
    complete?: boolean;
    success?: boolean;
    registryType?: unknown;
  }>,
}));

vi.mock('@ngraveio/bc-ur', () => {
  class URDecoder {
    private cfg: {
      progress?: number;
      complete?: boolean;
      success?: boolean;
      rawBytes?: Uint8Array;
    };

    constructor() {
      this.cfg = decoderConfig.bytesQueue.shift() || {};
    }

    receivePart(_part: string) {}

    estimatedPercentComplete() {
      return this.cfg.progress ?? 0;
    }

    isComplete() {
      return this.cfg.complete ?? false;
    }

    isSuccess() {
      return this.cfg.success ?? true;
    }

    resultUR() {
      return {
        decodeCBOR: () => this.cfg.rawBytes || new TextEncoder().encode('{}'),
      };
    }
  }

  return { URDecoder };
});

vi.mock('@keystonehq/bc-ur-registry', () => {
  class URRegistryDecoder {
    private cfg: {
      progress?: number;
      complete?: boolean;
      success?: boolean;
      registryType?: unknown;
    };

    constructor() {
      this.cfg = decoderConfig.urQueue.shift() || {};
    }

    receivePart(_part: string) {}

    estimatedPercentComplete() {
      return this.cfg.progress ?? 0;
    }

    isComplete() {
      return this.cfg.complete ?? false;
    }

    isSuccess() {
      return this.cfg.success ?? true;
    }

    resultRegistryType() {
      return this.cfg.registryType;
    }
  }

  return { URRegistryDecoder };
});

vi.mock('../../../../services/deviceParsers', () => ({
  parseDeviceJson: (...args: unknown[]) => parseDeviceJsonMock(...args),
}));

vi.mock('../../../../services/hardwareWallet/environment', () => ({
  isSecureContext: () => isSecureContextMock(),
}));

vi.mock('../../../../services/hardwareWallet', () => ({
  hardwareWalletService: {
    connect: (...args: unknown[]) => connectMock(...args),
    getAllXpubs: (...args: unknown[]) => getAllXpubsMock(...args),
    disconnect: (...args: unknown[]) => disconnectMock(...args),
  },
  DeviceType: {},
}));

vi.mock('../../../../src/api/devices', () => ({
  getDevice: (...args: unknown[]) => getDeviceMock(...args),
  addDeviceAccount: (...args: unknown[]) => addDeviceAccountMock(...args),
}));

vi.mock('../../../../components/DeviceDetail/accounts/urHelpers', () => ({
  extractFromUrResult: (...args: unknown[]) => extractFromUrResultMock(...args),
  normalizeDerivationPath: (...args: unknown[]) => normalizeDerivationPathMock(...args),
}));

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => loggerSpies,
}));

vi.mock('../../../../components/DeviceDetail/ManualAccountForm', () => ({
  ManualAccountForm: ({ account, onChange, onSubmit }: any) => (
    <div data-testid="manual-form">
      <button
        type="button"
        onClick={() => onChange({ ...account, xpub: 'xpub-manual', derivationPath: "m/84'/0'/0'" })}
      >
        Set Manual
      </button>
      <button type="button" onClick={onSubmit}>Submit Manual</button>
    </div>
  ),
}));

vi.mock('../../../../components/DeviceDetail/accounts/ImportReview', () => ({
  ImportReview: ({ parsedAccounts, setSelectedParsedAccounts, onAddParsedAccounts }: any) => (
    <div data-testid="import-review">
      <div>Accounts: {parsedAccounts.length}</div>
      <button type="button" onClick={() => setSelectedParsedAccounts(new Set())}>Clear Selected</button>
      <button type="button" onClick={onAddParsedAccounts}>Add Selected</button>
    </div>
  ),
}));

vi.mock('../../../../components/DeviceDetail/accounts/UsbImport', () => ({
  UsbImport: ({ onConnect, usbProgress }: any) => (
    <div data-testid="usb-import">
      <button type="button" onClick={onConnect}>Connect Device</button>
      {usbProgress && <div>{usbProgress.current}/{usbProgress.total}:{usbProgress.name}</div>}
    </div>
  ),
}));

vi.mock('../../../../components/DeviceDetail/accounts/FileImport', () => ({
  FileImport: ({ onFileUpload }: any) => (
    <div data-testid="file-import">
      <button
        type="button"
        onClick={() => onFileUpload({ target: { files: [new File(['{}'], 'export.json')] } })}
      >
        Trigger File Upload
      </button>
    </div>
  ),
}));

vi.mock('../../../../components/DeviceDetail/accounts/QrImport', () => ({
  QrImport: ({ onQrScan, onCameraError, setQrMode, cameraError }: any) => (
    <div data-testid="qr-import">
      <button type="button" onClick={() => onQrScan([{ rawValue: 'ur:bytes/mock' }])}>Scan UR Bytes</button>
      <button type="button" onClick={() => onQrScan([{ rawValue: 'ur:crypto-hdkey/mock' }])}>Scan UR Other</button>
      <button type="button" onClick={() => onQrScan([{ rawValue: 'plain-payload' }])}>Scan Plain</button>
      <button type="button" onClick={() => onQrScan([])}>Scan Empty</button>
      <button
        type="button"
        onClick={() => onCameraError(Object.assign(new Error('No camera'), { name: 'NotFoundError' }))}
      >
        Camera Not Found
      </button>
      <button type="button" onClick={() => onCameraError(new Error('Camera exploded'))}>Camera Generic</button>
      <button type="button" onClick={() => onCameraError('plain-camera-error')}>Camera Non Error</button>
      <button type="button" onClick={() => setQrMode('file')}>Set File Mode</button>
      {cameraError && <p>{cameraError}</p>}
    </div>
  ),
}));

const defaultDevice = {
  id: 'device-1',
  type: 'ledger',
  label: 'Ledger',
  fingerprint: 'abcd1234',
  accounts: [],
};

const defaultOnClose = vi.fn();
const defaultOnDeviceUpdated = vi.fn();

const renderFlow = (deviceOverrides: Record<string, unknown> = {}) => render(
  <AddAccountFlow
    deviceId="device-1"
    device={{ ...defaultDevice, ...deviceOverrides } as any}
    onClose={defaultOnClose}
    onDeviceUpdated={defaultOnDeviceUpdated}
  />,
);

const originalFileReader = globalThis.FileReader;

function mockFileReaderLoad(payload: string) {
  class MockFileReader {
    onload: ((event: { target?: { result?: string } }) => void) | null = null;
    onerror: (() => void) | null = null;

    readAsText() {
      this.onload?.({ target: { result: payload } });
    }
  }
  // @ts-expect-error test override
  globalThis.FileReader = MockFileReader;
}

function mockFileReaderError() {
  class MockFileReader {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    readAsText() {
      this.onerror?.();
    }
  }
  // @ts-expect-error test override
  globalThis.FileReader = MockFileReader;
}

describe('AddAccountFlow branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    decoderConfig.bytesQueue = [];
    decoderConfig.urQueue = [];
    isSecureContextMock.mockReturnValue(true);
    disconnectMock.mockResolvedValue(undefined);
    connectMock.mockResolvedValue(undefined);
    getAllXpubsMock.mockResolvedValue([]);
    getDeviceMock.mockResolvedValue({ ...defaultDevice });
    addDeviceAccountMock.mockResolvedValue(undefined);
    parseDeviceJsonMock.mockReturnValue(null);
    extractFromUrResultMock.mockReturnValue(null);
  });

  afterEach(() => {
    globalThis.FileReader = originalFileReader;
  });

  it('shows USB option for coldcard/bitbox/jade models', async () => {
    const types = ['coldcard', 'bitbox02', 'jade'];
    for (const type of types) {
      const view = renderFlow({ type });
      expect(screen.getByText('Connect via USB')).toBeInTheDocument();
      view.unmount();
    }
  });

  it('processes file imports across matching/new, no-new, conflicting, parse-fail, and read-error branches', async () => {
    const user = userEvent.setup();

    mockFileReaderLoad('{}');
    parseDeviceJsonMock.mockReturnValueOnce({
      format: 'json',
      fingerprint: 'ABCD1234',
      accounts: [
        {
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/0'",
          xpub: 'xpub-existing',
        },
        {
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/1'",
          xpub: 'xpub-new',
        },
      ],
    });

    const view1 = renderFlow({
      accounts: [{ derivationPath: "m/84'/0'/0'", xpub: 'xpub-existing' }],
    });
    await user.click(screen.getByText('Import from SD Card'));
    await user.click(screen.getByText('Trigger File Upload'));
    expect(await screen.findByTestId('import-review')).toBeInTheDocument();

    addDeviceAccountMock.mockRejectedValueOnce(new Error('add failed'));
    await user.click(screen.getByText('Add Selected'));
    await waitFor(() => {
      expect(addDeviceAccountMock).toHaveBeenCalled();
      expect(defaultOnDeviceUpdated).toHaveBeenCalled();
      expect(defaultOnClose).toHaveBeenCalled();
    });
    expect(loggerSpies.warn).toHaveBeenCalledWith('Failed to add account', expect.any(Object));
    view1.unmount();

    parseDeviceJsonMock.mockReturnValueOnce({
      format: 'json',
      fingerprint: 'abcd1234',
      accounts: [{ purpose: 'single_sig', scriptType: 'native_segwit', derivationPath: "m/84'/0'/0'", xpub: 'xpub-existing' }],
    });
    const view2 = renderFlow({ accounts: [{ derivationPath: "m/84'/0'/0'", xpub: 'xpub-existing' }] });
    await user.click(screen.getByText('Import from SD Card'));
    await user.click(screen.getByText('Trigger File Upload'));
    expect(await screen.findByText(/No new accounts to add/i)).toBeInTheDocument();
    view2.unmount();

    parseDeviceJsonMock.mockReturnValueOnce({
      format: 'json',
      fingerprint: 'abcd1234',
      accounts: [{ purpose: 'single_sig', scriptType: 'native_segwit', derivationPath: "m/84'/0'/0'", xpub: 'xpub-different' }],
    });
    const view3 = renderFlow({ accounts: [{ derivationPath: "m/84'/0'/0'", xpub: 'xpub-existing' }] });
    await user.click(screen.getByText('Import from SD Card'));
    await user.click(screen.getByText('Trigger File Upload'));
    expect(await screen.findByText(/conflicting xpubs/i)).toBeInTheDocument();
    view3.unmount();

    parseDeviceJsonMock.mockReturnValueOnce(null);
    const view4 = renderFlow();
    await user.click(screen.getByText('Import from SD Card'));
    await user.click(screen.getByText('Trigger File Upload'));
    expect(await screen.findByText(/Could not parse file/i)).toBeInTheDocument();
    view4.unmount();

    mockFileReaderError();
    const view5 = renderFlow();
    await user.click(screen.getByText('Import from SD Card'));
    await user.click(screen.getByText('Trigger File Upload'));
    expect(await screen.findByText(/Failed to read file/i)).toBeInTheDocument();
    view5.unmount();
  });

  it('handles UR bytes decode branches (incomplete, failed decode, xpub success)', async () => {
    const user = userEvent.setup();

    decoderConfig.bytesQueue.push({ progress: 0.2, complete: false });
    const view1 = renderFlow();
    await user.click(screen.getByText('Scan QR Code'));
    await user.click(screen.getByText('Scan UR Bytes'));
    expect(parseDeviceJsonMock).not.toHaveBeenCalled();
    view1.unmount();

    decoderConfig.bytesQueue.push({ progress: 1, complete: true, success: false });
    const view2 = renderFlow();
    await user.click(screen.getByText('Scan QR Code'));
    await user.click(screen.getByText('Scan UR Bytes'));
    expect(await screen.findByText('UR bytes decode failed')).toBeInTheDocument();
    view2.unmount();

    decoderConfig.bytesQueue.push({
      progress: 1,
      complete: true,
      success: true,
      rawBytes: new TextEncoder().encode('{"xpub":"xpub-qr"}'),
    });
    parseDeviceJsonMock.mockReturnValueOnce({
      xpub: 'xpub-qr',
      derivationPath: "m/48'/0'/0'/2'",
      fingerprint: 'abcd1234',
    });

    const view3 = renderFlow();
    await user.click(screen.getByText('Scan QR Code'));
    await user.click(screen.getByText('Scan UR Bytes'));
    expect(await screen.findByTestId('import-review')).toBeInTheDocument();
    view3.unmount();
  });

  it('handles non-bytes UR decode branches (incomplete, extraction failure, extraction success)', async () => {
    const user = userEvent.setup();

    decoderConfig.urQueue.push({ progress: 0.4, complete: false });
    const view1 = renderFlow();
    await user.click(screen.getByText('Scan QR Code'));
    await user.click(screen.getByText('Scan UR Other'));
    expect(extractFromUrResultMock).not.toHaveBeenCalled();
    view1.unmount();

    decoderConfig.urQueue.push({ progress: 1, complete: true, success: true, registryType: { kind: 'hdkey' } });
    extractFromUrResultMock.mockReturnValueOnce(null);
    const view2 = renderFlow();
    await user.click(screen.getByText('Scan QR Code'));
    await user.click(screen.getByText('Scan UR Other'));
    expect(await screen.findByText('Could not extract xpub from UR')).toBeInTheDocument();
    view2.unmount();

    decoderConfig.urQueue.push({ progress: 1, complete: true, success: true, registryType: { kind: 'hdkey' } });
    extractFromUrResultMock.mockReturnValueOnce({
      xpub: 'xpub-ur',
      fingerprint: 'abcd1234',
      path: "m/48h/0h/0h/2h",
    });
    normalizeDerivationPathMock.mockReturnValueOnce("m/48'/0'/0'/2'");
    const view3 = renderFlow();
    await user.click(screen.getByText('Scan QR Code'));
    await user.click(screen.getByText('Scan UR Other'));
    expect(await screen.findByTestId('import-review')).toBeInTheDocument();
    expect(normalizeDerivationPathMock).toHaveBeenCalled();
    view3.unmount();
  });

  it('handles plain QR parsing success/failure and camera error variants', async () => {
    const user = userEvent.setup();

    parseDeviceJsonMock.mockReturnValueOnce({
      accounts: [{ purpose: 'single_sig', scriptType: 'native_segwit', derivationPath: "m/84'/0'/0'", xpub: 'xpub-plain' }],
      fingerprint: 'abcd1234',
      format: 'json',
    });
    const view1 = renderFlow();
    await user.click(screen.getByText('Scan QR Code'));
    await user.click(screen.getByText('Scan Plain'));
    expect(await screen.findByTestId('import-review')).toBeInTheDocument();
    view1.unmount();

    parseDeviceJsonMock.mockReturnValueOnce(null);
    const view2 = renderFlow();
    await user.click(screen.getByText('Scan QR Code'));
    await user.click(screen.getByText('Scan Plain'));
    expect(await screen.findByText(/Could not find valid account data in QR code/i)).toBeInTheDocument();
    await user.click(screen.getByText('Camera Not Found'));
    expect(await screen.findByText(/No camera found on this device/i)).toBeInTheDocument();
    await user.click(screen.getByText('Camera Generic'));
    expect(await screen.findByText(/Camera error: Camera exploded/i)).toBeInTheDocument();
    await user.click(screen.getByText('Camera Non Error'));
    expect(await screen.findByText(/Failed to access camera/i)).toBeInTheDocument();
    view2.unmount();
  });

  it('covers USB import progress, filtering, no-new, failure handling, and disconnect cleanup', async () => {
    const user = userEvent.setup();

    getAllXpubsMock.mockImplementationOnce(async (progressCb: (current: number, total: number, name: string) => void) => {
      progressCb(1, 2, 'first');
      return [
        { purpose: 'single_sig', scriptType: 'native_segwit', path: "m/84'/0'/0'", xpub: 'xpub-existing' },
        { purpose: 'single_sig', scriptType: 'taproot', path: "m/86'/0'/0'", xpub: 'xpub-new' },
      ];
    });
    addDeviceAccountMock.mockResolvedValueOnce(undefined);
    const view1 = renderFlow({ type: 'ledger', accounts: [{ derivationPath: "m/84'/0'/0'", xpub: 'xpub-existing' }] });
    await user.click(screen.getByText('Connect via USB'));
    await user.click(screen.getByText('Connect Device'));
    await waitFor(() => {
      expect(addDeviceAccountMock).toHaveBeenCalledWith(
        'device-1',
        expect.objectContaining({ derivationPath: "m/86'/0'/0'", xpub: 'xpub-new' }),
      );
      expect(defaultOnClose).toHaveBeenCalled();
      expect(disconnectMock).toHaveBeenCalled();
    });
    view1.unmount();

    getAllXpubsMock.mockResolvedValueOnce([
      { purpose: 'single_sig', scriptType: 'native_segwit', path: "m/84'/0'/0'", xpub: 'xpub-existing' },
    ]);
    const view2 = renderFlow({ type: 'ledger', accounts: [{ derivationPath: "m/84'/0'/0'", xpub: 'xpub-existing' }] });
    await user.click(screen.getByText('Connect via USB'));
    await user.click(screen.getByText('Connect Device'));
    expect(await screen.findByText(/No new accounts to add/i)).toBeInTheDocument();
    view2.unmount();

    connectMock.mockRejectedValueOnce(new Error('usb connect failed'));
    disconnectMock.mockRejectedValueOnce(new Error('disconnect failed'));
    const view3 = renderFlow({ type: 'ledger' });
    await user.click(screen.getByText('Connect via USB'));
    await user.click(screen.getByText('Connect Device'));
    expect(await screen.findByText('usb connect failed')).toBeInTheDocument();
    await waitFor(() => expect(disconnectMock).toHaveBeenCalled());
    view3.unmount();
  });

  it('covers manual add guard, manual failure fallback, and modal close/back reset behavior', async () => {
    const user = userEvent.setup();

    const view = renderFlow();
    await user.click(screen.getByText('Enter Manually'));
    await user.click(screen.getByText('Submit Manual'));
    expect(addDeviceAccountMock).not.toHaveBeenCalled();

    addDeviceAccountMock.mockRejectedValueOnce('manual-failed-non-error');
    await user.click(screen.getByText('Set Manual'));
    await user.click(screen.getByText('Submit Manual'));
    expect(await screen.findByText('Failed to add account')).toBeInTheDocument();

    await user.click(screen.getByText('← Back to options'));
    expect(screen.getByText(/Choose how to add a new derivation path/i)).toBeInTheDocument();

    await user.click(screen.getByText('Scan QR Code'));
    const closeButtons = screen.getAllByRole('button');
    await user.click(closeButtons[0]);
    expect(defaultOnClose).toHaveBeenCalled();
    view.unmount();
  });

  it('returns early when no parsed accounts are selected in review', async () => {
    const user = userEvent.setup();
    mockFileReaderLoad('{}');
    parseDeviceJsonMock.mockReturnValueOnce({
      format: 'json',
      fingerprint: 'abcd1234',
      accounts: [{ purpose: 'single_sig', scriptType: 'native_segwit', derivationPath: "m/84'/0'/1'", xpub: 'xpub-new' }],
    });

    renderFlow();
    await user.click(screen.getByText('Import from SD Card'));
    await user.click(screen.getByText('Trigger File Upload'));
    expect(await screen.findByTestId('import-review')).toBeInTheDocument();

    await user.click(screen.getByText('Clear Selected'));
    await user.click(screen.getByText('Add Selected'));
    expect(addDeviceAccountMock).not.toHaveBeenCalled();
  });
});
