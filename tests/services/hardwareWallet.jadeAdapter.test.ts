import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  rpc: vi.fn(),
  signPsbt: vi.fn(),
  masterFingerprint: vi.fn(),
  accountXpubChain: vi.fn(),
  validateRequest: vi.fn(),
  validateSigned: vi.fn(),
  parseAddressPath: undefined as undefined | ((path: unknown) => unknown),
  protocolTransport: undefined as undefined | { invalidate: () => Promise<void> },
}));

vi.mock('@sanctuary/shared/constants/walletPolicy', async importOriginal => {
  const original = await importOriginal<typeof import('@sanctuary/shared/constants/walletPolicy')>();
  return {
    ...original,
    parseCanonicalAddressPath: (path: unknown) => (
      mocks.parseAddressPath?.(path) ?? original.parseCanonicalAddressPath(path)
    ),
  };
});

vi.mock('../../src/services/hardwareWallet/adapters/jadeProtocol', () => ({
  JadeProtocolSession: class {
    constructor(transport: { invalidate: () => Promise<void> }) {
      mocks.protocolTransport = transport;
    }
    authenticate = mocks.authenticate;
    rpc = mocks.rpc;
    signPsbt = mocks.signPsbt;
  },
}));

vi.mock('../../src/services/hardwareWallet/adapters/jadeIdentity', () => ({
  masterFingerprintFromRootXpub: (...args: unknown[]) => mocks.masterFingerprint(...args),
  assertJadeAccountXpubChain: (...args: unknown[]) => mocks.accountXpubChain(...args),
}));

vi.mock('../../src/services/hardwareWallet/psbtAccountBinding', () => ({
  validatePsbtSigningRequest: (...args: unknown[]) => mocks.validateRequest(...args),
}));

vi.mock('../../src/services/hardwareWallet/adapters/jadeSignedPsbt', () => ({
  validateJadeSignedPsbt: (...args: unknown[]) => mocks.validateSigned(...args),
}));

vi.mock('../../src/services/hardwareWallet/adapters/jadePinRelayClient', () => ({
  relayJadePinRequest: vi.fn(),
}));

