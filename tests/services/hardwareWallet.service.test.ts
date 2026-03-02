/**
 * HardwareWalletService tests
 *
 * Uses mock adapters to exercise service routing/branch behavior
 * without requiring real hardware or browser USB APIs.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPost = vi.fn();

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../src/api/client', () => ({
  default: {
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

import { HardwareWalletService, createHardwareWalletService } from '../../services/hardwareWallet/service';
import type { DeviceAdapter, DeviceType, HardwareWalletDevice } from '../../services/hardwareWallet/types';

function createMockAdapter(
  type: DeviceType,
  overrides: Partial<DeviceAdapter> = {}
): { adapter: DeviceAdapter; device: HardwareWalletDevice } {
  const device: HardwareWalletDevice = {
    id: `${type}-1`,
    type,
    name: `${type} device`,
    model: `${type}-model`,
    connected: true,
    fingerprint: 'abcd1234',
  };

  const adapter: DeviceAdapter = {
    type,
    displayName: `${type.toUpperCase()} Adapter`,
    isSupported: vi.fn(() => true),
    isConnected: vi.fn(() => true),
    getDevice: vi.fn(() => device),
    connect: vi.fn(async () => device),
    disconnect: vi.fn(async () => undefined),
    getXpub: vi.fn(async (path: string) => ({ xpub: `xpub-${type}`, fingerprint: 'f1f1f1f1', path })),
    signPSBT: vi.fn(async () => ({ psbt: `signed-${type}`, signatures: 1 })),
    verifyAddress: vi.fn(async () => true),
    getAuthorizedDevices: vi.fn(async () => [device]),
    ...overrides,
  };

  return { adapter, device };
}

describe('HardwareWalletService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers adapters and exposes adapter lookups', () => {
    const service = new HardwareWalletService();
    const { adapter: ledger } = createMockAdapter('ledger');
    const { adapter: trezor } = createMockAdapter('trezor');

    service.registerAdapter(ledger);
    service.registerAdapter(trezor);

    expect(service.getRegisteredAdapters()).toHaveLength(2);
    expect(service.getAdapter('ledger')).toBe(ledger);
    expect(service.getAdapter('trezor')).toBe(trezor);
  });

  it('checks support by type and across all adapters', () => {
    const service = new HardwareWalletService();
    const { adapter: supported } = createMockAdapter('ledger', { isSupported: vi.fn(() => true) });
    const { adapter: unsupported } = createMockAdapter('trezor', { isSupported: vi.fn(() => false) });
    service.registerAdapter(supported);
    service.registerAdapter(unsupported);

    expect(service.isSupported('ledger')).toBe(true);
    expect(service.isSupported('trezor')).toBe(false);
    expect(service.isSupported('coldcard')).toBe(false);
    expect(service.isSupported()).toBe(true);
  });

  it('returns false/null for connection state when no active adapter', () => {
    const service = new HardwareWalletService();
    expect(service.isConnected()).toBe(false);
    expect(service.getDevice()).toBeNull();
  });

  it('aggregates authorized devices and skips adapter failures', async () => {
    const service = new HardwareWalletService();
    const { adapter: okAdapter, device } = createMockAdapter('ledger');
    const { adapter: badAdapter } = createMockAdapter('trezor', {
      getAuthorizedDevices: vi.fn(async () => {
        throw new Error('device list error');
      }),
    });

    service.registerAdapter(okAdapter);
    service.registerAdapter(badAdapter);

    const devices = await service.getDevices();
    expect(devices).toEqual([device]);
  });

  it('skips adapters that do not implement getAuthorizedDevices', async () => {
    const service = new HardwareWalletService();
    const { adapter, device } = createMockAdapter('ledger');
    const { adapter: noListAdapter } = createMockAdapter('trezor');
    noListAdapter.getAuthorizedDevices = undefined;
    service.registerAdapter(adapter);
    service.registerAdapter(noListAdapter);

    const devices = await service.getDevices();
    expect(devices).toEqual([device]);
  });

  it('throws when connect() has no type and multiple adapters', async () => {
    const service = new HardwareWalletService();
    service.registerAdapter(createMockAdapter('ledger').adapter);
    service.registerAdapter(createMockAdapter('trezor').adapter);

    await expect(service.connect()).rejects.toThrow('Device type must be specified');
  });

  it('connects to the only registered adapter when no type is provided', async () => {
    const service = new HardwareWalletService();
    const { adapter, device } = createMockAdapter('ledger');
    service.registerAdapter(adapter);

    await expect(service.connect()).resolves.toEqual(device);
    expect(adapter.connect).toHaveBeenCalledTimes(1);
  });

  it('throws when connecting to missing or unsupported adapter', async () => {
    const service = new HardwareWalletService();
    await expect(service.connect('ledger')).rejects.toThrow('No adapter registered for device type: ledger');

    const { adapter } = createMockAdapter('ledger', { isSupported: vi.fn(() => false) });
    service.registerAdapter(adapter);
    await expect(service.connect('ledger')).rejects.toThrow('is not supported in this environment');
  });

  it('connects and switches adapters, disconnecting previous adapter', async () => {
    const service = new HardwareWalletService();
    const { adapter: ledger } = createMockAdapter('ledger');
    const { adapter: trezor } = createMockAdapter('trezor');
    service.registerAdapter(ledger);
    service.registerAdapter(trezor);

    await service.connect('ledger');
    expect(ledger.connect).toHaveBeenCalled();

    await service.connect('trezor');
    expect(ledger.disconnect).toHaveBeenCalled();
    expect(trezor.connect).toHaveBeenCalled();
  });

  it('continues connecting even if previous disconnect fails', async () => {
    const service = new HardwareWalletService();
    const { adapter: ledger } = createMockAdapter('ledger', {
      disconnect: vi.fn(async () => {
        throw new Error('disconnect failed');
      }),
    });
    const { adapter: trezor } = createMockAdapter('trezor');
    service.registerAdapter(ledger);
    service.registerAdapter(trezor);

    await service.connect('ledger');
    await expect(service.connect('trezor')).resolves.toBeTruthy();
    expect(trezor.connect).toHaveBeenCalled();
  });

  it('disconnects active adapter and clears active state', async () => {
    const service = new HardwareWalletService();
    const { adapter } = createMockAdapter('ledger');
    service.registerAdapter(adapter);
    await service.connect('ledger');

    await service.disconnect();
    expect(adapter.disconnect).toHaveBeenCalled();
    expect(service.isConnected()).toBe(false);
  });

  it('disconnect is a no-op when there is no active adapter', async () => {
    const service = new HardwareWalletService();
    await expect(service.disconnect()).resolves.toBeUndefined();
  });

  it('requires a connected device for xpub/sign/verify operations', async () => {
    const service = new HardwareWalletService();
    await expect(service.getXpub("m/84'/0'/0'")).rejects.toThrow('No device connected');
    await expect(service.signPSBT({ psbt: 'psbt', inputPaths: [] })).rejects.toThrow('No device connected');
    await expect(service.verifyAddress("m/84'/0'/0'/0/0", 'bc1q...')).rejects.toThrow('No device connected');
  });

  it('delegates getXpub to active adapter when connected', async () => {
    const service = new HardwareWalletService();
    const { adapter } = createMockAdapter('ledger');
    service.registerAdapter(adapter);
    await service.connect('ledger');

    const result = await service.getXpub("m/84'/0'/0'");
    expect(result).toEqual({
      xpub: 'xpub-ledger',
      fingerprint: 'f1f1f1f1',
      path: "m/84'/0'/0'",
    });
    expect(adapter.getXpub).toHaveBeenCalledWith("m/84'/0'/0'");
  });

  it('throws verifyAddress error when adapter does not support verification', async () => {
    const service = new HardwareWalletService();
    const { adapter } = createMockAdapter('ledger');
    adapter.verifyAddress = undefined;
    service.registerAdapter(adapter);
    await service.connect('ledger');

    await expect(service.verifyAddress("m/84'/0'/0'/0/0", 'bc1q...')).rejects.toThrow('does not support address verification');
  });

  it('delegates verifyAddress when adapter supports verification', async () => {
    const service = new HardwareWalletService();
    const { adapter } = createMockAdapter('ledger', {
      verifyAddress: vi.fn(async () => true),
    });
    service.registerAdapter(adapter);
    await service.connect('ledger');

    await expect(service.verifyAddress("m/84'/0'/0'/0/1", 'bc1qxyz')).resolves.toBe(true);
    expect(adapter.verifyAddress).toHaveBeenCalledWith("m/84'/0'/0'/0/1", 'bc1qxyz');
  });

  it('throws when getAllXpubs is called without a connected device', async () => {
    const service = new HardwareWalletService();
    await expect(service.getAllXpubs()).rejects.toThrow('No device connected');
  });

  it('fetches all xpubs with progress and skips unsupported paths', async () => {
    const service = new HardwareWalletService();
    const progress = vi.fn();
    const { adapter } = createMockAdapter('ledger', {
      getXpub: vi.fn(async (path: string) => {
        if (path === "m/49'/0'/0'") {
          throw new Error('path unsupported');
        }
        return { xpub: `xpub-${path}`, fingerprint: 'f1f1f1f1', path };
      }),
    });
    service.registerAdapter(adapter);
    await service.connect('ledger');

    const results = await service.getAllXpubs(progress);

    expect(progress).toHaveBeenCalledTimes(HardwareWalletService.STANDARD_PATHS.length);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.xpub.startsWith('xpub-'))).toBe(true);
  });

  it('throws if all standard xpub paths fail', async () => {
    const service = new HardwareWalletService();
    const { adapter } = createMockAdapter('ledger', {
      getXpub: vi.fn(async () => {
        throw new Error('all failed');
      }),
    });
    service.registerAdapter(adapter);
    await service.connect('ledger');

    await expect(service.getAllXpubs()).rejects.toThrow('Failed to fetch any xpubs from device');
  });

  it('executes full signTransaction flow via backend and adapter', async () => {
    const service = new HardwareWalletService();
    const { adapter } = createMockAdapter('ledger');
    service.registerAdapter(adapter);
    await service.connect('ledger');

    mockPost
      .mockResolvedValueOnce({
        psbt: 'unsigned-psbt',
        fee: 500,
        inputPaths: ["m/84'/0'/0'/0/0"],
      })
      .mockResolvedValueOnce({ txid: 'txid-123' });

    const txid = await service.signTransaction({
      walletId: 'w1',
      recipient: 'bc1qdest',
      amount: 25000,
      feeRate: 10,
      utxos: ['utxo-1'],
      changeAddress: 'bc1qchange',
    });

    expect(txid).toBe('txid-123');
    expect(mockPost).toHaveBeenNthCalledWith(1, '/wallets/w1/psbt/create', {
      recipients: [{ address: 'bc1qdest', amount: 25000 }],
      feeRate: 10,
      utxoIds: ['utxo-1'],
      changeAddress: 'bc1qchange',
    });
    expect(adapter.signPSBT).toHaveBeenCalledWith({
      psbt: 'unsigned-psbt',
      inputPaths: ["m/84'/0'/0'/0/0"],
    });
    expect(mockPost).toHaveBeenNthCalledWith(2, '/wallets/w1/psbt/broadcast', {
      signedPsbt: 'signed-ledger',
      rawTxHex: undefined,
    });
  });

  it('passes rawTx from adapter to broadcast step', async () => {
    const service = new HardwareWalletService();
    const { adapter } = createMockAdapter('trezor', {
      signPSBT: vi.fn(async () => ({ psbt: 'signed-trezor', signatures: 1, rawTx: '020000...' })),
    });
    service.registerAdapter(adapter);
    await service.connect('trezor');

    mockPost
      .mockResolvedValueOnce({ psbt: 'unsigned-psbt', fee: 300, inputPaths: [] })
      .mockResolvedValueOnce({ txid: 'txid-raw' });

    const txid = await service.signTransaction({
      walletId: 'w2',
      recipient: 'bc1qdest2',
      amount: 10000,
      feeRate: 5,
    });

    expect(txid).toBe('txid-raw');
    expect(mockPost).toHaveBeenNthCalledWith(2, '/wallets/w2/psbt/broadcast', {
      signedPsbt: 'signed-trezor',
      rawTxHex: '020000...',
    });
  });

  it('throws in signTransaction when no adapter is connected', async () => {
    const service = new HardwareWalletService();
    await expect(service.signTransaction({
      walletId: 'w1',
      recipient: 'bc1qdest',
      amount: 1000,
      feeRate: 1,
    })).rejects.toThrow('No device connected');
  });

  it('creates an empty service with no registered adapters by default', () => {
    const service = createHardwareWalletService();
    expect(service.getRegisteredAdapters()).toHaveLength(0);
  });
});
