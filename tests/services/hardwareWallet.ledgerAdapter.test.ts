/**
 * Ledger adapter coverage tests
 */

import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';

const {
  mockTransportCreate,
  mockTransportClose,
  mockUsbGetDevices,
  mockGetWalletXpub,
  mockGetWalletPublicKey,
  mockGetMasterFingerprint,
  mockGetExtendedPubkey,
  MockAppBtc,
  MockAppClient,
  MockDefaultWalletPolicy,
  mockPsbtFromBase64,
} = vi.hoisted(() => {
  const mockTransportCreate = vi.fn();
  const mockTransportClose = vi.fn();
  const mockUsbGetDevices = vi.fn();
  const mockGetWalletXpub = vi.fn();
  const mockGetWalletPublicKey = vi.fn();
  const mockGetMasterFingerprint = vi.fn();
  const mockGetExtendedPubkey = vi.fn();
  const mockPsbtFromBase64 = vi.fn();

  const MockAppBtc = vi.fn(function MockAppBtc(this: any) {
    this.getWalletXpub = (...args: unknown[]) => mockGetWalletXpub(...args);
    this.getWalletPublicKey = (...args: unknown[]) => mockGetWalletPublicKey(...args);
  });

  const MockAppClient = vi.fn(function MockAppClient(this: any) {
    this.getMasterFingerprint = (...args: unknown[]) => mockGetMasterFingerprint(...args);
    this.getExtendedPubkey = (...args: unknown[]) => mockGetExtendedPubkey(...args);
    this.signPsbt = vi.fn();
  });

  const MockDefaultWalletPolicy = vi.fn(function MockDefaultWalletPolicy(this: any, template: string, keyInfo: string) {
    this.template = template;
    this.keyInfo = keyInfo;
  });

  return {
    mockTransportCreate,
    mockTransportClose,
    mockUsbGetDevices,
    mockGetWalletXpub,
    mockGetWalletPublicKey,
    mockGetMasterFingerprint,
    mockGetExtendedPubkey,
    MockAppBtc,
    MockAppClient,
    MockDefaultWalletPolicy,
    mockPsbtFromBase64,
  };
});

vi.mock('@ledgerhq/hw-transport-webusb', () => ({
  default: {
    create: (...args: unknown[]) => mockTransportCreate(...args),
  },
}));

vi.mock('@ledgerhq/hw-app-btc', () => ({
  default: MockAppBtc,
}));

vi.mock('@ledgerhq/ledger-bitcoin', () => ({
  AppClient: MockAppClient,
  DefaultWalletPolicy: MockDefaultWalletPolicy,
}));

