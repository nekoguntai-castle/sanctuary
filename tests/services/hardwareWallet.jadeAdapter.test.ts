/**
 * Jade adapter coverage tests
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decode, encode } from 'cbor-x';

const mockSerialGetPorts = vi.fn();
const mockSerialRequestPort = vi.fn();

vi.mock('cbor-x', () => ({
  encode: vi.fn((value: unknown) => value),
  decode: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { JadeAdapter } from '../../services/hardwareWallet/adapters/jade';

const originalWindow = globalThis.window;
const originalNavigator = globalThis.navigator;

function setWebSerialEnv(options: { secure?: boolean; withSerial?: boolean } = {}) {
  const { secure = true, withSerial = true } = options;
  Object.defineProperty(globalThis, 'window', {
    value: {
      ...(originalWindow as object),
      isSecureContext: secure,
    },
    configurable: true,
  });

  const nav = withSerial
    ? {
      serial: {
        getPorts: (...args: unknown[]) => mockSerialGetPorts(...args),
        requestPort: (...args: unknown[]) => mockSerialRequestPort(...args),
      },
    }
    : {};

  Object.defineProperty(globalThis, 'navigator', {
    value: nav,
    configurable: true,
  });
}

function makePort(vendorId: number, productId: number) {
  return {
    getInfo: () => ({ usbVendorId: vendorId, usbProductId: productId }),
    close: vi.fn(async () => undefined),
    open: vi.fn(async () => undefined),
    readable: {
      getReader: vi.fn(() => ({
        read: vi.fn(async () => ({ done: false, value: new Uint8Array([]) })),
        releaseLock: vi.fn(),
      })),
    },
    writable: {
      getWriter: vi.fn(() => ({
        write: vi.fn(async () => undefined),
        releaseLock: vi.fn(),
      })),
    },
  };
}

function makeConnection({
  read = vi.fn(async () => ({ done: false, value: undefined as Uint8Array | undefined })),
  write = vi.fn(async () => undefined),
} = {}) {
  return {
    port: { close: vi.fn(async () => undefined) },
    reader: {
      read,
      releaseLock: vi.fn(),
    },
    writer: {
      write,
      releaseLock: vi.fn(),
    },
    messageId: 0,
  };
}

describe('JadeAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(encode).mockImplementation(() => new Uint8Array([1, 2, 3]));
    vi.mocked(decode).mockReset();
    setWebSerialEnv({ secure: true, withSerial: true });
    mockSerialGetPorts.mockResolvedValue([]);
    mockSerialRequestPort.mockResolvedValue(makePort(0x10c4, 0xea60));
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true });
    Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
  });

  it('checks WebSerial support based on secure context and serial availability', () => {
    const adapter = new JadeAdapter();
    expect(adapter.isSupported()).toBe(true);

    setWebSerialEnv({ secure: false, withSerial: true });
    expect(adapter.isSupported()).toBe(false);

    setWebSerialEnv({ secure: true, withSerial: false });
    expect(adapter.isSupported()).toBe(false);
  });

  it('returns empty authorized devices when unsupported', async () => {
    setWebSerialEnv({ secure: false, withSerial: true });
    const adapter = new JadeAdapter();
    await expect(adapter.getAuthorizedDevices()).resolves.toEqual([]);
  });

  it('filters and maps authorized Jade/Jade Plus devices', async () => {
    const jade = makePort(0x10c4, 0xea60);
    const jadePlus = makePort(0x1a86, 0x55d4);
    const other = makePort(0x1234, 0xabcd);
    mockSerialGetPorts.mockResolvedValue([jade, jadePlus, other]);

    const adapter = new JadeAdapter();
    const devices = await adapter.getAuthorizedDevices();

    expect(devices).toHaveLength(2);
    expect(devices[0].name).toBe('Jade');
    expect(devices[1].name).toBe('Jade Plus');
  });

  it('handles errors while enumerating authorized ports', async () => {
    mockSerialGetPorts.mockRejectedValue(new Error('serial error'));
    const adapter = new JadeAdapter();
    await expect(adapter.getAuthorizedDevices()).resolves.toEqual([]);
  });

  it('executes sendRpc with encoded payloads and maps Jade RPC errors', async () => {
    const adapter = new JadeAdapter();
    const write = vi.fn(async () => undefined);
    (adapter as any).connection = makeConnection({ write });

    const readResponseSpy = vi.spyOn(adapter as any, 'readResponse');
    readResponseSpy.mockResolvedValueOnce({ id: 'msg1', result: 'ok' });

    const result = await (adapter as any).sendRpc('get_xpub', { network: 'mainnet' });
    expect(result).toBe('ok');
    expect(write).toHaveBeenCalledWith(expect.any(Uint8Array));
    expect(readResponseSpy).toHaveBeenCalledWith(expect.stringMatching(/^msg\d+$/));

    readResponseSpy.mockResolvedValueOnce({
      id: 'msg2',
      error: { code: 7, message: 'denied' },
    });
    await expect((adapter as any).sendRpc('get_xpub')).rejects.toThrow('Jade error (7): denied');
  });

  it('requires an active connection for sendRpc and readResponse', async () => {
    const adapter = new JadeAdapter();
    await expect((adapter as any).sendRpc('ping')).rejects.toThrow('No device connected');
    await expect((adapter as any).readResponse('msg', 1)).rejects.toThrow('No device connected');
  });

  it('reads matching responses from buffer and appends streamed bytes', async () => {
    const adapter = new JadeAdapter();
    const read = vi
      .fn()
      .mockResolvedValueOnce({ done: false, value: new Uint8Array([2, 3]) });
    (adapter as any).connection = makeConnection({ read });

    // First decode: unexpected message from existing buffer. Second: expected response after append.
    vi.mocked(decode)
      .mockReturnValueOnce({ id: 'other', result: 'skip' } as any)
      .mockReturnValueOnce({ id: 'msg-expected', result: 'done' } as any);

    (adapter as any).responseBuffer = new Uint8Array([1]);
    const response = await (adapter as any).readResponse('msg-expected', 100);

    expect(response).toEqual({ id: 'msg-expected', result: 'done' });
    expect(read).toHaveBeenCalledTimes(1);
    expect((adapter as any).responseBuffer).toEqual(new Uint8Array(0));
  });

  it('maps readResponse serial-closed and timeout paths', async () => {
    const adapterClosed = new JadeAdapter();
    const readClosed = vi.fn(async () => ({ done: true, value: undefined }));
    (adapterClosed as any).connection = makeConnection({ read: readClosed });
    await expect((adapterClosed as any).readResponse('msg', 100)).rejects.toThrow(
      'Serial port closed unexpectedly'
    );

    const adapterNoValue = new JadeAdapter();
    const readNoValueThenClosed = vi
      .fn()
      .mockResolvedValueOnce({ done: false, value: undefined })
      .mockResolvedValueOnce({ done: true, value: undefined });
    (adapterNoValue as any).connection = makeConnection({ read: readNoValueThenClosed });
    await expect((adapterNoValue as any).readResponse('msg', 100)).rejects.toThrow(
      'Serial port closed unexpectedly'
    );

    const adapterTimeout = new JadeAdapter();
    (adapterTimeout as any).connection = makeConnection();
    await expect((adapterTimeout as any).readResponse('msg', 0)).rejects.toThrow(
      'Timeout waiting for device response'
    );
  });

  it('throws friendly errors for unsupported and denied connect', async () => {
    setWebSerialEnv({ secure: false, withSerial: true });
    await expect(new JadeAdapter().connect()).rejects.toThrow('WebSerial is not supported');

    setWebSerialEnv({ secure: true, withSerial: true });
    mockSerialRequestPort.mockRejectedValueOnce(new Error('NotAllowedError'));
    await expect(new JadeAdapter().connect()).rejects.toThrow('Access denied');
  });

  it('maps busy errors during connect', async () => {
    mockSerialRequestPort.mockRejectedValueOnce(new Error('port busy'));
    await expect(new JadeAdapter().connect()).rejects.toThrow('Device is busy');
  });

  it('connects successfully and maps Jade Plus metadata', async () => {
    const adapter = new JadeAdapter();
    mockSerialRequestPort.mockResolvedValueOnce(makePort(0x1a86, 0x55d4));
    const sendRpcSpy = vi.spyOn(adapter as any, 'sendRpc').mockResolvedValueOnce({
      JADE_VERSION: '1.0.0',
      BOARD_TYPE: '',
      JADE_FEATURES: 'camera',
    });

    const device = await adapter.connect();
    expect(device.name).toBe('Jade Plus');
    expect(device.model).toBe('Jade Plus');
    expect(adapter.isConnected()).toBe(true);
    expect(sendRpcSpy).toHaveBeenCalledWith('get_version_info');
  });

  it('maps generic connect failures and unreadable port errors', async () => {
    const badPort = {
      ...makePort(0x10c4, 0xea60),
      readable: undefined,
      writable: undefined,
    };
    mockSerialRequestPort.mockResolvedValueOnce(badPort as any);
    await expect(new JadeAdapter().connect()).rejects.toThrow(
      'Failed to connect: Serial port not readable/writable'
    );

    mockSerialRequestPort.mockRejectedValueOnce(new Error('strange failure'));
    await expect(new JadeAdapter().connect()).rejects.toThrow('Failed to connect: strange failure');

    mockSerialRequestPort.mockRejectedValueOnce({ code: 'unknown' });
    await expect(new JadeAdapter().connect()).rejects.toThrow('Failed to connect: Unknown error');
  });

  it('connects to standard Jade and falls back model to Jade when board type is missing', async () => {
    const adapter = new JadeAdapter();
    mockSerialRequestPort.mockResolvedValueOnce(makePort(0x10c4, 0xea60));
    vi.spyOn(adapter as any, 'sendRpc').mockResolvedValueOnce({
      JADE_VERSION: '1.2.3',
      BOARD_TYPE: '',
      JADE_FEATURES: 'camera',
    });

    const device = await adapter.connect();
    expect(device.name).toBe('Jade 1.2.3');
    expect(device.model).toBe('Jade');
  });

  it('disconnects and clears state even if close fails', async () => {
    const adapter = new JadeAdapter();
    const releaseReader = vi.fn();
    const releaseWriter = vi.fn();
    const close = vi.fn(async () => {
      throw new Error('close failed');
    });

    (adapter as any).connection = {
      port: { close },
      reader: { releaseLock: releaseReader },
      writer: { releaseLock: releaseWriter },
      messageId: 1,
    };
    (adapter as any).connectedDevice = {
      id: 'jade-1',
      type: 'jade',
      name: 'Jade',
      model: 'Jade',
      connected: true,
      fingerprint: undefined,
    };
    (adapter as any).responseBuffer = new Uint8Array([1, 2, 3]);

    await expect(adapter.disconnect()).resolves.toBeUndefined();
    expect(releaseReader).toHaveBeenCalled();
    expect(releaseWriter).toHaveBeenCalled();
    expect(adapter.getDevice()).toBeNull();
    expect((adapter as any).responseBuffer).toEqual(new Uint8Array(0));
  });

  it('requires active connection for xpub/verify/sign', async () => {
    const adapter = new JadeAdapter();
    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow('No device connected');
    await expect(adapter.verifyAddress("m/84'/0'/0'/0/0", 'bc1qxyz')).rejects.toThrow('No device connected');
    await expect(adapter.signPSBT({ psbt: 'abc', inputPaths: [] })).rejects.toThrow('No device connected');
    await expect((adapter as any).signPSBT(undefined)).rejects.toThrow('No device connected');
  });

  it('gets xpub and maps cancellation/default errors', async () => {
    const adapter = new JadeAdapter();
    (adapter as any).connection = makeConnection();
    const sendRpcSpy = vi.spyOn(adapter as any, 'sendRpc');

    sendRpcSpy.mockResolvedValueOnce('tpub-jade');
    const result = await adapter.getXpub('m/84h/1h/0h');
    expect(result).toEqual({
      xpub: 'tpub-jade',
      fingerprint: '',
      path: 'm/84h/1h/0h',
    });
    expect(sendRpcSpy).toHaveBeenCalledWith(
      'get_xpub',
      expect.objectContaining({
        network: 'testnet',
        path: expect.any(Array),
      })
    );

    sendRpcSpy.mockRejectedValueOnce(new Error('user_cancelled'));
    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow('Request cancelled on device');

    sendRpcSpy.mockRejectedValueOnce(new Error('rpc failure'));
    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow('Failed to get xpub: rpc failure');

    sendRpcSpy.mockRejectedValueOnce({ code: 'rpc-failure' });
    await expect(adapter.getXpub("m/84'/0'/0'")).rejects.toThrow('Failed to get xpub: Unknown error');
  });

  it('verifies address variants and handles user cancel', async () => {
    const adapter = new JadeAdapter();
    (adapter as any).connection = makeConnection();
    const sendRpcSpy = vi.spyOn(adapter as any, 'sendRpc');

    sendRpcSpy.mockResolvedValue('bc1qxyz');
    await expect(adapter.verifyAddress("m/84'/0'/0'/0/0", 'bc1qxyz')).resolves.toBe(true);
    expect(sendRpcSpy).toHaveBeenLastCalledWith(
      'get_receive_address',
      expect.objectContaining({ variant: 'wpkh(k)' })
    );

    await expect(adapter.verifyAddress("m/49'/0'/0'/0/0", '3abc')).resolves.toBe(true);
    expect(sendRpcSpy).toHaveBeenLastCalledWith(
      'get_receive_address',
      expect.objectContaining({ variant: 'sh(wpkh(k))' })
    );

    await expect(adapter.verifyAddress("m/86'/0'/0'/0/0", 'bc1pabc')).resolves.toBe(true);
    expect(sendRpcSpy).toHaveBeenLastCalledWith(
      'get_receive_address',
      expect.objectContaining({ variant: 'tr(k)' })
    );

    await expect(adapter.verifyAddress("m/44'/0'/0'/0/0", '1abc')).resolves.toBe(true);
    expect(sendRpcSpy).toHaveBeenLastCalledWith(
      'get_receive_address',
      expect.objectContaining({ variant: 'pkh(k)' })
    );

    await expect(adapter.verifyAddress("m/84h/1h/0h/0/0", 'tb1qxyz')).resolves.toBe(true);
    expect(sendRpcSpy).toHaveBeenLastCalledWith(
      'get_receive_address',
      expect.objectContaining({
        network: 'testnet',
        variant: 'wpkh(k)',
      })
    );

    sendRpcSpy.mockRejectedValueOnce(new Error('User cancelled'));
    await expect(adapter.verifyAddress("m/84'/0'/0'/0/0", 'bc1qxyz')).resolves.toBe(false);

    sendRpcSpy.mockRejectedValueOnce(new Error('device error'));
    await expect(adapter.verifyAddress("m/84'/0'/0'/0/0", 'bc1qxyz')).rejects.toThrow(
      'Failed to verify address: device error'
    );

    sendRpcSpy.mockRejectedValueOnce({ code: 'device-error' });
    await expect(adapter.verifyAddress("m/84'/0'/0'/0/0", 'bc1qxyz')).rejects.toThrow(
      'Failed to verify address: Unknown error'
    );
  });

  it('signs PSBT and maps cancellation/busy errors', async () => {
    const adapter = new JadeAdapter();
    (adapter as any).connection = makeConnection();
    const sendRpcSpy = vi.spyOn(adapter as any, 'sendRpc');

    sendRpcSpy.mockResolvedValueOnce('signed-psbt');
    const result = await adapter.signPSBT({
      psbt: 'base64-psbt',
      inputPaths: ["m/84'/1'/0'/0/0", "m/84'/1'/0'/0/1"],
    });
    expect(result).toEqual({ psbt: 'signed-psbt', signatures: 2 });
    expect(sendRpcSpy).toHaveBeenCalledWith('sign_psbt', {
      network: 'testnet',
      psbt: 'base64-psbt',
    });

    sendRpcSpy.mockResolvedValueOnce('signed-mainnet');
    const defaultPathResult = await adapter.signPSBT({
      psbt: 'base64-mainnet',
      inputPaths: [],
    });
    expect(defaultPathResult).toEqual({ psbt: 'signed-mainnet', signatures: 1 });
    expect(sendRpcSpy).toHaveBeenLastCalledWith('sign_psbt', {
      network: 'mainnet',
      psbt: 'base64-mainnet',
    });

    sendRpcSpy.mockRejectedValueOnce(new Error('user_cancelled'));
    await expect(adapter.signPSBT({ psbt: 'x', inputPaths: [] })).rejects.toThrow('Transaction rejected on device');

    sendRpcSpy.mockRejectedValueOnce(new Error('device busy'));
    await expect(adapter.signPSBT({ psbt: 'x', inputPaths: [] })).rejects.toThrow('Jade is busy');

    sendRpcSpy.mockRejectedValueOnce(new Error('unexpected fail'));
    await expect(adapter.signPSBT({ psbt: 'x', inputPaths: [] })).rejects.toThrow(
      'Failed to sign transaction: unexpected fail'
    );

    sendRpcSpy.mockRejectedValueOnce({ code: 'unknown-error' });
    await expect(adapter.signPSBT({ psbt: 'x', inputPaths: [] })).rejects.toThrow(
      'Failed to sign transaction: Unknown error'
    );
  });
});
