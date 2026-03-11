import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDeviceTypeFromDeviceModel,
  useAddAccountFlow,
} from '../../../../../components/DeviceDetail/accounts/hooks/useAddAccountFlow';
import * as accountImportUtils from '../../../../../components/DeviceDetail/accounts/accountImportUtils';

const parseDeviceJsonMock = vi.hoisted(() => vi.fn());
const connectMock = vi.hoisted(() => vi.fn());
const getAllXpubsMock = vi.hoisted(() => vi.fn());
const disconnectMock = vi.hoisted(() => vi.fn());
const getDeviceMock = vi.hoisted(() => vi.fn());
const addDeviceAccountMock = vi.hoisted(() => vi.fn());
const extractFromUrResultMock = vi.hoisted(() => vi.fn());
const normalizeDerivationPathMock = vi.hoisted(() => vi.fn((path: string) => path));

const loggerSpies = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const decoderConfig = vi.hoisted(() => ({
  bytesQueue: [] as Array<{
    progress?: number;
    complete?: boolean;
    completeQueue?: boolean[];
    success?: boolean;
    rawBytes?: Uint8Array;
  }>,
  urQueue: [] as Array<{
    progress?: number;
    complete?: boolean;
    completeQueue?: boolean[];
    success?: boolean;
    registryType?: unknown;
  }>,
}));