vi.mock('bitcoinjs-lib', () => ({
  Psbt: {
    fromBase64: (...args: unknown[]) => mockPsbtFromBase64(...args),
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

import { LedgerAdapter } from '../../services/hardwareWallet/adapters/ledger';

const originalWindow = globalThis.window;
const originalNavigator = globalThis.navigator;

function setWebUsbEnv(options: { secure?: boolean; withUsb?: boolean } = {}) {
  const { secure = true, withUsb = true } = options;
  Object.defineProperty(globalThis, 'window', {
    value: {
      ...(originalWindow as object),
      isSecureContext: secure,
    },
    configurable: true,
  });

  const nav = withUsb
    ? { usb: { getDevices: (...args: unknown[]) => mockUsbGetDevices(...args) } }
    : {};

  Object.defineProperty(globalThis, 'navigator', {
    value: nav,
    configurable: true,
  });
}

function makeUsbDevice(overrides: Record<string, unknown> = {}) {
  return {
    vendorId: 0x2c97,
    productId: 0x0004,
    serialNumber: 'abc123',
    opened: false,
    ...overrides,
  };
}

function makeLedgerPsbt(path = "m/84'/0'/0'/0/0") {
  return {
    data: {
      inputs: [
        {
          bip32Derivation: [
            {
              path,
              masterFingerprint: Buffer.from('01020304', 'hex'),
              pubkey: Buffer.from(`02${'11'.repeat(32)}`, 'hex'),
            },
          ],
        },
      ],
    },
    toBase64: vi.fn(() => 'updated-psbt'),
    updateInput: vi.fn(),
    finalizeAllInputs: vi.fn(),
  };
}

describe('LedgerAdapter', () => {
  beforeEach(() => {
    mockTransportCreate.mockReset();
    mockTransportClose.mockReset();
    mockUsbGetDevices.mockReset();
    mockGetWalletXpub.mockReset();
    mockGetWalletPublicKey.mockReset();
    mockGetMasterFingerprint.mockReset();
    mockGetExtendedPubkey.mockReset();
    mockPsbtFromBase64.mockReset();
    MockAppBtc.mockClear();
    MockAppClient.mockClear();
    MockDefaultWalletPolicy.mockClear();
    setWebUsbEnv({ secure: true, withUsb: true });
    mockUsbGetDevices.mockResolvedValue([]);
    mockTransportClose.mockResolvedValue(undefined);
    mockGetMasterFingerprint.mockResolvedValue('f00dbabe');
    mockGetExtendedPubkey.mockResolvedValue('xpub-mock');
    mockGetWalletXpub.mockResolvedValue('xpub-mock');
    mockGetWalletPublicKey.mockResolvedValue({});
    mockPsbtFromBase64.mockReturnValue({
      data: { inputs: [] },
      toBase64: () => 'psbt',
      updateInput: vi.fn(),
      finalizeAllInputs: vi.fn(),
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true });
    Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
  });

  it('checks WebUSB support based on browser environment', () => {
    const adapter = new LedgerAdapter();
    expect(adapter.isSupported()).toBe(true);

    setWebUsbEnv({ secure: false, withUsb: true });
    expect(adapter.isSupported()).toBe(false);

    setWebUsbEnv({ secure: true, withUsb: false });
    expect(adapter.isSupported()).toBe(false);
  });

  it('returns empty authorized devices when unsupported', async () => {
    setWebUsbEnv({ secure: false, withUsb: true });
    const adapter = new LedgerAdapter();
    await expect(adapter.getAuthorizedDevices()).resolves.toEqual([]);
  });

  it('filters and maps authorized Ledger devices', async () => {
    const ledger = makeUsbDevice({ productId: 0x0004, opened: true });
    const nonLedger = makeUsbDevice({ vendorId: 0x1234, productId: 0x9999, serialNumber: 'zzz' });
    mockUsbGetDevices.mockResolvedValue([ledger, nonLedger]);

    const adapter = new LedgerAdapter();
    const devices = await adapter.getAuthorizedDevices();

    expect(devices).toHaveLength(1);
    expect(devices[0].id).toBe('ledger-11415-4-abc123');
    expect(devices[0].name).toBe('Ledger Nano X');
    expect(devices[0].connected).toBe(true);
  });

  it('maps unknown models, missing serials, and active in-memory connection state', async () => {
    const unknown = makeUsbDevice({ productId: 0x9999, serialNumber: undefined, opened: false });
    mockUsbGetDevices.mockResolvedValue([unknown]);

    const adapter = new LedgerAdapter();
    (adapter as any).connection = { device: unknown };
    const devices = await adapter.getAuthorizedDevices();

    expect(devices).toHaveLength(1);
    expect(devices[0].name).toBe('Ledger Device');
    expect(devices[0].id).toBe('ledger-11415-39321-unknown');
    expect(devices[0].connected).toBe(true);
  });

  it('gracefully handles getAuthorizedDevices errors', async () => {
    mockUsbGetDevices.mockRejectedValue(new Error('usb enumeration failed'));
    const adapter = new LedgerAdapter();
    await expect(adapter.getAuthorizedDevices()).resolves.toEqual([]);
  });

  it('throws friendly errors for unsupported and denied connection', async () => {
    const unsupported = new LedgerAdapter();
    setWebUsbEnv({ secure: false, withUsb: true });
    await expect(unsupported.connect()).rejects.toThrow('WebUSB is not supported');

    setWebUsbEnv({ secure: true, withUsb: true });
    mockTransportCreate.mockRejectedValueOnce(new Error('NotAllowedError'));
    const denied = new LedgerAdapter();
    await expect(denied.connect()).rejects.toThrow('Access denied');
  });

  it('maps common Ledger connect failure reasons', async () => {
    setWebUsbEnv({ secure: true, withUsb: true });

    mockTransportCreate.mockRejectedValueOnce(new Error('0x6d00'));
    await expect(new LedgerAdapter().connect()).rejects.toThrow('open the Bitcoin app');

    mockTransportCreate.mockRejectedValueOnce(new Error('device locked (0x6982)'));
    await expect(new LedgerAdapter().connect()).rejects.toThrow('Please unlock');
  });

  it('closes previous transport before reconnect and maps generic connect errors', async () => {
    const adapter = new LedgerAdapter();
    const oldClose = vi.fn(async () => undefined);
    (adapter as any).connection = { transport: { close: oldClose } };

    const transport = {
      close: (...args: unknown[]) => mockTransportClose(...args),
      device: makeUsbDevice({ productId: 0x0001 }),
    };
    mockTransportCreate.mockResolvedValueOnce(transport);
    await adapter.connect();
    expect(oldClose).toHaveBeenCalled();

    mockTransportCreate.mockRejectedValueOnce(new Error('unexpected connect fail'));
    await expect(new LedgerAdapter().connect()).rejects.toThrow('Failed to connect: unexpected connect fail');
  });

  it('connects successfully and exposes connected device state', async () => {
    const transport = {
      close: (...args: unknown[]) => mockTransportClose(...args),
      device: makeUsbDevice({ productId: 0x0005, serialNumber: 'xyz' }),
    };
    mockTransportCreate.mockResolvedValue(transport);

    const adapter = new LedgerAdapter();
    const device = await adapter.connect();

    expect(device.name).toBe('Ledger Nano S Plus');
    expect(device.id).toBe('ledger-11415-5-xyz');
    expect(device.connected).toBe(true);
    expect(device.fingerprint).toBe('f00dbabe');
    expect(adapter.isConnected()).toBe(true);
    expect(adapter.getDevice()?.id).toBe(device.id);
    expect(MockAppBtc).toHaveBeenCalledTimes(1);
    expect(MockAppClient).toHaveBeenCalledTimes(1);
  });

  it('continues connect when an unknown fingerprint fetch error occurs', async () => {
    const transport = {
      close: (...args: unknown[]) => mockTransportClose(...args),
      device: makeUsbDevice({ productId: 0x0007 }),
    };
    mockTransportCreate.mockResolvedValue(transport);
    mockGetMasterFingerprint.mockRejectedValueOnce(new Error('fingerprint read failed'));

    const adapter = new LedgerAdapter();
    const device = await adapter.connect();

    expect(device.name).toBe('Ledger Flex');
    expect(device.fingerprint).toBeUndefined();
  });

  it('fails connect with an actionable message when the Bitcoin app is not ready', async () => {
    const transport = {
      close: (...args: unknown[]) => mockTransportClose(...args),
      device: makeUsbDevice({ productId: 0x0005 }),
    };
    mockTransportCreate.mockResolvedValue(transport);
    mockGetMasterFingerprint.mockRejectedValueOnce(new Error('CLA_NOT_SUPPORTED 0x6e00'));

    const adapter = new LedgerAdapter();

    await expect(adapter.connect()).rejects.toThrow('open the Bitcoin app');
    expect(mockTransportClose).toHaveBeenCalled();
  });

  it('keeps the Ledger readiness error if transport close also fails', async () => {
    const transport = {
      close: (...args: unknown[]) => mockTransportClose(...args),
      device: makeUsbDevice({ productId: 0x0005 }),
    };
    mockTransportCreate.mockResolvedValue(transport);
    mockGetMasterFingerprint.mockRejectedValueOnce(new Error('CLA_NOT_SUPPORTED 0x6e00'));
    mockTransportClose.mockRejectedValueOnce(new Error('close failed'));

    await expect(new LedgerAdapter().connect()).rejects.toThrow('open the Bitcoin app');
    expect(mockTransportClose).toHaveBeenCalled();
  });

  it('disconnects and clears internal device state', async () => {
    const adapter = new LedgerAdapter();
    (adapter as any).connection = {
      transport: { close: (...args: unknown[]) => mockTransportClose(...args) },
    };
    (adapter as any).connectedDevice = {
      id: 'ledger-1',
      type: 'ledger',
      name: 'Ledger',
      model: 'Ledger',
      connected: true,
      fingerprint: 'abcd',
    };

    await adapter.disconnect();

    expect(mockTransportClose).toHaveBeenCalled();
    expect(adapter.getDevice()).toBeNull();
    expect(adapter.isConnected()).toBe(false);
  });

  it('handles close errors during disconnect', async () => {
    const adapter = new LedgerAdapter();
    mockTransportClose.mockRejectedValueOnce(new Error('close failed'));
    (adapter as any).connection = {
      transport: { close: (...args: unknown[]) => mockTransportClose(...args) },
    };

    await expect(adapter.disconnect()).resolves.toBeUndefined();
    expect(adapter.getDevice()).toBeNull();
  });

  it('requires connection for xpub/address/sign operations', async () => {
    const adapter = new LedgerAdapter();
    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow('No device connected');
    await expect((adapter as any).getLedgerXpub("m/84'/0'/0'", 0x0488b21e)).rejects.toThrow('No device connected');
    await expect((adapter as any).getMasterFingerprint()).resolves.toBe('');
    await expect(adapter.verifyAddress("m/84'/0'/0'/0/0", 'bc1qxyz')).rejects.toThrow('No device connected');
    await expect(adapter.signPSBT({ psbt: 'not-a-psbt', inputPaths: [] })).rejects.toThrow('No device connected');
  });

  it('uses a cached fingerprint when returning an xpub', async () => {
    const adapter = new LedgerAdapter();
    (adapter as any).connection = {
      app: {
        getWalletXpub: (...args: unknown[]) => mockGetWalletXpub(...args),
      },
      appClient: {
        getMasterFingerprint: (...args: unknown[]) => mockGetMasterFingerprint(...args),
        getExtendedPubkey: (...args: unknown[]) => mockGetExtendedPubkey(...args),
      },
      transport: { close: vi.fn() },
      device: makeUsbDevice(),
    };
    (adapter as any).connectedDevice = {
      id: 'ledger-1',
      type: 'ledger',
      name: 'Ledger',
      model: 'Ledger',
      connected: true,
      fingerprint: 'cafebabe',
    };

    mockGetExtendedPubkey.mockResolvedValueOnce('xpub-cached-fingerprint');

    const result = await adapter.getXpub("m/84'/0'/0'");

    expect(result.fingerprint).toBe('cafebabe');
    expect(mockGetMasterFingerprint).not.toHaveBeenCalled();
  });

  it('returns xpub and maps getXpub/verify error branches', async () => {
    const adapter = new LedgerAdapter();
    (adapter as any).connection = {
      app: {
        getWalletXpub: (...args: unknown[]) => mockGetWalletXpub(...args),
        getWalletPublicKey: (...args: unknown[]) => mockGetWalletPublicKey(...args),
      },
      appClient: {
        getMasterFingerprint: (...args: unknown[]) => mockGetMasterFingerprint(...args),
        getExtendedPubkey: (...args: unknown[]) => mockGetExtendedPubkey(...args),
      },
      transport: { close: vi.fn() },
      device: makeUsbDevice(),
    };
    (adapter as any).connectedDevice = {
      id: 'ledger-1',
      type: 'ledger',
      name: 'Ledger',
      model: 'Ledger',
      connected: true,
      fingerprint: '',
    };

    mockGetExtendedPubkey.mockResolvedValueOnce('tpub-testnet');
    const result = await adapter.getXpub("m/84'/1'/0'");
    expect(result).toEqual({
      xpub: 'tpub-testnet',
      fingerprint: 'f00dbabe',
      path: "m/84'/1'/0'",
    });
    expect(mockGetExtendedPubkey).toHaveBeenCalledWith("m/84'/1'/0'");
    expect(mockGetWalletXpub).not.toHaveBeenCalled();

    mockGetExtendedPubkey.mockRejectedValueOnce(new Error('new API unavailable'));
    mockGetWalletXpub.mockResolvedValueOnce('xpub-fallback');
    const fallbackResult = await adapter.getXpub("m/84'/0'/0'");
    expect(fallbackResult.xpub).toBe('xpub-fallback');
    expect(mockGetWalletXpub).toHaveBeenCalledWith({
      path: "m/84'/0'/0'",
      xpubVersion: 0x0488b21e,
    });

    mockGetMasterFingerprint.mockRejectedValueOnce(new Error('fp read fail'));
    mockGetExtendedPubkey.mockResolvedValueOnce('xpub-mainnet');
    const noFpResult = await adapter.getXpub("m/84'/0'/0'");
    expect(noFpResult.fingerprint).toBe('');

    mockGetExtendedPubkey.mockRejectedValueOnce(new Error('0x6985 denied'));
    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow('Request rejected on Ledger');

    mockGetExtendedPubkey.mockRejectedValueOnce(new Error('0x6d00'));
    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow('Bitcoin app not open on Ledger');

    mockGetExtendedPubkey.mockRejectedValueOnce(new Error('new API unavailable'));
    mockGetWalletXpub.mockRejectedValueOnce(new Error('xpub failed'));
    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow('Failed to get xpub: xpub failed');

    mockGetExtendedPubkey.mockResolvedValueOnce('');
    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow('Ledger returned an empty xpub');

    await expect(adapter.verifyAddress("m/84'/0'/0'/0/0", 'bc1qabc')).resolves.toBe(true);

    mockGetWalletPublicKey.mockRejectedValueOnce(new Error('denied by user'));
    await expect(adapter.verifyAddress("m/84'/0'/0'/0/0", 'bc1qabc')).resolves.toBe(false);

    mockGetWalletPublicKey.mockRejectedValueOnce(new Error('unexpected'));
    await expect(adapter.verifyAddress("m/84'/0'/0'/0/0", 'bc1qabc')).rejects.toThrow('Failed to verify address');
  });

  it('maps signPSBT error categories to user-friendly messages', async () => {
    const adapter = new LedgerAdapter();
    (adapter as any).connection = {
      app: {},
      appClient: {
        getMasterFingerprint: (...args: unknown[]) => mockGetMasterFingerprint(...args),
        getExtendedPubkey: (...args: unknown[]) => mockGetExtendedPubkey(...args),
        signPsbt: vi.fn(),
      },
      transport: { close: vi.fn() },
      device: makeUsbDevice(),
    };
    (adapter as any).connectedDevice = {
      id: 'ledger-1',
      type: 'ledger',
      name: 'Ledger',
      model: 'Ledger',
      connected: true,
      fingerprint: '',
    };

    mockPsbtFromBase64.mockImplementationOnce(() => {
      throw new Error('0x6985 denied');
    });
    await expect(adapter.signPSBT({ psbt: 'x', inputPaths: [] })).rejects.toThrow('Transaction rejected on device');

    mockPsbtFromBase64.mockImplementationOnce(() => {
      throw new Error('0x6d00');
    });
    await expect(adapter.signPSBT({ psbt: 'x', inputPaths: [] })).rejects.toThrow('Bitcoin app not open on device');

    mockPsbtFromBase64.mockImplementationOnce(() => {
      throw new Error('device locked');
    });
    await expect(adapter.signPSBT({ psbt: 'x', inputPaths: [] })).rejects.toThrow('Device is locked');

    mockPsbtFromBase64.mockImplementationOnce(() => {
      throw new Error('No device present');
    });
    await expect(adapter.signPSBT({ psbt: 'x', inputPaths: [] })).rejects.toThrow('Device disconnected');

    mockPsbtFromBase64.mockImplementationOnce(() => {
      throw new Error('unexpected');
    });
    await expect(adapter.signPSBT({ psbt: 'x', inputPaths: [] })).rejects.toThrow('Failed to sign transaction: unexpected');
  });

  it('handles non-Error failures and no-op disconnect fallback paths', async () => {
    const connectNonError = new LedgerAdapter();
    mockTransportCreate.mockRejectedValueOnce({ reason: 'plain-object' } as any);
    await expect(connectNonError.connect()).rejects.toThrow('Failed to connect: Unknown error');

    const adapter = new LedgerAdapter();
    await expect(adapter.disconnect()).resolves.toBeUndefined();

    (adapter as any).connection = {
      app: {
        getWalletXpub: (...args: unknown[]) => mockGetWalletXpub(...args),
        getWalletPublicKey: (...args: unknown[]) => mockGetWalletPublicKey(...args),
      },
      appClient: {
        getMasterFingerprint: (...args: unknown[]) => mockGetMasterFingerprint(...args),
        getExtendedPubkey: (...args: unknown[]) => mockGetExtendedPubkey(...args),
        signPsbt: vi.fn(),
      },
      transport: { close: vi.fn() },
      device: makeUsbDevice(),
    };
    (adapter as any).connectedDevice = {
      id: 'ledger-1',
      type: 'ledger',
      name: 'Ledger',
      model: 'Ledger',
      connected: true,
      fingerprint: '',
    };

    mockGetExtendedPubkey.mockRejectedValueOnce('xpub-non-error' as any);
    mockGetWalletXpub.mockRejectedValueOnce('fallback-non-error' as any);
    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow('Failed to get xpub: Unknown error');

    mockGetWalletPublicKey.mockRejectedValueOnce(42 as any);
    await expect(adapter.verifyAddress("m/84'/0'/0'/0/0", 'bc1qabc')).rejects.toThrow(
      'Failed to verify address: Unknown error'
    );

    mockPsbtFromBase64.mockImplementationOnce(() => {
      throw 'sign-non-error';
    });
    await expect(adapter.signPSBT({ psbt: 'x', inputPaths: [] })).rejects.toThrow(
      'Failed to sign transaction: Unknown error'
    );
  });

  it('signs and finalizes a PSBT using mocked Ledger responses', async () => {
    const adapter = new LedgerAdapter();
    const mockGetExtendedPubkey = vi.fn().mockResolvedValue('xpub-abc');
    const mockSignPsbt = vi.fn().mockResolvedValue([
      [0, { pubkey: Buffer.from(`02${'11'.repeat(32)}`, 'hex'), signature: Buffer.from('3044', 'hex') }],
    ]);
    (adapter as any).connection = {
      app: {},
      appClient: {
        getMasterFingerprint: (...args: unknown[]) => mockGetMasterFingerprint(...args),
        getExtendedPubkey: (...args: unknown[]) => mockGetExtendedPubkey(...args),
        signPsbt: (...args: unknown[]) => mockSignPsbt(...args),
      },
      transport: { close: vi.fn() },
      device: makeUsbDevice(),
    };

    const mockPsbt = {
      data: {
        inputs: [{
          bip32Derivation: [{
            path: "m/84'/0'/0'/0/0",
            masterFingerprint: Buffer.from('01020304', 'hex'),
            pubkey: Buffer.from(`02${'11'.repeat(32)}`, 'hex'),
          }],
        }],
      },
      toBase64: vi.fn(() => 'updated-psbt'),
      updateInput: vi.fn(),
      finalizeAllInputs: vi.fn(),
    };
    mockPsbtFromBase64.mockReturnValue(mockPsbt);
    mockGetMasterFingerprint.mockResolvedValue('aabbccdd');

    const result = await adapter.signPSBT({
      psbt: 'base64-psbt',
      inputPaths: ["m/84'/0'/0'/0/0"],
    });

    expect(MockDefaultWalletPolicy).toHaveBeenCalledTimes(1);
    expect(mockSignPsbt).toHaveBeenCalledWith('updated-psbt', expect.any(Object), null);
    expect(mockPsbt.updateInput).toHaveBeenCalledTimes(1);
    expect(mockPsbt.finalizeAllInputs).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      psbt: 'updated-psbt',
      signatures: 1,
    });
  });

  it('maps descriptor templates for explicit and inferred script types', async () => {
    const adapter = new LedgerAdapter();
    const mockGetExtendedPubkey = vi.fn().mockResolvedValue('xpub-template');
    const mockSignPsbt = vi.fn().mockResolvedValue([]);
    (adapter as any).connection = {
      app: {},
      appClient: {
        getMasterFingerprint: (...args: unknown[]) => mockGetMasterFingerprint(...args),
        getExtendedPubkey: (...args: unknown[]) => mockGetExtendedPubkey(...args),
        signPsbt: (...args: unknown[]) => mockSignPsbt(...args),
      },
      transport: { close: vi.fn() },
      device: makeUsbDevice(),
    };
    mockGetMasterFingerprint.mockResolvedValue('aabbccdd');

    const cases: Array<{ accountPath: string; scriptType?: string; expected: string }> = [
      { accountPath: "m/49'/0'/0'", scriptType: 'p2sh-p2wpkh', expected: 'sh(wpkh(@0/**))' },
      { accountPath: "m/44'/0'/0'", scriptType: 'p2pkh', expected: 'pkh(@0/**)' },
      { accountPath: "m/86'/0'/0'", scriptType: 'p2tr', expected: 'tr(@0/**)' },
      { accountPath: "m/84'/0'/0'", scriptType: 'unknown', expected: 'wpkh(@0/**)' },
      { accountPath: "m/49'/0'/0'", expected: 'sh(wpkh(@0/**))' },
      { accountPath: "m/44'/0'/0'", expected: 'pkh(@0/**)' },
      { accountPath: "m/86'/0'/0'", expected: 'tr(@0/**)' },
      { accountPath: 'm/0/0/0', expected: 'wpkh(@0/**)' },
    ];

    for (const [idx, item] of cases.entries()) {
      const psbt = makeLedgerPsbt(`${item.accountPath}/0/0`);
      mockPsbtFromBase64.mockReturnValueOnce(psbt).mockReturnValueOnce(psbt);
      await adapter.signPSBT({
        psbt: `psbt-${idx}`,
        accountPath: item.accountPath,
        scriptType: item.scriptType as any,
        inputPaths: [],
      });
      expect(MockDefaultWalletPolicy).toHaveBeenLastCalledWith(item.expected, expect.any(String));
    }
  });

  it('uses inputPaths/default account fallbacks and reports missing bip32Derivation', async () => {
    const adapter = new LedgerAdapter();
    const mockGetExtendedPubkey = vi.fn().mockResolvedValue('xpub-fallback');
    const mockSignPsbt = vi.fn().mockResolvedValue([]);
    (adapter as any).connection = {
      app: {},
      appClient: {
        getMasterFingerprint: (...args: unknown[]) => mockGetMasterFingerprint(...args),
        getExtendedPubkey: (...args: unknown[]) => mockGetExtendedPubkey(...args),
        signPsbt: (...args: unknown[]) => mockSignPsbt(...args),
      },
      transport: { close: vi.fn() },
      device: makeUsbDevice(),
    };
    mockGetMasterFingerprint.mockResolvedValue('aabbccdd');

    const missingBip32Psbt = {
      data: { inputs: [{}] },
      toBase64: vi.fn(() => 'psbt-input-path'),
      updateInput: vi.fn(),
      finalizeAllInputs: vi.fn(),
    };
    mockPsbtFromBase64
      .mockReturnValueOnce(missingBip32Psbt)
      .mockReturnValueOnce(missingBip32Psbt);
    await expect(
      adapter.signPSBT({
        psbt: 'missing-bip32',
        inputPaths: ["m/44'"],
      })
    ).rejects.toThrow('PSBT is missing bip32Derivation');
    expect(mockGetExtendedPubkey).toHaveBeenCalledWith("m/44'");

    const defaultAccountPsbt = {
      data: { inputs: [] },
      toBase64: vi.fn(() => 'psbt-default'),
      updateInput: vi.fn(),
      finalizeAllInputs: vi.fn(),
    };
    mockPsbtFromBase64
      .mockReturnValueOnce(defaultAccountPsbt)
      .mockReturnValueOnce(defaultAccountPsbt);
    const result = await adapter.signPSBT({
      psbt: 'default-account',
      inputPaths: [],
    });
    expect(mockGetExtendedPubkey).toHaveBeenLastCalledWith("m/84'/0'/0'");
    expect(result).toEqual({ psbt: 'psbt-default', signatures: 0 });
  });

  it('covers remaining signPsbt branches for missing psbt length, empty input path, and fingerprint updates', async () => {
    const adapter = new LedgerAdapter();
    const mockGetExtendedPubkey = vi.fn().mockResolvedValue('xpub-branches');
    const mockSignPsbt = vi.fn().mockResolvedValue([]);
    (adapter as any).connection = {
      app: {},
      appClient: {
        getMasterFingerprint: (...args: unknown[]) => mockGetMasterFingerprint(...args),
        getExtendedPubkey: (...args: unknown[]) => mockGetExtendedPubkey(...args),
        signPsbt: (...args: unknown[]) => mockSignPsbt(...args),
      },
      transport: { close: vi.fn() },
      device: makeUsbDevice(),
    };
    mockGetMasterFingerprint.mockResolvedValue('aabbccdd');

    mockPsbtFromBase64.mockImplementationOnce(() => {
      throw new Error('invalid psbt');
    });
    await expect(adapter.signPSBT({ inputPaths: [] } as any)).rejects.toThrow(
      'Failed to sign transaction: invalid psbt'
    );

    const emptyPathPsbt = {
      data: {
        inputs: [{
          bip32Derivation: [{
            path: '',
            masterFingerprint: Buffer.from('aabbccdd', 'hex'),
            pubkey: Buffer.from(`02${'11'.repeat(32)}`, 'hex'),
          }],
        }],
      },
      toBase64: vi.fn(() => 'psbt-empty-path'),
      updateInput: vi.fn(),
      finalizeAllInputs: vi.fn(),
    };
    mockPsbtFromBase64
      .mockReturnValueOnce(emptyPathPsbt)
      .mockReturnValueOnce(emptyPathPsbt);
    await adapter.signPSBT({
      psbt: 'empty-path',
      inputPaths: ["m/84'/0'/0'/0/9"],
    });
    expect(mockGetExtendedPubkey).toHaveBeenCalledWith("m/84'/0'/0'");

    const mismatchPsbt = {
      data: {
        inputs: [{
          bip32Derivation: [{
            path: "m/84'/0'/0'/0/0",
            masterFingerprint: Buffer.from('01020304', 'hex'),
            pubkey: Buffer.from(`02${'22'.repeat(32)}`, 'hex'),
          }],
        }],
      },
      toBase64: vi.fn(() => 'psbt-mismatch'),
      updateInput: vi.fn(),
      finalizeAllInputs: vi.fn(),
    };
    mockPsbtFromBase64
      .mockReturnValueOnce(mismatchPsbt)
      .mockReturnValueOnce(mismatchPsbt);
    await adapter.signPSBT({
      psbt: 'mismatch',
      inputPaths: ["m/84'/0'/0'/0/0"],
    });
    expect(mismatchPsbt.data.inputs[0].bip32Derivation[0].masterFingerprint.toString('hex')).toBe('aabbccdd');
  });
});