vi.mock('../../src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { JadeAdapter } from '../../src/services/hardwareWallet/adapters/jade';

const originalWindow = globalThis.window;
const originalNavigator = globalThis.navigator;
const requestPort = vi.fn();
const getPorts = vi.fn();

function setEnvironment(secure = true, serial = true) {
  Object.defineProperty(globalThis, 'window', {
    value: { ...(originalWindow as object), isSecureContext: secure },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: serial ? { serial: { requestPort, getPorts } } : {},
    configurable: true,
  });
}

function port(vendorId = 0x1a86, productId = 0x55d4) {
  const reader = { read: vi.fn(), cancel: vi.fn(), releaseLock: vi.fn() };
  const writer = { write: vi.fn(), releaseLock: vi.fn() };
  return {
    getInfo: () => ({ usbVendorId: vendorId, usbProductId: productId }),
    open: vi.fn(),
    close: vi.fn(),
    readable: { getReader: () => reader },
    writable: { getWriter: () => writer },
    reader,
    writer,
  };
}

async function connect(adapter: JadeAdapter, selectedPort = port()) {
  requestPort.mockResolvedValueOnce(selectedPort);
  mocks.rpc
    .mockResolvedValueOnce({ id: 'version', result: { JADE_VERSION: '1.0.40', BOARD_TYPE: '' } })
    .mockResolvedValueOnce({ id: 'root', result: 'root-xpub' });
  return adapter.connect({ chainEnvironment: 'mainnet', expectedModel: 'Jade Plus' });
}

describe('JadeAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setEnvironment();
    getPorts.mockResolvedValue([]);
    mocks.masterFingerprint.mockReturnValue('deadbeef');
    mocks.accountXpubChain.mockReturnValue('xpub-account');
    mocks.authenticate.mockResolvedValue(undefined);
    mocks.parseAddressPath = undefined;
    mocks.protocolTransport = undefined;
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true });
    Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
  });

  it('requires WebSerial in a secure context and explicit network selection', async () => {
    const adapter = new JadeAdapter();
    expect(adapter.isSupported()).toBe(true);
    await expect(adapter.connect()).rejects.toThrow(/explicit supported chain environment/i);
    setEnvironment(false);
    expect(adapter.isSupported()).toBe(false);
    await expect(adapter.connect({ chainEnvironment: 'mainnet' })).rejects.toThrow(/WebSerial/i);
    setEnvironment(true, false);
    expect(adapter.isSupported()).toBe(false);
  });

  it('enumerates only exact Jade USB identifiers and labels Jade Plus explicitly', async () => {
    getPorts.mockResolvedValue([
      port(0x10c4, 0xea60),
      port(0x1a86, 0x55d4),
      port(1, 2),
    ]);
    await expect(new JadeAdapter().getAuthorizedDevices()).resolves.toMatchObject([
      { name: 'Jade', model: 'Jade' },
      { name: 'Jade Plus', model: 'Jade Plus' },
    ]);
    getPorts.mockRejectedValueOnce(new Error('enumeration failed'));
    await expect(new JadeAdapter().getAuthorizedDevices()).resolves.toEqual([]);
    setEnvironment(false);
    await expect(new JadeAdapter().getAuthorizedDevices()).resolves.toEqual([]);
  });

  it('authenticates one selected network then derives a stable fingerprint from transient root xpub', async () => {
    const adapter = new JadeAdapter();
    const device = await connect(adapter);

    expect(mocks.authenticate).toHaveBeenCalledWith('mainnet', expect.any(Function), expect.any(Number));
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'get_version_info');
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'get_xpub', { network: 'mainnet', path: [] });
    expect(mocks.masterFingerprint).toHaveBeenCalledWith('root-xpub', 'mainnet');
    expect(device).toMatchObject({ name: 'Jade Plus', fingerprint: 'deadbeef', firmwareVersion: '1.0.40' });
    expect(adapter.isConnected()).toBe(true);
    await expect(mocks.protocolTransport?.invalidate()).resolves.toBeUndefined();
    expect(adapter.isConnected()).toBe(false);
  });

  it('binds a base Jade session to the selected test-family network without a model fallback', async () => {
    const selectedPort = port(0x10c4, 0xea60);
    requestPort.mockResolvedValueOnce(selectedPort);
    mocks.rpc
      .mockResolvedValueOnce({ id: 'version', result: { JADE_VERSION: '1.0.40' } })
      .mockResolvedValueOnce({ id: 'root', result: 'test-root-xpub' });
    const adapter = new JadeAdapter();

    await expect(adapter.connect({ chainEnvironment: 'testnet3' })).resolves.toMatchObject({ model: 'Jade' });
    expect(mocks.authenticate).toHaveBeenCalledWith('testnet', expect.any(Function), expect.any(Number));
    expect(mocks.masterFingerprint).toHaveBeenCalledWith('test-root-xpub', 'testnet');
  });

  it('rejects a selected-model mismatch before authentication', async () => {
    requestPort.mockResolvedValueOnce(port(0x10c4, 0xea60));
    await expect(new JadeAdapter().connect({
      chainEnvironment: 'mainnet',
      expectedModel: 'Jade Plus',
    })).rejects.toThrow(/not the requested Jade Plus/i);
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it.each([
    [new Error('NotAllowedError'), /Access denied/i],
    [new Error('port busy'), /Device is busy/i],
    ['unknown', /Unknown error/i],
  ])('maps connection failure %p and leaves no live identity', async (failure, expected) => {
    requestPort.mockRejectedValueOnce(failure);
    const adapter = new JadeAdapter();
    await expect(adapter.connect({ chainEnvironment: 'mainnet' })).rejects.toThrow(expected);
    expect(adapter.getDevice()).toBeNull();
  });

  it('fails closed for unknown hardware, unusable streams, and malformed identity responses', async () => {
    requestPort.mockResolvedValueOnce(port(1, 2));
    await expect(new JadeAdapter().connect({ chainEnvironment: 'mainnet' }))
      .rejects.toThrow(/requested Jade model/i);

    const unusable = port();
    Object.assign(unusable, { readable: null });
    requestPort.mockResolvedValueOnce(unusable);
    await expect(new JadeAdapter().connect({ chainEnvironment: 'mainnet', expectedModel: 'Jade Plus' }))
      .rejects.toThrow(/not readable\/writable/i);

    requestPort.mockResolvedValueOnce(port());
    mocks.rpc.mockResolvedValueOnce({ id: 'version' });
    await expect(new JadeAdapter().connect({ chainEnvironment: 'mainnet', expectedModel: 'Jade Plus' }))
      .rejects.toThrow(/did not return version information/i);

    requestPort.mockResolvedValueOnce(port());
    mocks.rpc.mockResolvedValueOnce({ id: 'version', result: { JADE_VERSION: '' } });
    await expect(new JadeAdapter().connect({ chainEnvironment: 'mainnet', expectedModel: 'Jade Plus' }))
      .rejects.toThrow(/malformed version/i);

    requestPort.mockResolvedValueOnce(port());
    mocks.rpc
      .mockResolvedValueOnce({ id: 'version', result: { JADE_VERSION: '1.0.40' } })
      .mockResolvedValueOnce({ id: 'root' });
    await expect(new JadeAdapter().connect({ chainEnvironment: 'mainnet', expectedModel: 'Jade Plus' }))
      .rejects.toThrow(/did not return root xpub/i);
  });

  it('disconnects transport and clears session identity even when close fails', async () => {
    const selectedPort = port();
    const adapter = new JadeAdapter();
    await connect(adapter, selectedPort);
    selectedPort.close.mockRejectedValueOnce(new Error('close failed'));
    await expect(adapter.disconnect()).resolves.toBeUndefined();
    expect(selectedPort.reader.releaseLock).toHaveBeenCalled();
    expect(selectedPort.reader.cancel).toHaveBeenCalled();
    expect(selectedPort.writer.releaseLock).toHaveBeenCalled();
    expect(adapter.getDevice()).toBeNull();
  });

  it('continues every teardown step when cancellation and lock releases fail', async () => {
    const selectedPort = port();
    const adapter = new JadeAdapter();
    await connect(adapter, selectedPort);
    selectedPort.reader.cancel.mockRejectedValueOnce(new Error('cancel failed'));
    selectedPort.reader.releaseLock.mockImplementationOnce(() => { throw new Error('reader release failed'); });
    selectedPort.writer.releaseLock.mockImplementationOnce(() => { throw new Error('writer release failed'); });

    await expect(adapter.disconnect()).resolves.toBeUndefined();
    expect(selectedPort.close).toHaveBeenCalled();
    expect(adapter.getDevice()).toBeNull();
  });

  it('bounds stalled reader cancellation and still closes the serial port', async () => {
    const selectedPort = port();
    const adapter = new JadeAdapter();
    await connect(adapter, selectedPort);
    selectedPort.reader.cancel.mockReturnValueOnce(new Promise(() => undefined));

    vi.useFakeTimers();
    try {
      const disconnecting = adapter.disconnect();
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(disconnecting).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }

    expect(selectedPort.reader.releaseLock).toHaveBeenCalled();
    expect(selectedPort.writer.releaseLock).toHaveBeenCalled();
    expect(selectedPort.close).toHaveBeenCalled();
    expect(adapter.getDevice()).toBeNull();
  });

  it('exports only an exact canonical single-signature account on the selected family', async () => {
    const adapter = new JadeAdapter();
    await connect(adapter);
    mocks.rpc
      .mockResolvedValueOnce({ id: 'purpose', result: 'purpose-xpub' })
      .mockResolvedValueOnce({ id: 'coin', result: 'coin-xpub' })
      .mockResolvedValueOnce({ id: 'account', result: 'account-xpub' });

    await expect(adapter.getXpub("m/84'/0'/7'")).resolves.toEqual({
      xpub: 'xpub-account', fingerprint: 'deadbeef', path: "m/84'/0'/7'",
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(3, 'get_xpub', {
      network: 'mainnet',
      path: [0x80000054],
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(4, 'get_xpub', {
      network: 'mainnet',
      path: [0x80000054, 0x80000000],
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(5, 'get_xpub', {
      network: 'mainnet',
      path: [0x80000054, 0x80000000, 0x80000007],
    });
    expect(mocks.accountXpubChain).toHaveBeenCalledWith(
      ['purpose-xpub', 'coin-xpub', 'account-xpub'],
      "m/84'/0'/7'",
      'mainnet',
      'deadbeef',
    );
    await expect(adapter.getXpub("m/84'/1'/0'")).rejects.toThrow(/selected.*network session/i);
    await expect(adapter.getXpub("m/48'/0'/0'/2'")).rejects.toThrow(/single-signature/i);
  });

  it.each([
    ["m/44'/0'/0'/0/0", 'pkh(k)'],
    ["m/49'/0'/0'/0/0", 'sh(wpkh(k))'],
    ["m/84'/0'/0'/1/4", 'wpkh(k)'],
    ["m/86'/0'/0'/0/9", 'tr(k)'],
  ])('binds displayed %s address to its canonical variant', async (path, variant) => {
    const adapter = new JadeAdapter();
    await connect(adapter);
    mocks.rpc.mockResolvedValueOnce({ id: 'address', result: 'bc-address' });
    await expect(adapter.verifyAddress(path, 'bc-address')).resolves.toBe(true);
    expect(mocks.rpc).toHaveBeenLastCalledWith('get_receive_address', {
      network: 'mainnet', path: expect.any(Array), variant,
    }, true);
  });

  it('rejects cross-network and multisig display and maps user rejection to false', async () => {
    const adapter = new JadeAdapter();
    await connect(adapter);
    await expect(adapter.verifyAddress("m/84'/1'/0'/0/0", 'x')).rejects.toThrow(/network session/i);
    await expect(adapter.verifyAddress("m/48'/0'/0'/2'/0/0", 'x')).rejects.toThrow(/single-signature/i);
    mocks.rpc.mockRejectedValueOnce(new Error('user_cancelled'));
    await expect(adapter.verifyAddress("m/84'/0'/0'/0/0", 'x')).resolves.toBe(false);
    mocks.rpc.mockRejectedValueOnce(new Error('transport failed'));
    await expect(adapter.verifyAddress("m/84'/0'/0'/0/0", 'x')).rejects.toThrow('transport failed');
    mocks.rpc.mockRejectedValueOnce('non-error transport failure');
    await expect(adapter.verifyAddress("m/84'/0'/0'/0/0", 'x')).rejects.toBe('non-error transport failure');
  });

  it('fails closed if a future canonical single-signature policy has no Jade address variant', async () => {
    const adapter = new JadeAdapter();
    await connect(adapter);
    mocks.parseAddressPath = () => ({
      derivationFamily: 'mainnet',
      policy: { purpose: 48, walletType: 'single_sig' },
    });

    await expect(adapter.verifyAddress("m/48'/0'/0'/0/0", 'x'))
      .rejects.toThrow(/multisig address display is not supported/i);
    expect(mocks.rpc).not.toHaveBeenLastCalledWith('get_receive_address', expect.anything(), true);
  });

  it('sends binary PSBT only after exact preflight and validates the returned bytes', async () => {
    const adapter = new JadeAdapter();
    await connect(adapter);
    const validated = {
      network: 'mainnet', context: { walletType: 'single_sig' },
    };
    mocks.validateRequest.mockReturnValue(validated);
    mocks.signPsbt.mockResolvedValue(Uint8Array.from([9, 8, 7]));
    mocks.validateSigned.mockReturnValue({ psbt: 'signed', signatures: 1 });

    const request = { psbt: Buffer.from([1, 2, 3]).toString('base64') };
    await expect(adapter.signPSBT(request)).resolves.toEqual({ psbt: 'signed', signatures: 1 });
    expect(mocks.validateRequest).toHaveBeenCalledWith(request, 'deadbeef');
    expect(mocks.signPsbt).toHaveBeenCalledWith('mainnet', Uint8Array.from([1, 2, 3]));
    expect(mocks.validateSigned).toHaveBeenCalledWith(validated, Uint8Array.from([9, 8, 7]));
  });

  it('blocks multisig, cross-network signing, and disconnected calls', async () => {
    const disconnected = new JadeAdapter();
    await expect(disconnected.getXpub("m/84'/0'/0'")).rejects.toThrow(/authenticated Jade session/i);
    await expect(disconnected.verifyAddress("m/84'/0'/0'/0/0", 'x')).rejects.toThrow(/authenticated Jade session/i);
    await expect(disconnected.signPSBT({ psbt: 'x' })).rejects.toThrow(/authenticated Jade session/i);

    const adapter = new JadeAdapter();
    await connect(adapter);
    mocks.validateRequest.mockReturnValueOnce({ network: 'mainnet', context: { walletType: 'multi_sig' } });
    await expect(adapter.signPSBT({ psbt: 'x' })).rejects.toThrow(/multisig signing is not supported/i);
    mocks.validateRequest.mockReturnValueOnce({ network: 'testnet3', context: { walletType: 'single_sig' } });
    await expect(adapter.signPSBT({ psbt: 'x' })).rejects.toThrow(/selected network session/i);
  });

  it('maps signing rejection explicitly and preserves other protocol failures', async () => {
    const adapter = new JadeAdapter();
    await connect(adapter);
    mocks.validateRequest.mockReturnValue({ network: 'mainnet', context: { walletType: 'single_sig' } });
    mocks.signPsbt.mockRejectedValueOnce(new Error('user_rejected'));
    await expect(adapter.signPSBT({ psbt: 'cHNidP8=' })).rejects.toThrow('Transaction rejected on Jade');
    mocks.signPsbt.mockRejectedValueOnce(new Error('serial failed'));
    await expect(adapter.signPSBT({ psbt: 'cHNidP8=' })).rejects.toThrow('serial failed');
  });

  it('returns unsupported when browser globals are absent', () => {
    Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true });
    expect(new JadeAdapter().isSupported()).toBe(false);
    Object.defineProperty(globalThis, 'navigator', { value: { serial: {} }, configurable: true });
    Object.defineProperty(globalThis, 'window', { value: undefined, configurable: true });
    expect(new JadeAdapter().isSupported()).toBe(false);
  });
});
