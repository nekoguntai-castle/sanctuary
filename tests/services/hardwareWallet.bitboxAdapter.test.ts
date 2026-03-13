/**
 * BitBox02 adapter coverage tests
 */

import * as bitcoin from 'bitcoinjs-lib';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';

const {
  mockGetDevicePath,
  mockGetKeypathFromString,
  mockIsErrorAbort,
  mockApiConnect,
  mockApiClose,
  mockFirmwareProduct,
  mockBtcXPub,
  mockDisplayAddressSimple,
  constants,
  MockBitBox02API,
  mockPsbtFromBase64,
  mockTransactionFromBuffer,
} = vi.hoisted(() => {
  const mockGetDevicePath = vi.fn();
  const mockGetKeypathFromString = vi.fn((path: string) =>
    path
      .replace(/^m\//, '')
      .split('/')
      .map((part: string) => parseInt(part.replace(/['h]$/, ''), 10) || 0)
  );
  const mockIsErrorAbort = vi.fn((_err?: unknown) => false);

  const mockApiConnect = vi.fn();
  const mockApiClose = vi.fn();
  const mockFirmwareProduct = vi.fn();
  const mockBtcXPub = vi.fn();
  const mockDisplayAddressSimple = vi.fn();
  const mockPsbtFromBase64 = vi.fn();
  const mockTransactionFromBuffer = vi.fn();

  const constants = {
    Product: {
      BitBox02Multi: 1,
      BitBox02BTCOnly: 2,
    },
    messages: {
      BTCScriptConfig_SimpleType: {
        P2WPKH: 10,
        P2WPKH_P2SH: 11,
        P2TR: 12,
      },
      BTCXPubType: {
        VPUB: 20,
        ZPUB: 21,
        UPUB: 22,
        YPUB: 23,
        TPUB: 24,
        XPUB: 25,
      },
      BTCCoin: {
        TBTC: 30,
        BTC: 31,
      },
      BTCOutputType: {
        P2WPKH: 40,
        P2WSH: 41,
        P2TR: 42,
        P2PKH: 43,
        P2SH: 44,
      },
    },
  };

  const MockBitBox02API = vi.fn(function MockBitBox02API(this: any) {
    this.connect = (...args: unknown[]) => mockApiConnect(...args);
    this.close = (...args: unknown[]) => mockApiClose(...args);
    this.firmware = () => ({
      Product: (...args: unknown[]) => mockFirmwareProduct(...args),
    });
    this.btcXPub = (...args: unknown[]) => mockBtcXPub(...args);
    this.btcDisplayAddressSimple = (...args: unknown[]) => mockDisplayAddressSimple(...args);
    this.btcSignSimple = vi.fn();
  });

  return {
    mockGetDevicePath,
    mockGetKeypathFromString,
    mockIsErrorAbort,
    mockApiConnect,
    mockApiClose,
    mockFirmwareProduct,
    mockBtcXPub,
    mockDisplayAddressSimple,
    constants,
    MockBitBox02API,
    mockPsbtFromBase64,
    mockTransactionFromBuffer,
  };
});

vi.mock('bitbox02-api', () => ({
  BitBox02API: MockBitBox02API,
  getDevicePath: mockGetDevicePath,
  getKeypathFromString: mockGetKeypathFromString,
  constants,
  HARDENED: 0x80000000,
  isErrorAbort: mockIsErrorAbort,
}));

vi.mock('bitcoinjs-lib', () => ({
  networks: {
    bitcoin: { pubKeyHash: 0, scriptHash: 5 },
    testnet: { pubKeyHash: 111, scriptHash: 196 },
  },
  address: {
    fromBech32: vi.fn(),
    fromBase58Check: vi.fn(),
  },
  Psbt: {
    fromBase64: (...args: unknown[]) => mockPsbtFromBase64(...args),
  },
  Transaction: {
    SIGHASH_ALL: 1,
    fromBuffer: (...args: unknown[]) => mockTransactionFromBuffer(...args),
  },
}));

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../shared/utils/bitcoin', () => ({
  normalizeDerivationPath: (path: string) => path,
}));

import { BitBoxAdapter } from '../../services/hardwareWallet/adapters/bitbox';

const originalWindow = globalThis.window;
const originalNavigator = globalThis.navigator;

function setWebHidEnv(options: { secure?: boolean; withHid?: boolean } = {}) {
  const { secure = true, withHid = true } = options;
  Object.defineProperty(globalThis, 'window', {
    value: {
      ...(originalWindow as object),
      isSecureContext: secure,
    },
    configurable: true,
  });

  const nav = withHid
    ? {
      hid: {
        getDevices: vi.fn(),
      },
    }
    : {};

  Object.defineProperty(globalThis, 'navigator', {
    value: nav,
    configurable: true,
  });
}

function setAuthorizedHidDevices(devices: unknown[]) {
  (globalThis.navigator as any).hid.getDevices.mockResolvedValue(devices);
}

function makeHidDevice(overrides: Record<string, unknown> = {}) {
  return {
    vendorId: 0x03eb,
    productId: 0x2403,
    opened: false,
    productName: 'BitBox02',
    ...overrides,
  };
}

describe('BitBoxAdapter', () => {
  beforeEach(() => {
    mockGetDevicePath.mockReset();
    mockGetKeypathFromString.mockReset();
    mockIsErrorAbort.mockReset();
    mockApiConnect.mockReset();
    mockApiClose.mockReset();
    mockFirmwareProduct.mockReset();
    mockBtcXPub.mockReset();
    mockDisplayAddressSimple.mockReset();
    mockPsbtFromBase64.mockReset();
    mockTransactionFromBuffer.mockReset();
    MockBitBox02API.mockClear();
    setWebHidEnv({ secure: true, withHid: true });
    setAuthorizedHidDevices([]);
    mockGetKeypathFromString.mockImplementation((path: string) =>
      path
        .replace(/^m\//, '')
        .split('/')
        .map((part: string) => parseInt(part.replace(/['h]$/, ''), 10) || 0)
    );
    mockGetDevicePath.mockResolvedValue('WEBHID');
    mockApiConnect.mockResolvedValue(undefined);
    mockApiClose.mockReturnValue(undefined);
    mockFirmwareProduct.mockReturnValue(constants.Product.BitBox02Multi);
    mockBtcXPub.mockResolvedValue('xpub-bitbox');
    mockDisplayAddressSimple.mockResolvedValue(undefined);
    mockIsErrorAbort.mockReturnValue(false);
    mockPsbtFromBase64.mockReturnValue({
      data: { globalMap: { unsignedTx: {} }, inputs: [], outputs: [] },
      txInputs: [],
      txOutputs: [],
      version: 2,
      locktime: 0,
      updateInput: vi.fn(),
      finalizeAllInputs: vi.fn(),
      toBase64: vi.fn(() => 'signed-psbt'),
    });
    mockTransactionFromBuffer.mockReturnValue({
      outs: [{ value: 1234 }],
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true });
    Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
  });

  it('checks WebHID support from browser capabilities and secure context', () => {
    const adapter = new BitBoxAdapter();
    expect(adapter.isSupported()).toBe(true);

    setWebHidEnv({ secure: false, withHid: true });
    expect(adapter.isSupported()).toBe(false);

    setWebHidEnv({ secure: true, withHid: false });
    expect(adapter.isSupported()).toBe(false);
  });

  it('returns empty authorized devices when unsupported', async () => {
    setWebHidEnv({ secure: false, withHid: true });
    const adapter = new BitBoxAdapter();
    await expect(adapter.getAuthorizedDevices()).resolves.toEqual([]);
  });

  it('filters and maps authorized BitBox02 HID devices', async () => {
    setAuthorizedHidDevices([
      makeHidDevice({ opened: true, productName: 'BitBox02 BTC' }),
      makeHidDevice({ vendorId: 0x9999, productId: 0x8888 }),
    ]);

    const adapter = new BitBoxAdapter();
    const devices = await adapter.getAuthorizedDevices();

    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      id: 'bitbox-1003-9219',
      name: 'BitBox02 BTC',
      connected: true,
      model: 'BitBox02',
    });
  });

  it('uses fallback name and connected=false mapping when HID fields are missing', async () => {
    setAuthorizedHidDevices([makeHidDevice({ productName: undefined, opened: undefined })]);

    const adapter = new BitBoxAdapter();
    const devices = await adapter.getAuthorizedDevices();

    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      name: 'BitBox02',
      connected: false,
    });
  });

  it('handles HID enumeration errors', async () => {
    (globalThis.navigator as any).hid.getDevices.mockRejectedValue(new Error('hid failed'));
    const adapter = new BitBoxAdapter();
    await expect(adapter.getAuthorizedDevices()).resolves.toEqual([]);
  });

  it('throws friendly errors for unsupported and common connect failures', async () => {
    setWebHidEnv({ secure: false, withHid: true });
    await expect(new BitBoxAdapter().connect()).rejects.toThrow('WebHID is not supported');

    setWebHidEnv({ secure: true, withHid: true });
    mockGetDevicePath.mockRejectedValueOnce(new Error('NotAllowed'));
    await expect(new BitBoxAdapter().connect()).rejects.toThrow('Access denied');

    mockGetDevicePath.mockRejectedValueOnce(new Error('Pairing rejected'));
    await expect(new BitBoxAdapter().connect()).rejects.toThrow('Pairing was rejected');

    mockGetDevicePath.mockRejectedValueOnce(new Error('Firmware upgrade required'));
    await expect(new BitBoxAdapter().connect()).rejects.toThrow('Firmware upgrade required');

    mockGetDevicePath.mockRejectedValueOnce(new Error('device busy'));
    await expect(new BitBoxAdapter().connect()).rejects.toThrow('BitBox02 is busy');

    mockGetDevicePath.mockRejectedValueOnce(new Error('strange connect error'));
    await expect(new BitBoxAdapter().connect()).rejects.toThrow('Failed to connect: strange connect error');

    mockGetDevicePath.mockRejectedValueOnce({ code: 'unknown' });
    await expect(new BitBoxAdapter().connect()).rejects.toThrow('Failed to connect: Unknown error');
  });

  it('connects successfully, sets device state, and handles close callback', async () => {
    let onCloseHandler!: () => void;

    mockApiConnect.mockImplementationOnce(async (pairing, userVerify, attestation, onClose, statusCb) => {
      pairing('1234-5678');
      await userVerify();
      attestation(false);
      statusCb('connected');
      onCloseHandler = onClose;
    });

    const adapter = new BitBoxAdapter();
    const device = await adapter.connect();

    expect(device.name).toBe('BitBox02 Multi');
    expect(device.connected).toBe(true);
    expect(adapter.isConnected()).toBe(true);
    expect(adapter.getDevice()?.id).toBe('bitbox-1003-9219');
    expect(MockBitBox02API).toHaveBeenCalledWith('WEBHID');

    onCloseHandler();
    expect(adapter.getDevice()?.connected).toBe(false);
  });

  it('supports bitcoin-only product and handles early close/attestation-success branches', async () => {
    mockFirmwareProduct.mockReturnValue(constants.Product.BitBox02BTCOnly);
    mockApiConnect.mockImplementationOnce(async (_pairing, _userVerify, attestation, onClose) => {
      attestation(true);
      onClose();
    });

    const adapter = new BitBoxAdapter();
    const device = await adapter.connect();

    expect(device.name).toBe('BitBox02 Bitcoin-only');
    expect(adapter.isConnected()).toBe(true);
  });

  it('covers pairing timeout branch when resolve was already cleared', async () => {
    vi.useFakeTimers();
    try {
      const adapter = new BitBoxAdapter();
      mockApiConnect.mockImplementationOnce(async (_pairing, userVerify) => {
        const verifyPromise = userVerify();
        const resolve = (adapter as any).pairingResolve as (() => void) | null;
        resolve?.();
        (adapter as any).pairingResolve = null;
        await verifyPromise;
      });

      const connectPromise = adapter.connect();
      await vi.runAllTimersAsync();
      await expect(connectPromise).resolves.toMatchObject({
        type: 'bitbox',
        connected: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes previous connection before reconnect and ignores close errors', async () => {
    const adapter = new BitBoxAdapter();
    const close = vi.fn(() => {
      throw new Error('close fail');
    });
    (adapter as any).connection = { api: { close } };

    await adapter.connect();
    expect(close).toHaveBeenCalled();
    expect(adapter.isConnected()).toBe(true);
  });

  it('disconnects and clears internal state even when close throws', async () => {
    const adapter = new BitBoxAdapter();
    (adapter as any).connection = {
      api: { close: () => { throw new Error('close failed'); } },
    };
    (adapter as any).connectedDevice = {
      id: 'bitbox-1',
      type: 'bitbox',
      name: 'BitBox',
      model: 'BitBox02',
      connected: true,
      fingerprint: undefined,
    };
    (adapter as any).pairingCode = '1234';
    (adapter as any).pairingResolve = vi.fn();

    await expect(adapter.disconnect()).resolves.toBeUndefined();
    expect(adapter.getDevice()).toBeNull();
    expect((adapter as any).pairingResolve).toBeNull();
  });

  it('disconnects cleanly when no connection exists', async () => {
    const adapter = new BitBoxAdapter();
    await expect(adapter.disconnect()).resolves.toBeUndefined();
    expect(adapter.getDevice()).toBeNull();
  });

  it('requires connected state for xpub/address/sign operations', async () => {
    const adapter = new BitBoxAdapter();
    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow('No device connected');
    await expect(adapter.verifyAddress("m/84'/0'/0'/0/0", 'bc1qxyz')).rejects.toThrow('No device connected');
    await expect(adapter.signPSBT({ psbt: 'abc', inputPaths: [] })).rejects.toThrow('No device connected');
  });

  it('returns xpub and maps abort errors for xpub/verify', async () => {
    const adapter = new BitBoxAdapter();
    (adapter as any).connection = {
      api: {
        btcXPub: (...args: unknown[]) => mockBtcXPub(...args),
        btcDisplayAddressSimple: (...args: unknown[]) => mockDisplayAddressSimple(...args),
      },
      devicePath: 'WEBHID',
      product: constants.Product.BitBox02Multi,
    };
    (adapter as any).connectedDevice = {
      id: 'bitbox-1',
      type: 'bitbox',
      name: 'BitBox',
      model: 'BitBox02',
      connected: true,
      fingerprint: undefined,
    };

    const result = await adapter.getXpub("m/84'/0'/0'");
    expect(result).toEqual({
      xpub: 'xpub-bitbox',
      fingerprint: '',
      path: "m/84'/0'/0'",
    });
    expect(mockBtcXPub).toHaveBeenCalledWith(31, expect.any(Array), 21, false);

    mockBtcXPub.mockResolvedValueOnce('upub-bitbox');
    await adapter.getXpub("m/49'/1'/0'");
    expect(mockBtcXPub).toHaveBeenLastCalledWith(30, expect.any(Array), 22, false);

    mockBtcXPub.mockResolvedValueOnce('xpub-taproot');
    await adapter.getXpub("m/86'/0'/0'");
    expect(mockBtcXPub).toHaveBeenLastCalledWith(31, expect.any(Array), 25, false);

    mockBtcXPub.mockResolvedValueOnce('tpub-default');
    await adapter.getXpub("m/44'/1'/0'");
    expect(mockBtcXPub).toHaveBeenLastCalledWith(30, expect.any(Array), 24, false);

    const abortErr = new Error('aborted');
    mockBtcXPub.mockRejectedValueOnce(abortErr);
    mockIsErrorAbort.mockImplementationOnce((err: unknown) => err === abortErr);
    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow('Request cancelled on device');

    mockBtcXPub.mockRejectedValueOnce(new Error('xpub failed'));
    mockIsErrorAbort.mockReturnValueOnce(false);
    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow('Failed to get xpub: xpub failed');

    mockBtcXPub.mockRejectedValueOnce('xpub failed');
    mockIsErrorAbort.mockReturnValueOnce(false);
    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow('Failed to get xpub: Unknown error');

    await expect(adapter.verifyAddress("m/49h/0h/0h/0/0", '3abc')).resolves.toBe(true);
    expect(mockDisplayAddressSimple).toHaveBeenLastCalledWith(31, expect.any(Array), 11, true);

    await expect(adapter.verifyAddress("m/86h/0h/0h/0/0", 'bc1pabc')).resolves.toBe(true);
    expect(mockDisplayAddressSimple).toHaveBeenLastCalledWith(31, expect.any(Array), 12, true);

    await expect(adapter.verifyAddress("m/44'/0'/0'/0/0", '1abc')).resolves.toBe(true);
    expect(mockDisplayAddressSimple).toHaveBeenLastCalledWith(31, expect.any(Array), 10, true);

    mockDisplayAddressSimple.mockRejectedValueOnce(abortErr);
    mockIsErrorAbort.mockImplementationOnce((err: unknown) => err === abortErr);
    await expect(adapter.verifyAddress("m/84'/0'/0'/0/0", 'bc1qxyz')).resolves.toBe(false);

    mockDisplayAddressSimple.mockRejectedValueOnce(new Error('unexpected'));
    mockIsErrorAbort.mockReturnValueOnce(false);
    await expect(adapter.verifyAddress("m/84'/0'/0'/0/0", 'bc1qxyz')).rejects.toThrow('Failed to verify address');

    mockDisplayAddressSimple.mockRejectedValueOnce('unexpected');
    mockIsErrorAbort.mockReturnValueOnce(false);
    await expect(adapter.verifyAddress("m/84'/0'/0'/0/0", 'bc1qxyz')).rejects.toThrow(
      'Failed to verify address: Unknown error'
    );
  });

  it('treats errors as non-abort when isErrorAbort itself throws', async () => {
    const adapter = new BitBoxAdapter();
    setAuthorizedHidDevices([makeHidDevice()]);
    mockApiConnect.mockResolvedValue(undefined);
    await adapter.connect();

    const deviceErr = new Error('device broke');
    mockBtcXPub.mockRejectedValueOnce(deviceErr);
    mockIsErrorAbort.mockImplementationOnce(() => {
      throw new Error('module load failed');
    });
    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow('Failed to get xpub: device broke');
  });

  it('maps signPSBT abort, busy, and generic failures', async () => {
    const adapter = new BitBoxAdapter();
    (adapter as any).connection = {
      api: { btcSignSimple: vi.fn() },
      devicePath: 'WEBHID',
      product: constants.Product.BitBox02Multi,
    };

    const abortErr = new Error('abort');
    mockPsbtFromBase64.mockImplementationOnce(() => {
      throw abortErr;
    });
    mockIsErrorAbort.mockImplementationOnce((err: unknown) => err === abortErr);
    await expect(adapter.signPSBT({ psbt: 'x', inputPaths: [] })).rejects.toThrow('Transaction rejected on device');

    mockPsbtFromBase64.mockImplementationOnce(() => {
      throw new Error('device busy');
    });
    mockIsErrorAbort.mockReturnValueOnce(false);
    await expect(adapter.signPSBT({ psbt: 'x', inputPaths: [] })).rejects.toThrow('BitBox02 is busy');

    mockPsbtFromBase64.mockImplementationOnce(() => {
      throw new Error('unexpected');
    });
    mockIsErrorAbort.mockReturnValueOnce(false);
    await expect(adapter.signPSBT({ psbt: 'x', inputPaths: [] })).rejects.toThrow('Failed to sign transaction: unexpected');

    mockPsbtFromBase64.mockImplementationOnce(() => {
      throw 'unexpected';
    });
    mockIsErrorAbort.mockReturnValueOnce(false);
    await expect(adapter.signPSBT({ psbt: '', inputPaths: [] })).rejects.toThrow(
      'Failed to sign transaction: Unknown error'
    );
  });

  it('signs and finalizes a PSBT with mocked BitBox responses', async () => {
    const adapter = new BitBoxAdapter();
    const mockBtcSignSimple = vi.fn().mockResolvedValue([new Uint8Array(64)]);
    (adapter as any).connection = {
      api: {
        btcSignSimple: (...args: unknown[]) => mockBtcSignSimple(...args),
      },
      devicePath: 'WEBHID',
      product: constants.Product.BitBox02Multi,
    };

    const mockPsbt = {
      data: {
        globalMap: { unsignedTx: {} },
        inputs: [{
          witnessUtxo: { value: 1000 },
          bip32Derivation: [{
            path: "m/84'/0'/0'/0/0",
            pubkey: Buffer.from(`02${'11'.repeat(32)}`, 'hex'),
            masterFingerprint: Buffer.from('aabbccdd', 'hex'),
          }],
          sighashType: 1,
        }],
        outputs: [{}],
      },
      txInputs: [{ hash: Buffer.alloc(32, 1), index: 0, sequence: 0xfffffffd }],
      txOutputs: [{ value: 900, address: 'bc1qexample' }],
      version: 2,
      locktime: 0,
      updateInput: vi.fn(),
      finalizeAllInputs: vi.fn(),
      toBase64: vi.fn(() => 'bitbox-signed-psbt'),
    };
    mockPsbtFromBase64.mockReturnValue(mockPsbt);

    const result = await adapter.signPSBT({
      psbt: 'base64-psbt',
      inputPaths: ["m/84'/0'/0'/0/0"],
      accountPath: "m/84'/0'/0'",
    });

    expect(mockBtcSignSimple).toHaveBeenCalledTimes(1);
    expect(mockPsbt.updateInput).toHaveBeenCalledTimes(1);
    expect(mockPsbt.finalizeAllInputs).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      psbt: 'bitbox-signed-psbt',
      signatures: 1,
    });
  });

  it('defaults sequence to 0xffffffff when txInput.sequence is undefined', async () => {
    const adapter = new BitBoxAdapter();
    const mockBtcSignSimple = vi.fn().mockResolvedValue([new Uint8Array(64)]);
    (adapter as any).connection = {
      api: { btcSignSimple: (...args: unknown[]) => mockBtcSignSimple(...args) },
      devicePath: 'WEBHID',
      product: constants.Product.BitBox02Multi,
    };

    mockPsbtFromBase64.mockReturnValue({
      data: {
        globalMap: { unsignedTx: {} },
        inputs: [{
          witnessUtxo: { value: 500 },
          bip32Derivation: [{
            path: "m/84'/0'/0'/0/0",
            pubkey: Buffer.from(`02${'aa'.repeat(32)}`, 'hex'),
          }],
          sighashType: 1,
        }],
        outputs: [{}],
      },
      txInputs: [{ hash: Buffer.alloc(32, 5), index: 0 }],
      txOutputs: [{ value: 400, address: 'bc1qfallback' }],
      version: 2,
      locktime: 0,
      updateInput: vi.fn(),
      finalizeAllInputs: vi.fn(),
      toBase64: vi.fn(() => 'signed-default-seq'),
    });

    await adapter.signPSBT({
      psbt: 'no-sequence-psbt',
      accountPath: "m/84'/0'/0'",
      inputPaths: ["m/84'/0'/0'/0/0"],
    });

    const [, , , inputs] = mockBtcSignSimple.mock.calls[0];
    expect(inputs[0].sequence).toBe(0xffffffff);
  });

  it('maps signPSBT scriptType overrides to simpleType constants', async () => {
    const adapter = new BitBoxAdapter();
    const mockBtcSignSimple = vi.fn().mockResolvedValue([]);
    (adapter as any).connection = {
      api: { btcSignSimple: (...args: unknown[]) => mockBtcSignSimple(...args) },
      devicePath: 'WEBHID',
      product: constants.Product.BitBox02Multi,
    };

    const makeEmptyPsbt = () => ({
      data: { globalMap: { unsignedTx: {} }, inputs: [], outputs: [] },
      txInputs: [],
      txOutputs: [],
      version: 2,
      locktime: 0,
      updateInput: vi.fn(),
      finalizeAllInputs: vi.fn(),
      toBase64: vi.fn(() => 'signed-empty'),
    });

    mockPsbtFromBase64.mockReturnValueOnce(makeEmptyPsbt());
    await adapter.signPSBT({ psbt: 'a', inputPaths: [], accountPath: "m/84'/0'/0'", scriptType: 'p2wpkh' });
    expect(mockBtcSignSimple).toHaveBeenLastCalledWith(
      expect.any(Number),
      10,
      expect.any(Array),
      expect.any(Array),
      expect.any(Array),
      2,
      0
    );

    mockPsbtFromBase64.mockReturnValueOnce(makeEmptyPsbt());
    await adapter.signPSBT({
      psbt: 'b',
      inputPaths: [],
      accountPath: "m/84'/0'/0'",
      scriptType: 'p2sh-p2wpkh',
    });
    expect(mockBtcSignSimple).toHaveBeenLastCalledWith(
      expect.any(Number),
      11,
      expect.any(Array),
      expect.any(Array),
      expect.any(Array),
      2,
      0
    );

    mockPsbtFromBase64.mockReturnValueOnce(makeEmptyPsbt());
    await adapter.signPSBT({ psbt: 'c', inputPaths: [], accountPath: "m/84'/0'/0'", scriptType: 'p2tr' });
    expect(mockBtcSignSimple).toHaveBeenLastCalledWith(
      expect.any(Number),
      12,
      expect.any(Array),
      expect.any(Array),
      expect.any(Array),
      2,
      0
    );

    mockPsbtFromBase64.mockReturnValueOnce(makeEmptyPsbt());
    await adapter.signPSBT({ psbt: 'd', inputPaths: [], accountPath: "m/84'/0'/0'", scriptType: 'unknown' as any });
    expect(mockBtcSignSimple).toHaveBeenLastCalledWith(
      expect.any(Number),
      10,
      expect.any(Array),
      expect.any(Array),
      expect.any(Array),
      2,
      0
    );
  });

  it('derives account path from request inputPaths, PSBT metadata, and default fallback', async () => {
    const adapter = new BitBoxAdapter();
    const mockBtcSignSimple = vi.fn().mockResolvedValue([]);
    (adapter as any).connection = {
      api: { btcSignSimple: (...args: unknown[]) => mockBtcSignSimple(...args) },
      devicePath: 'WEBHID',
      product: constants.Product.BitBox02Multi,
    };

    mockPsbtFromBase64.mockReturnValueOnce({
      data: { globalMap: { unsignedTx: {} }, inputs: [], outputs: [] },
      txInputs: [],
      txOutputs: [],
      version: 2,
      locktime: 0,
      updateInput: vi.fn(),
      finalizeAllInputs: vi.fn(),
      toBase64: vi.fn(() => 'signed-a'),
    });
    await adapter.signPSBT({ psbt: 'a', inputPaths: ["m/84'/0'/0'/0/9"] });
    expect(mockGetKeypathFromString).toHaveBeenCalledWith("m/84'/0'/0'");

    mockPsbtFromBase64.mockReturnValueOnce({
      data: {
        globalMap: { unsignedTx: {} },
        inputs: [{ bip32Derivation: [{ path: "m/49'/1'/0'/1/3", pubkey: Buffer.alloc(33, 2) }] }],
        outputs: [],
      },
      txInputs: [{ hash: Buffer.alloc(32, 1), index: 0, sequence: 0 }],
      txOutputs: [],
      version: 2,
      locktime: 0,
      updateInput: vi.fn(),
      finalizeAllInputs: vi.fn(),
      toBase64: vi.fn(() => 'signed-b'),
    });
    await adapter.signPSBT({ psbt: 'b', inputPaths: [] });
    expect(mockGetKeypathFromString).toHaveBeenCalledWith("m/49'/1'/0'");
    expect(mockBtcSignSimple).toHaveBeenLastCalledWith(
      30,
      expect.any(Number),
      expect.any(Array),
      expect.any(Array),
      expect.any(Array),
      2,
      0
    );

    mockPsbtFromBase64.mockReturnValueOnce({
      data: { globalMap: { unsignedTx: {} }, inputs: [{}], outputs: [] },
      txInputs: [{ hash: Buffer.alloc(32, 2), index: 0, sequence: 0 }],
      txOutputs: [],
      version: 2,
      locktime: 0,
      updateInput: vi.fn(),
      finalizeAllInputs: vi.fn(),
      toBase64: vi.fn(() => 'signed-c'),
    });
    await adapter.signPSBT({ psbt: 'c', inputPaths: [] });
    expect(mockGetKeypathFromString).toHaveBeenCalledWith("m/84'/0'/0'");
  });

  it('handles non-witness inputs, keypath fallbacks, change outputs, and output type decoding', async () => {
    const adapter = new BitBoxAdapter();
    const mockBtcSignSimple = vi.fn().mockResolvedValue([new Uint8Array(64), new Uint8Array(64), new Uint8Array(64)]);
    (adapter as any).connection = {
      api: { btcSignSimple: (...args: unknown[]) => mockBtcSignSimple(...args) },
      devicePath: 'WEBHID',
      product: constants.Product.BitBox02Multi,
    };

    const fromBech32 = bitcoin.address.fromBech32 as unknown as ReturnType<typeof vi.fn>;
    const fromBase58Check = bitcoin.address.fromBase58Check as unknown as ReturnType<typeof vi.fn>;
    fromBech32.mockImplementation((address: string) => {
      if (address === 'bc1wsh') return { version: 0, data: new Uint8Array(32) };
      if (address === 'bc1tr') return { version: 1, data: new Uint8Array(32) };
      throw new Error('not bech32');
    });
    fromBase58Check.mockImplementation((address: string) => {
      if (address === '1pkh') return { version: 0, hash: Buffer.alloc(20, 1) };
      if (address === '3sh') return { version: 5, hash: Buffer.alloc(20, 2) };
      throw new Error('not base58');
    });

    mockPsbtFromBase64.mockReturnValue({
      data: {
        globalMap: { unsignedTx: {} },
        inputs: [
          {
            nonWitnessUtxo: Buffer.from([1, 2, 3]),
            bip32Derivation: [{ path: "m/84'/0'/0'/0/0", pubkey: Buffer.from(`02${'11'.repeat(32)}`, 'hex') }],
            sighashType: 1,
          },
          {
            witnessUtxo: { value: 2000 },
            bip32Derivation: [],
            sighashType: 1,
          },
          {
            witnessUtxo: { value: 3000 },
            sighashType: 1,
          },
        ],
        outputs: [
          { bip32Derivation: [{ path: "84'/0'/0'/1/0" }] },
          {},
          {},
          {},
          {},
        ],
      },
      txInputs: [
        { hash: Buffer.alloc(32, 1), index: 0, sequence: 1 },
        { hash: Buffer.alloc(32, 2), index: 1, sequence: 2 },
        { hash: Buffer.alloc(32, 3), index: 0, sequence: 3 },
      ],
      txOutputs: [
        { value: 1000, address: 'bc1change' },
        { value: 2000, address: 'bc1wsh' },
        { value: 3000, address: 'bc1tr' },
        { value: 4000, address: '1pkh' },
        { value: 5000, address: '3sh' },
      ],
      version: 2,
      locktime: 0,
      updateInput: vi.fn(),
      finalizeAllInputs: vi.fn(),
      toBase64: vi.fn(() => 'signed-complex'),
    });

    const result = await adapter.signPSBT({
      psbt: 'complex-psbt',
      accountPath: "m/84'/0'/0'",
      inputPaths: ["m/84'/0'/0'/0/0", "m/84'/0'/0'/0/1"],
      scriptType: 'p2sh-p2wpkh',
    });

    expect(result).toEqual({ psbt: 'signed-complex', signatures: 3 });

    const [coin, simpleType, keypathAccount, inputs, outputs] = mockBtcSignSimple.mock.calls[0];
    expect(coin).toBe(31);
    expect(simpleType).toBe(11);
    expect(keypathAccount).toEqual([84, 0, 0]);

    expect(inputs[0].prevOutValue).toBe('1234');
    expect(inputs[1].keypath).toEqual([84, 0, 0, 0, 1]);
    expect(inputs[2].keypath).toEqual([84, 0, 0, 0, 0]);

    expect(outputs[0]).toMatchObject({ ours: true, keypath: [84, 0, 0, 1, 0], value: '1000' });
    expect(outputs[1]).toMatchObject({ ours: false, type: 41, value: '2000' });
    expect(outputs[2]).toMatchObject({ ours: false, type: 42, value: '3000' });
    expect(outputs[3]).toMatchObject({ ours: false, type: 43, value: '4000' });
    expect(outputs[4]).toMatchObject({ ours: false, type: 44, value: '5000' });
  });

  it('uses default address and sighash branches when output address and input sighash are missing', async () => {
    const adapter = new BitBoxAdapter();
    const mockBtcSignSimple = vi.fn().mockResolvedValue([new Uint8Array(64).fill(7)]);
    (adapter as any).connection = {
      api: { btcSignSimple: (...args: unknown[]) => mockBtcSignSimple(...args) },
      devicePath: 'WEBHID',
      product: constants.Product.BitBox02Multi,
    };

    const mockPsbt = {
      data: {
        globalMap: { unsignedTx: {} },
        inputs: [{
          witnessUtxo: { value: 1500 },
          bip32Derivation: [{
            path: "m/84'/0'/0'/0/0",
            pubkey: Buffer.from(`02${'22'.repeat(32)}`, 'hex'),
          }],
        }],
        outputs: [{}],
      },
      txInputs: [{ hash: Buffer.alloc(32, 9), index: 1, sequence: 0xfffffffd }],
      txOutputs: [{ value: 1200 }],
      version: 2,
      locktime: 0,
      updateInput: vi.fn(),
      finalizeAllInputs: vi.fn(),
      toBase64: vi.fn(() => 'signed-default-branches'),
    };
    mockPsbtFromBase64.mockReturnValue(mockPsbt);

    const result = await adapter.signPSBT({
      psbt: 'default-branch-psbt',
      accountPath: "m/84'/0'/0'",
      inputPaths: ["m/84'/0'/0'/0/0"],
    });

    expect(result).toEqual({ psbt: 'signed-default-branches', signatures: 1 });

    const [, , , , outputs] = mockBtcSignSimple.mock.calls[0];
    expect(outputs[0]).toMatchObject({
      ours: false,
      type: 40,
      value: '1200',
      payload: new Uint8Array(0),
    });

    const [, update] = mockPsbt.updateInput.mock.calls[0];
    const signature: Buffer = update.partialSig[0].signature;
    expect(signature[signature.length - 1]).toBe(1);
  });
});