vi.mock('@ngraveio/bc-ur', () => {
  class URDecoder {
    private cfg: {
      progress?: number;
      complete?: boolean;
      completeQueue?: boolean[];
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
      if (this.cfg.completeQueue && this.cfg.completeQueue.length > 0) {
        return this.cfg.completeQueue.shift();
      }
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
      completeQueue?: boolean[];
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
      if (this.cfg.completeQueue && this.cfg.completeQueue.length > 0) {
        return this.cfg.completeQueue.shift();
      }
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

vi.mock('../../../../../services/deviceParsers', () => ({
  parseDeviceJson: (...args: unknown[]) => parseDeviceJsonMock(...args),
}));

vi.mock('../../../../../services/hardwareWallet/runtime', () => ({
  hardwareWalletService: {
    connect: (...args: unknown[]) => connectMock(...args),
    getAllXpubs: (...args: unknown[]) => getAllXpubsMock(...args),
    disconnect: (...args: unknown[]) => disconnectMock(...args),
  },
  DeviceType: {},
}));

vi.mock('../../../../../src/api/devices', () => ({
  getDevice: (...args: unknown[]) => getDeviceMock(...args),
  addDeviceAccount: (...args: unknown[]) => addDeviceAccountMock(...args),
}));

vi.mock('../../../../../components/DeviceDetail/accounts/urHelpers', () => ({
  extractFromUrResult: (...args: unknown[]) => extractFromUrResultMock(...args),
  normalizeDerivationPath: (...args: unknown[]) => normalizeDerivationPathMock(...args),
}));

vi.mock('../../../../../utils/logger', () => ({
  createLogger: () => loggerSpies,
}));

const defaultDevice = {
  id: 'device-1',
  type: 'ledger',
  label: 'Ledger',
  fingerprint: 'abcd1234',
  accounts: [],
};

const onCloseMock = vi.fn();
const onDeviceUpdatedMock = vi.fn();

function renderFlowHook(deviceOverrides: Record<string, unknown> = {}) {
  return renderHook(() =>
    useAddAccountFlow({
      deviceId: 'device-1',
      device: { ...defaultDevice, ...deviceOverrides } as any,
      onClose: onCloseMock,
      onDeviceUpdated: onDeviceUpdatedMock,
    })
  );
}

describe('useAddAccountFlow branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    decoderConfig.bytesQueue = [];
    decoderConfig.urQueue = [];

    connectMock.mockResolvedValue(undefined);
    getAllXpubsMock.mockResolvedValue([]);
    disconnectMock.mockResolvedValue(undefined);
    getDeviceMock.mockResolvedValue({ ...defaultDevice });
    addDeviceAccountMock.mockResolvedValue(undefined);
    parseDeviceJsonMock.mockReturnValue(null);
    extractFromUrResultMock.mockReturnValue(null);
    normalizeDerivationPathMock.mockImplementation((path: string) => path);
  });

  it('maps device models to USB-supported types including trezor and jade', () => {
    expect(getDeviceTypeFromDeviceModel({ type: 'Trezor Model T' } as any)).toBe('trezor');
    expect(getDeviceTypeFromDeviceModel({ type: 'ledger nano x' } as any)).toBe('ledger');
    expect(getDeviceTypeFromDeviceModel({ type: 'coldcard mk4' } as any)).toBe('coldcard');
    expect(getDeviceTypeFromDeviceModel({ type: 'bitbox02' } as any)).toBe('bitbox');
    expect(getDeviceTypeFromDeviceModel({ type: 'jade' } as any)).toBe('jade');
    expect(getDeviceTypeFromDeviceModel({ type: 'specter' } as any)).toBeNull();
  });

  it('returns early for file upload without files and empty QR payload', () => {
    const { result } = renderFlowHook();

    act(() => {
      result.current.handleFileUpload({ target: { files: [] } } as any);
      result.current.handleQrScan([]);
    });

    expect(parseDeviceJsonMock).not.toHaveBeenCalled();
  });

  it('reuses bytes decoder after incomplete part and handles parsed accounts without fingerprint', async () => {
    decoderConfig.bytesQueue.push({
      progress: 0.5,
      completeQueue: [false, true],
      success: true,
      rawBytes: new TextEncoder().encode('{"accounts":[{"xpub":"xpub-a"}]}'),
    });
    parseDeviceJsonMock.mockReturnValue({
      accounts: [
        {
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/1'",
          xpub: 'xpub-a',
        },
      ],
    });

    const { result } = renderFlowHook({ accounts: undefined });

    act(() => {
      result.current.handleQrScan([{ rawValue: 'ur:bytes/1-2' }]);
    });
    expect(result.current.parsedAccounts).toHaveLength(0);

    act(() => {
      result.current.handleQrScan([{ rawValue: 'ur:bytes/2-2' }]);
    });

    await waitFor(() => expect(result.current.parsedAccounts).toHaveLength(1));
    expect(result.current.importFingerprint).toBe('');
  });

  it('handles bytes UR with xpub-only payload and fallback fingerprint', async () => {
    decoderConfig.bytesQueue.push({
      progress: 1,
      complete: true,
      success: true,
      rawBytes: new TextEncoder().encode('{"xpub":"xpub-b"}'),
    });
    parseDeviceJsonMock.mockReturnValue({
      xpub: 'xpub-b',
      derivationPath: "m/84'/0'/2'",
    });

    const { result } = renderFlowHook();

    act(() => {
      result.current.handleQrScan([{ rawValue: 'ur:bytes/single' }]);
    });

    await waitFor(() => expect(result.current.parsedAccounts).toHaveLength(1));
    expect(result.current.importFingerprint).toBe('');
    expect(result.current.parsedAccounts[0].xpub).toBe('xpub-b');
  });

  it('surfaces bytes UR extraction failure when decoded payload has no accounts or xpub', async () => {
    decoderConfig.bytesQueue.push({
      progress: 1,
      complete: true,
      success: true,
      rawBytes: new TextEncoder().encode('{}'),
    });
    parseDeviceJsonMock.mockReturnValue({});

    const { result } = renderFlowHook();

    act(() => {
      result.current.handleQrScan([{ rawValue: 'ur:bytes/bad' }]);
    });

    await waitFor(() => expect(result.current.addAccountError).toBe('Could not extract accounts from ur:bytes'));
  });

  it('reuses UR registry decoder and falls back to default derivation path when normalization returns empty', async () => {
    decoderConfig.urQueue.push({
      progress: 0.6,
      completeQueue: [false, true],
      success: true,
      registryType: { kind: 'crypto-hdkey' },
    });
    extractFromUrResultMock.mockReturnValue({
      xpub: 'xpub-ur',
      path: "m/48'/0'/0'/2'",
    });
    normalizeDerivationPathMock.mockReturnValueOnce(undefined);

    const { result } = renderFlowHook();

    act(() => {
      result.current.handleQrScan([{ rawValue: 'ur:crypto-hdkey/1-2' }]);
    });
    expect(result.current.parsedAccounts).toHaveLength(0);

    act(() => {
      result.current.handleQrScan([{ rawValue: 'ur:crypto-hdkey/2-2' }]);
    });

    await waitFor(() => expect(result.current.parsedAccounts).toHaveLength(1));
    expect(result.current.parsedAccounts[0].purpose).toBe('multisig');
    expect(result.current.parsedAccounts[0].derivationPath).toBe("m/84'/0'/0'");
    expect(result.current.importFingerprint).toBe('');
  });

  it('handles UR decode failure and non-Error exceptions in decoder processing', async () => {
    decoderConfig.urQueue.push({
      progress: 1,
      complete: true,
      success: false,
      registryType: { kind: 'crypto-hdkey' },
    });
    const first = renderFlowHook();
    act(() => {
      first.result.current.handleQrScan([{ rawValue: 'ur:' }]);
    });
    await waitFor(() => expect(first.result.current.addAccountError).toBe('UR decode failed'));
    first.unmount();

    decoderConfig.urQueue.push({
      progress: 1,
      complete: true,
      success: true,
      registryType: { kind: 'crypto-hdkey' },
    });
    extractFromUrResultMock.mockImplementationOnce(() => {
      throw 'decode-string-error';
    });
    const second = renderFlowHook();
    act(() => {
      second.result.current.handleQrScan([{ rawValue: 'ur:crypto-hdkey/1-1' }]);
    });
    await waitFor(() => expect(second.result.current.addAccountError).toBe('Failed to decode UR QR code'));
  });

  it('handles non-UR xpub parsing path and camera not-allowed error branch', async () => {
    parseDeviceJsonMock.mockReturnValueOnce({
      xpub: 'xpub-plain',
      derivationPath: "m/84'/0'/3'",
    });

    const { result } = renderFlowHook();

    act(() => {
      result.current.handleQrScan([{ rawValue: 'plain-payload' }]);
    });
    await waitFor(() => expect(result.current.parsedAccounts).toHaveLength(1));
    expect(result.current.importFingerprint).toBe('');

    act(() => {
      result.current.handleCameraError(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    });
    expect(result.current.cameraError).toBe('Camera access denied. Please allow camera permissions.');
  });

  it('uses empty matching account fallback when import processing omits matchingAccounts', async () => {
    const processSpy = vi
      .spyOn(accountImportUtils, 'processImportedAccounts')
      .mockReturnValueOnce({
        newAccounts: [
          {
            purpose: 'single_sig',
            scriptType: 'native_segwit',
            derivationPath: "m/84'/0'/6'",
            xpub: 'xpub-6',
          },
        ],
      } as any);

    parseDeviceJsonMock.mockReturnValueOnce({
      accounts: [
        {
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/6'",
          xpub: 'xpub-6',
        },
      ],
      fingerprint: 'abcd1234',
    });

    const { result } = renderFlowHook({ accounts: undefined });

    act(() => {
      result.current.handleQrScan([{ rawValue: 'plain-accounts' }]);
    });

    await waitFor(() => expect(result.current.accountConflict).not.toBeNull());
    expect(result.current.accountConflict?.matchingAccounts).toEqual([]);
    processSpy.mockRestore();
  });

  it('covers USB unsupported model, accounts fallback path, and non-Error connect failures', async () => {
    const unsupported = renderFlowHook({ type: 'specter' });
    await act(async () => {
      await unsupported.result.current.handleAddAccountsViaUsb();
    });
    expect(unsupported.result.current.addAccountError).toBe('USB connection not supported for this device type');
    expect(connectMock).not.toHaveBeenCalled();
    unsupported.unmount();

    getAllXpubsMock.mockResolvedValueOnce([
      { purpose: 'single_sig', scriptType: 'native_segwit', path: "m/84'/0'/0'", xpub: 'xpub-new' },
    ]);
    const success = renderFlowHook({ accounts: undefined });
    await act(async () => {
      await success.result.current.handleAddAccountsViaUsb();
    });
    expect(addDeviceAccountMock).toHaveBeenCalledWith(
      'device-1',
      expect.objectContaining({ derivationPath: "m/84'/0'/0'", xpub: 'xpub-new' })
    );
    expect(onDeviceUpdatedMock).toHaveBeenCalled();
    expect(onCloseMock).toHaveBeenCalled();
    expect(disconnectMock).toHaveBeenCalled();
    success.unmount();

    connectMock.mockRejectedValueOnce('usb-string-error');
    const failed = renderFlowHook({ type: 'ledger' });
    await act(async () => {
      await failed.result.current.handleAddAccountsViaUsb();
    });
    expect(failed.result.current.addAccountError).toBe('Failed to connect to device');
  });

  it('skips unselected parsed accounts and handles non-Error refresh failures', async () => {
    parseDeviceJsonMock.mockReturnValueOnce({
      accounts: [
        {
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/4'",
          xpub: 'xpub-4',
        },
        {
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/5'",
          xpub: 'xpub-5',
        },
      ],
    });

    const { result } = renderFlowHook();

    act(() => {
      result.current.handleQrScan([{ rawValue: 'plain-two-accounts' }]);
    });
    await waitFor(() => expect(result.current.parsedAccounts).toHaveLength(2));

    act(() => {
      result.current.setSelectedParsedAccounts(new Set([0]));
    });

    getDeviceMock.mockRejectedValueOnce('refresh-string-error');
    await act(async () => {
      await result.current.handleAddParsedAccounts();
    });

    expect(addDeviceAccountMock).toHaveBeenCalledTimes(1);
    expect(addDeviceAccountMock).toHaveBeenCalledWith(
      'device-1',
      expect.objectContaining({ derivationPath: "m/84'/0'/4'", xpub: 'xpub-4' })
    );
    expect(result.current.addAccountError).toBe('Failed to add accounts');
  });

  it('uses Error.message when parsed account refresh throws an Error', async () => {
    parseDeviceJsonMock.mockReturnValueOnce({
      accounts: [
        {
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          derivationPath: "m/84'/0'/7'",
          xpub: 'xpub-7',
        },
      ],
    });

    const { result } = renderFlowHook();

    act(() => {
      result.current.handleQrScan([{ rawValue: 'plain-one-account' }]);
    });
    await waitFor(() => expect(result.current.parsedAccounts).toHaveLength(1));

    getDeviceMock.mockRejectedValueOnce(new Error('refresh-error'));
    await act(async () => {
      await result.current.handleAddParsedAccounts();
    });

    expect(result.current.addAccountError).toBe('refresh-error');
  });
});
