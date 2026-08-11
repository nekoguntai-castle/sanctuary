import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transportCreate: vi.fn(),
  transportClose: vi.fn(),
  usbGetDevices: vi.fn(),
  getMasterFingerprint: vi.fn(),
  getAppAndVersion: vi.fn(),
  getExtendedPubkey: vi.fn(),
  getWalletAddress: vi.fn(),
  signPsbt: vi.fn(),
  MockAppClient: vi.fn(function MockAppClient(this: Record<string, unknown>) {
    this.getMasterFingerprint = (...args: unknown[]) => mocks.getMasterFingerprint(...args);
    this.getAppAndVersion = (...args: unknown[]) => mocks.getAppAndVersion(...args);
    this.getExtendedPubkey = (...args: unknown[]) => mocks.getExtendedPubkey(...args);
    this.getWalletAddress = (...args: unknown[]) => mocks.getWalletAddress(...args);
  }),
  MockDefaultWalletPolicy: vi.fn(function MockDefaultWalletPolicy(
    this: Record<string, unknown>, template: string, key: string,
  ) {
    this.template = template;
    this.key = key;
  }),
}));

vi.mock('@ledgerhq/hw-transport-webusb', () => ({
  default: { create: (...args: unknown[]) => mocks.transportCreate(...args) },
}));
vi.mock('@ledgerhq/ledger-bitcoin', () => ({
  AppClient: mocks.MockAppClient,
  DefaultWalletPolicy: mocks.MockDefaultWalletPolicy,
}));
vi.mock('../../src/services/hardwareWallet/adapters/ledger/signPsbt', () => ({
  signPsbt: (...args: unknown[]) => mocks.signPsbt(...args),
}));
vi.mock('../../src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { LedgerAdapter } from '../../src/services/hardwareWallet/adapters/ledger';

const originalWindow = globalThis.window;
const originalNavigator = globalThis.navigator;

function setWebUsbEnv(secure = true, withUsb = true): void {
  Object.defineProperty(globalThis, 'window', {
    value: { ...(originalWindow as object), isSecureContext: secure }, configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: withUsb ? { usb: { getDevices: mocks.usbGetDevices } } : {}, configurable: true,
  });
}

function usbDevice(overrides: Record<string, unknown> = {}) {
  return {
    vendorId: 0x2c97,
    productId: 0x0005,
    serialNumber: 'ledger-test',
    opened: false,
    ...overrides,
  };
}

function transport(device = usbDevice()) {
  return { device, close: (...args: unknown[]) => mocks.transportClose(...args) };
}

async function connectedAdapter(options: { appName?: string; xpub?: string } = {}) {
  mocks.getAppAndVersion.mockResolvedValue({
    name: options.appName ?? 'Bitcoin', version: '2.4.2', flags: 0,
  });
  mocks.getExtendedPubkey.mockResolvedValue(options.xpub ?? 'xpub-account');
  mocks.transportCreate.mockResolvedValue(transport());
  const adapter = new LedgerAdapter();
  await adapter.connect();
  return adapter;
}

describe('LedgerAdapter modern policy boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setWebUsbEnv();
    mocks.usbGetDevices.mockResolvedValue([]);
    mocks.transportClose.mockResolvedValue(undefined);
    mocks.getMasterFingerprint.mockResolvedValue('AABBCCDD');
    mocks.getAppAndVersion.mockResolvedValue({ name: 'Bitcoin', version: '2.4.2', flags: 0 });
    mocks.getExtendedPubkey.mockResolvedValue('xpub-account');
    mocks.getWalletAddress.mockResolvedValue('bc1qdevice');
    mocks.signPsbt.mockResolvedValue({ psbt: 'signed', signatures: 1 });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true });
    Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
  });

  it('requires secure-context WebUSB support', () => {
    const adapter = new LedgerAdapter();
    expect(adapter.isSupported()).toBe(true);
    setWebUsbEnv(false, true);
    expect(adapter.isSupported()).toBe(false);
    setWebUsbEnv(true, false);
    expect(adapter.isSupported()).toBe(false);
  });

  it('supports an injected transport without browser WebUSB', async () => {
    setWebUsbEnv(false, false);
    const device = usbDevice();
    const openTransport = vi.fn().mockResolvedValue({ transport: transport(device), device });
    const adapter = new LedgerAdapter({ openTransport });
    expect(adapter.isSupported()).toBe(true);
    await expect(adapter.connect()).resolves.toMatchObject({ fingerprint: 'aabbccdd' });
    expect(openTransport).toHaveBeenCalledOnce();
    expect(mocks.transportCreate).not.toHaveBeenCalled();
  });

  it('rejects connect when browser WebUSB is unavailable', async () => {
    setWebUsbEnv(false, false);
    await expect(new LedgerAdapter().connect()).rejects.toThrow(/WebUSB is not supported/);
  });

  it('filters authorized devices to the Ledger vendor and maps known/unknown models', async () => {
    mocks.usbGetDevices.mockResolvedValue([
      usbDevice({ productId: 0x0004, opened: true }),
      usbDevice({ productId: 0x9999, serialNumber: undefined }),
      usbDevice({ vendorId: 0x1234 }),
    ]);
    const devices = await new LedgerAdapter().getAuthorizedDevices();
    expect(devices).toHaveLength(2);
    expect(devices[0]).toMatchObject({ name: 'Ledger Nano X', connected: true });
    expect(devices[1]).toMatchObject({ name: 'Ledger Device', id: 'ledger-11415-39321-unknown' });
  });

  it('returns no authorized devices when unsupported or enumeration fails', async () => {
    setWebUsbEnv(false, true);
    await expect(new LedgerAdapter().getAuthorizedDevices()).resolves.toEqual([]);
    setWebUsbEnv();
    mocks.usbGetDevices.mockRejectedValue(new Error('USB failed'));
    await expect(new LedgerAdapter().getAuthorizedDevices()).resolves.toEqual([]);
  });

  it('connects only after exact app identity and fingerprint are available', async () => {
    mocks.transportCreate.mockResolvedValue(transport());
    const adapter = new LedgerAdapter();
    await expect(adapter.connect()).resolves.toMatchObject({
      type: 'ledger', model: 'Ledger Nano S Plus', fingerprint: 'aabbccdd', connected: true,
    });
    expect(mocks.MockAppClient).toHaveBeenCalledOnce();
    expect(mocks.getAppAndVersion).toHaveBeenCalledBefore(mocks.getMasterFingerprint);
    expect(adapter.isConnected()).toBe(true);
  });

  it.each([
    ['metadata failure', new Error('app metadata unavailable'), /app metadata unavailable/],
    ['wrong app', { name: 'Ethereum', version: '2.4.2', flags: 0 }, /open the Bitcoin/],
    ['legacy app', { name: 'Bitcoin Legacy', version: '2.4.2', flags: 0 }, /open the Bitcoin/],
    ['old app', { name: 'Bitcoin', version: '2.0.9', flags: 0 }, /unsupported/],
  ])('fails closed and closes transport on %s', async (_label, outcome, expected) => {
    mocks.transportCreate.mockResolvedValue(transport());
    outcome instanceof Error
      ? mocks.getAppAndVersion.mockRejectedValue(outcome)
      : mocks.getAppAndVersion.mockResolvedValue(outcome);
    await expect(new LedgerAdapter().connect()).rejects.toThrow(expected);
    expect(mocks.transportClose).toHaveBeenCalledOnce();
  });

  it.each(['', '00000000', 'not-hex'])('rejects invalid fingerprint %j and closes', async (fingerprint) => {
    mocks.transportCreate.mockResolvedValue(transport());
    mocks.getMasterFingerprint.mockResolvedValue(fingerprint);
    await expect(new LedgerAdapter().connect()).rejects.toThrow(/fingerprint/i);
    expect(mocks.transportClose).toHaveBeenCalledOnce();
  });

  it('preserves app and fingerprint failures when transport cleanup also fails', async () => {
    mocks.transportCreate.mockResolvedValue(transport());
    mocks.getAppAndVersion.mockRejectedValueOnce(new Error('app metadata unavailable'));
    mocks.transportClose.mockRejectedValueOnce(new Error('close failed'));
    await expect(new LedgerAdapter().connect()).rejects.toThrow(/app metadata unavailable/);

    mocks.transportCreate.mockResolvedValue(transport());
    mocks.getAppAndVersion.mockResolvedValueOnce({ name: 'Bitcoin', version: '2.4.2', flags: 0 });
    mocks.getMasterFingerprint.mockRejectedValueOnce(new Error('fingerprint read failed'));
    mocks.transportClose.mockRejectedValueOnce(new Error('close failed'));
    await expect(new LedgerAdapter().connect()).rejects.toThrow(/fingerprint read failed/);
  });

  it('maps readiness and transport failures without hiding their category', async () => {
    mocks.transportCreate.mockResolvedValueOnce(transport());
    mocks.getMasterFingerprint.mockRejectedValueOnce(new Error('0x6982 locked'));
    await expect(new LedgerAdapter().connect()).rejects.toThrow(/Ledger is locked/);

    mocks.transportCreate.mockRejectedValueOnce(new Error('permission denied'));
    await expect(new LedgerAdapter().connect()).rejects.toThrow(/Access denied/);

    mocks.transportCreate.mockRejectedValueOnce({ reason: 'opaque' });
    await expect(new LedgerAdapter().connect()).rejects.toThrow(/Unknown error/);
  });

  it('closes an old connection before reconnecting and disconnect clears state', async () => {
    const adapter = await connectedAdapter();
    mocks.transportCreate.mockResolvedValue(transport(usbDevice({ serialNumber: 'second' })));
    await adapter.connect();
    expect(mocks.transportClose).toHaveBeenCalledOnce();
    await adapter.disconnect();
    expect(mocks.transportClose).toHaveBeenCalledTimes(2);
    expect(adapter.getDevice()).toBeNull();
  });

  it('clears connection state when disconnect transport close fails', async () => {
    const adapter = await connectedAdapter();
    mocks.transportClose.mockRejectedValueOnce(new Error('close failed'));
    await expect(adapter.disconnect()).resolves.toBeUndefined();
    expect(adapter.getDevice()).toBeNull();
    expect(adapter.isConnected()).toBe(false);
  });

  it('allows idempotent disconnect and rejects a fingerprint read without a connection', async () => {
    const adapter = new LedgerAdapter();
    await expect(adapter.disconnect()).resolves.toBeUndefined();
    await expect((adapter as any).getMasterFingerprint()).rejects.toThrow('No device connected');
  });

  it.each([
    ["m/44'/0'/0'", 'Bitcoin'],
    ["m/49'/1'/7'", 'Bitcoin Test'],
    ["m/84'/0'/7'", 'Bitcoin'],
    ["m/86'/1'/0'", 'Bitcoin Test'],
  ])('exports canonical account %s only from %s', async (path, appName) => {
    const xpub = path.includes("/1'/") ? 'tpub-account' : 'xpub-account';
    const adapter = await connectedAdapter({ appName, xpub });
    await expect(adapter.getXpub(path)).resolves.toEqual({
      xpub, fingerprint: 'aabbccdd', path,
    });
    expect(mocks.getExtendedPubkey).toHaveBeenCalledWith(path, false);
    expect(mocks.getAppAndVersion).toHaveBeenCalledTimes(2);
  });

  it('rejects wrong-network app and empty xpub without legacy fallback', async () => {
    const adapter = await connectedAdapter({ appName: 'Bitcoin' });
    await expect(adapter.getXpub("m/84'/1'/0'")).rejects.toThrow(/Bitcoin Test app is required/);
    mocks.getExtendedPubkey.mockResolvedValue('');
    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow(/empty xpub/);
  });

  it('maps string and unknown xpub failures without substituting account data', async () => {
    const adapter = await connectedAdapter();
    mocks.getExtendedPubkey.mockRejectedValueOnce('permission denied');
    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow(/Access denied/);
    mocks.getExtendedPubkey.mockRejectedValueOnce({ reason: 'opaque' });
    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow(/Unknown error/);
  });

  it('rejects export when the current Ledger identity differs from the connected session', async () => {
    const adapter = await connectedAdapter({ appName: 'Bitcoin' });
    mocks.getMasterFingerprint.mockResolvedValueOnce('11223344');
    await expect(adapter.getXpub("m/84'/0'/0'"))
      .rejects.toThrow(/session identity changed/i);
  });

  it.each([
    ["m/44'/0'/0'/0/0", '1legacy', 0, 0],
    ["m/49'/0'/7'/0/19", '3nested', 0, 19],
    ["m/84'/0'/7'/1/0", 'bc1qchange', 1, 0],
    ["m/86'/0'/0'/1/19", 'bc1ptaproot', 1, 19],
  ])('displays and compares canonical address %s', async (path, address, branch, index) => {
    const adapter = await connectedAdapter();
    mocks.getWalletAddress.mockResolvedValue(address);
    await expect(adapter.verifyAddress(path, address)).resolves.toBe(true);
    expect(mocks.getWalletAddress).toHaveBeenCalledWith(
      expect.any(Object), null, branch, index, true,
    );
  });

  it('uses the Bitcoin Test session for test-family address display', async () => {
    const adapter = await connectedAdapter({ appName: 'Bitcoin Test', xpub: 'tpub-account' });
    mocks.getWalletAddress.mockResolvedValue('tb1qdevice');
    await expect(adapter.verifyAddress("m/84'/1'/0'/0/0", 'tb1qdevice')).resolves.toBe(true);
    expect(mocks.getAppAndVersion).toHaveBeenCalledTimes(2);
  });

  it('returns false for display mismatch or user rejection and throws other failures', async () => {
    const adapter = await connectedAdapter();
    const path = "m/84'/0'/0'/0/0";
    mocks.getWalletAddress.mockResolvedValue('bc1qother');
    await expect(adapter.verifyAddress(path, 'bc1qexpected')).resolves.toBe(false);
    mocks.getWalletAddress.mockRejectedValue(new Error('0x6985 denied'));
    await expect(adapter.verifyAddress(path, 'bc1qexpected')).resolves.toBe(false);
    mocks.getWalletAddress.mockRejectedValue(new Error('transport corrupt'));
    await expect(adapter.verifyAddress(path, 'bc1qexpected')).rejects.toThrow(/Failed to verify address/);
    mocks.getWalletAddress.mockRejectedValue({ reason: 'opaque' });
    await expect(adapter.verifyAddress(path, 'bc1qexpected')).rejects.toThrow(/Unknown error/);
  });

  it('rejects noncanonical or multisig address display paths before device display', async () => {
    const adapter = await connectedAdapter();
    await expect(adapter.verifyAddress("m/84'/0'/0'/2/0", 'address')).rejects.toThrow(/canonical/);
    await expect(adapter.verifyAddress("m/48'/0'/0'/2'/0/0", 'address')).rejects.toThrow(/canonical/);
    expect(mocks.getWalletAddress).not.toHaveBeenCalled();
  });

  it('requires a connection for xpub, display, and signing operations', async () => {
    const adapter = new LedgerAdapter();
    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow('No device connected');
    await expect(adapter.verifyAddress("m/84'/0'/0'/0/0", 'address')).rejects.toThrow('No device connected');
    await expect(adapter.signPSBT({ psbt: 'psbt' })).rejects.toThrow('No device connected');
  });

  it('delegates signing and preserves fail-closed error categories', async () => {
    const adapter = await connectedAdapter();
    const request = { walletId: 'wallet', psbt: 'unsigned' };
    await expect(adapter.signPSBT(request)).resolves.toEqual({ psbt: 'signed', signatures: 1 });
    expect(mocks.signPsbt).toHaveBeenCalledWith(expect.any(Object), request);

    mocks.signPsbt.mockRejectedValue(new Error('Ledger multisig USB signing is blocked pending proof'));
    await expect(adapter.signPSBT(request)).rejects.toThrow(/multisig USB signing is blocked/);
    mocks.signPsbt.mockRejectedValue(new Error('0x6985 denied'));
    await expect(adapter.signPSBT(request)).rejects.toThrow(/Transaction rejected/);
    mocks.signPsbt.mockRejectedValue(new Error('0x6d00'));
    await expect(adapter.signPSBT(request)).rejects.toThrow(/Bitcoin app not open/);
    mocks.signPsbt.mockRejectedValue(new Error('0x6982 locked'));
    await expect(adapter.signPSBT(request)).rejects.toThrow(/Device is locked/);
    mocks.signPsbt.mockRejectedValue(new Error('No device'));
    await expect(adapter.signPSBT(request)).rejects.toThrow(/Device disconnected/);
    mocks.signPsbt.mockRejectedValue(new Error('unexpected signing failure'));
    await expect(adapter.signPSBT(request)).rejects.toThrow(/Failed to sign transaction/);
    mocks.signPsbt.mockRejectedValue({ reason: 'opaque' });
    await expect(adapter.signPSBT(request)).rejects.toThrow(/Unknown error/);
  });
});
