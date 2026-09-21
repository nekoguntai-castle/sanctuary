/**
 * HardwareWalletService connection ownership tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPost, mockValidatePsbtSigningRequest, mockCapabilityRow } = vi.hoisted(() => ({
  mockPost: vi.fn(),
  mockValidatePsbtSigningRequest: vi.fn(),
  mockCapabilityRow: vi.fn(),
}));

vi.mock('@sanctuary/shared/constants/hardwareWalletCapabilities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sanctuary/shared/constants/hardwareWalletCapabilities')>();
  return { ...actual, getHardwareWalletCapabilityRow: mockCapabilityRow };
});

vi.mock('../../src/services/hardwareWallet/psbtAccountBinding', () => ({
  validatePsbtSigningRequest: mockValidatePsbtSigningRequest,
}));

vi.mock('../../src/utils/logger', () => ({
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

import { HardwareWalletService } from '../../src/services/hardwareWallet/service';
import type {
  DeviceAdapter,
  DeviceType,
  HardwareWalletDevice,
  PSBTSignResponse,
} from '../../src/services/hardwareWallet/types';
import { testPsbtSigningContext } from '../fixtures/psbtSigningContext';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createMockAdapter(
  type: DeviceType,
  overrides: Partial<DeviceAdapter> = {},
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
    getXpub: vi.fn(async (path: string) => ({
      xpub: `xpub-${type}`,
      fingerprint: 'abcd1234',
      path,
    })),
    signPSBT: vi.fn(async () => ({ psbt: `signed-${type}`, signatures: 1 })),
    verifyAddress: vi.fn(async () => true),
    getAuthorizedDevices: vi.fn(async () => [device]),
    ...overrides,
  };

  return { adapter, device };
}

describe('HardwareWalletService connection ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCapabilityRow.mockReturnValue({ enabled: true });
  });

  it('handles lazy adapter loader failures and surfaces missing adapter error', async () => {
    const service = new HardwareWalletService();
    const failingLoader = vi.fn(async () => {
      throw new Error('lazy load failed');
    });

    service.registerAdapterLoader('coldcard', failingLoader);

    await expect(service.connect('coldcard')).rejects.toThrow(
      'No adapter registered for device type: coldcard'
    );
    expect(failingLoader).toHaveBeenCalledTimes(1);
  });

  it('deduplicates a lazy adapter load while only the newest queued connect becomes approved', async () => {
    const service = new HardwareWalletService();
    const { adapter, device } = createMockAdapter('coldcard');
    let resolveLoader: ((value: DeviceAdapter) => void) | undefined;
    const loader = vi.fn(
      () =>
        new Promise<DeviceAdapter>((resolve) => {
          resolveLoader = resolve;
        })
    );

    service.registerAdapterLoader('coldcard', loader);

    const connectOne = service.connect('coldcard');
    const connectTwo = service.connect('coldcard');

    await flushPromises();
    expect(loader).toHaveBeenCalledTimes(1);
    resolveLoader?.(adapter);

    await expect(connectOne).rejects.toThrow(/superseded/i);
    await expect(connectTwo).resolves.toEqual(device);
    expect(adapter.connect).toHaveBeenCalledTimes(1);
  });

  it('serializes same-adapter connects and cleans stale A before B enters the adapter', async () => {
    const service = new HardwareWalletService();
    const firstConnect = deferred<HardwareWalletDevice>();
    const events: string[] = [];
    let transport = 'none';
    const { adapter, device } = createMockAdapter('coldcard', {
      connect: vi.fn(async () => {
        const call = vi.mocked(adapter.connect).mock.calls.length;
        events.push(`connect-${call}`);
        if (call === 1) {
          const connected = await firstConnect.promise;
          transport = 'A';
          return connected;
        }
        transport = 'B';
        return { ...device, id: 'coldcard-B' };
      }),
      disconnect: vi.fn(async () => {
        events.push(`disconnect-${transport}`);
        transport = 'none';
      }),
      getXpub: vi.fn(async (path: string) => ({
        xpub: `xpub-${transport}`,
        fingerprint: 'abcd1234',
        path,
      })),
      signPSBT: vi.fn(async () => ({ psbt: `signed-${transport}`, signatures: 1 })),
    });
    service.registerAdapter(adapter);

    const connectA = service.connectWithLease('coldcard');
    await flushPromises();
    const connectB = service.connectWithLease('coldcard');

    expect(adapter.connect).toHaveBeenCalledTimes(1);
    firstConnect.resolve(device);

    await expect(connectA).rejects.toThrow(/superseded/i);
    const ownedB = await connectB;
    expect(ownedB.device.id).toBe('coldcard-B');
    expect(events).toEqual(['connect-1', 'disconnect-A', 'connect-2']);
    await expect(service.getXpub("m/84'/0'/0'")).resolves.toMatchObject({ xpub: 'xpub-B' });
    await expect(service.signPSBT({ psbt: 'fixture' })).resolves.toMatchObject({
      psbt: 'signed-B',
    });
  });

  it.each([
    ['coldcard', 'bitbox'],
    ['bitbox', 'coldcard'],
  ] as const)(
    'serializes cross-adapter connects requested as %s then %s',
    async (firstType, secondType) => {
      const service = new HardwareWalletService();
      const firstConnect = deferred<HardwareWalletDevice>();
      const events: string[] = [];
      const first = createMockAdapter(firstType, {
        connect: vi.fn(async () => {
          events.push(`connect-${firstType}`);
          return firstConnect.promise;
        }),
        disconnect: vi.fn(async () => {
          events.push(`disconnect-${firstType}`);
        }),
      });
      const second = createMockAdapter(secondType, {
        connect: vi.fn(async () => {
          events.push(`connect-${secondType}`);
          return second.device;
        }),
      });
      service.registerAdapter(first.adapter);
      service.registerAdapter(second.adapter);

      const connectA = service.connectWithLease(firstType);
      await flushPromises();
      const connectB = service.connectWithLease(secondType);

      expect(second.adapter.connect).not.toHaveBeenCalled();
      firstConnect.resolve(first.device);
      await expect(connectA).rejects.toThrow(/superseded/i);
      await expect(connectB).resolves.toMatchObject({ device: second.device });
      expect(events).toEqual([
        `connect-${firstType}`,
        `disconnect-${firstType}`,
        `connect-${secondType}`,
      ]);
    },
  );

  it('cleans a failing stale connect before allowing the replacement into its adapter', async () => {
    const service = new HardwareWalletService();
    const firstConnect = deferred<HardwareWalletDevice>();
    const events: string[] = [];
    const { adapter, device } = createMockAdapter('coldcard', {
      connect: vi.fn(async () => {
        const call = vi.mocked(adapter.connect).mock.calls.length;
        events.push(`connect-${call}`);
        if (call === 1) return firstConnect.promise;
        return device;
      }),
      disconnect: vi.fn(async () => {
        events.push('disconnect');
      }),
    });
    service.registerAdapter(adapter);

    const connectA = service.connectWithLease('coldcard');
    await flushPromises();
    const connectB = service.connectWithLease('coldcard');
    firstConnect.reject(new Error('A transport failed'));

    await expect(connectA).rejects.toThrow('A transport failed');
    await expect(connectB).resolves.toMatchObject({ device });
    expect(events).toEqual(['connect-1', 'disconnect', 'connect-2']);
  });

  it('releases the exact leased connection and leaves no approved session', async () => {
    const service = new HardwareWalletService();
    const { adapter } = createMockAdapter('coldcard');
    service.registerAdapter(adapter);

    const owned = await service.connectWithLease('coldcard');
    await service.releaseConnection(owned.lease);

    expect(adapter.disconnect).toHaveBeenCalledTimes(1);
    expect(service.isConnected()).toBe(false);
    await expect(service.getXpub("m/84'/0'/0'")).rejects.toThrow('No device connected');
  });

  it('retries a failed leased release before the next connect enters the adapter', async () => {
    const service = new HardwareWalletService();
    let disconnectAttempts = 0;
    const { adapter, device } = createMockAdapter('coldcard', {
      disconnect: vi.fn(async () => {
        disconnectAttempts += 1;
        if (disconnectAttempts === 1) throw new Error('release cleanup failed');
      }),
    });
    service.registerAdapter(adapter);
    const ownedA = await service.connectWithLease('coldcard');

    await expect(service.releaseConnection(ownedA.lease)).rejects.toThrow(
      'release cleanup failed',
    );
    await expect(service.connectWithLease('coldcard')).resolves.toMatchObject({ device });

    expect(adapter.disconnect).toHaveBeenCalledTimes(2);
    expect(adapter.connect).toHaveBeenCalledTimes(2);
  });

  it('does not let a stale A release close the current B connection', async () => {
    const service = new HardwareWalletService();
    const first = createMockAdapter('coldcard');
    const second = createMockAdapter('bitbox');
    service.registerAdapter(first.adapter);
    service.registerAdapter(second.adapter);

    const ownedA = await service.connectWithLease('coldcard');
    const ownedB = await service.connectWithLease('bitbox');
    vi.mocked(second.adapter.disconnect).mockClear();

    await service.releaseConnection(ownedA.lease);

    expect(second.adapter.disconnect).not.toHaveBeenCalled();
    expect(service.getDevice()).toEqual(ownedB.device);
    await expect(service.getXpub("m/84'/0'/0'")).resolves.toMatchObject({
      xpub: 'xpub-bitbox',
    });
  });

  it('connects and switches adapters, disconnecting previous adapter', async () => {
    const service = new HardwareWalletService();
    const { adapter: ledger } = createMockAdapter('coldcard');
    const { adapter: trezor } = createMockAdapter('bitbox');
    service.registerAdapter(ledger);
    service.registerAdapter(trezor);

    await service.connect('coldcard');
    expect(ledger.connect).toHaveBeenCalled();

    await service.connect('bitbox');
    expect(ledger.disconnect).toHaveBeenCalled();
    expect(trezor.connect).toHaveBeenCalled();
  });

  it('does not enter superseded A after newer B arrives during previous-session cleanup', async () => {
    const service = new HardwareWalletService();
    const cleanup = deferred<void>();
    const current = createMockAdapter('coldcard', {
      disconnect: vi.fn(() => cleanup.promise),
    });
    const superseded = createMockAdapter('bitbox');
    const replacement = createMockAdapter('jade');
    service.registerAdapter(current.adapter);
    service.registerAdapter(superseded.adapter);
    service.registerAdapter(replacement.adapter);
    await service.connect('coldcard');

    const connectA = service.connectWithLease('bitbox');
    await flushPromises();
    expect(current.adapter.disconnect).toHaveBeenCalledTimes(1);
    const connectB = service.connectWithLease('jade');
    cleanup.resolve();

    await expect(connectA).rejects.toThrow(/superseded/i);
    await expect(connectB).resolves.toMatchObject({ device: replacement.device });
    expect(superseded.adapter.connect).not.toHaveBeenCalled();
    expect(replacement.adapter.connect).toHaveBeenCalledTimes(1);
  });

  it('aborts the replacement when the previous adapter cannot be disconnected', async () => {
    const service = new HardwareWalletService();
    const { adapter: ledger } = createMockAdapter('coldcard', {
      disconnect: vi.fn(async () => {
        throw new Error('disconnect failed');
      }),
    });
    const { adapter: trezor } = createMockAdapter('bitbox');
    service.registerAdapter(ledger);
    service.registerAdapter(trezor);

    await service.connect('coldcard');
    await expect(service.connect('bitbox')).rejects.toThrow('disconnect failed');
    expect(trezor.connect).not.toHaveBeenCalled();
  });

  it('retries stale A cleanup before queued B enters the adapter', async () => {
    const service = new HardwareWalletService();
    const firstConnect = deferred<HardwareWalletDevice>();
    let cleanupAttempts = 0;
    const { adapter, device } = createMockAdapter('coldcard', {
      connect: vi.fn(async () => {
        if (vi.mocked(adapter.connect).mock.calls.length === 1) return firstConnect.promise;
        return device;
      }),
      disconnect: vi.fn(async () => {
        cleanupAttempts += 1;
        if (cleanupAttempts === 1) throw new Error('stale transport remained open');
      }),
    });
    service.registerAdapter(adapter);

    const connectA = service.connectWithLease('coldcard');
    await flushPromises();
    const connectB = service.connectWithLease('coldcard');
    firstConnect.resolve(device);

    await expect(connectA).rejects.toThrow(/superseded/i);
    await expect(connectB).resolves.toMatchObject({ device });
    expect(adapter.connect).toHaveBeenCalledTimes(2);
  });

  it('keeps a leased xpub batch exclusive from an external replacement connect', async () => {
    const service = new HardwareWalletService();
    const firstXpub = deferred<{
      xpub: string;
      fingerprint: string;
      path: string;
    }>();
    const first = createMockAdapter('coldcard', {
      getXpub: vi.fn(async (path: string) => {
        if (vi.mocked(first.adapter.getXpub).mock.calls.length === 1) return firstXpub.promise;
        return { xpub: 'xpub-A', fingerprint: 'abcd1234', path };
      }),
    });
    const second = createMockAdapter('bitbox');
    service.registerAdapter(first.adapter);
    service.registerAdapter(second.adapter);
    const ownedA = await service.connectWithLease('coldcard');

    const batchA = service.getAllXpubsWithFailuresForLease(ownedA.lease);
    await flushPromises();
    const connectB = service.connectWithLease('bitbox');
    expect(second.adapter.connect).not.toHaveBeenCalled();
    firstXpub.resolve({
      xpub: 'xpub-A',
      fingerprint: 'abcd1234',
      path: HardwareWalletService.STANDARD_PATHS[0].path,
    });

    await expect(batchA).rejects.toThrow(/lease was superseded/i);
    await expect(connectB).resolves.toMatchObject({ device: second.device });
    await expect(
      service.getAllXpubsWithFailuresForLease(ownedA.lease),
    ).rejects.toThrow(/lease is no longer active/i);
    expect(first.adapter.getXpub).toHaveBeenCalledTimes(1);
  });

  it.each(['xpub', 'sign', 'verify'] as const)(
    'fences a deferred compatibility %s result before a replacement connect',
    async (operation) => {
      const service = new HardwareWalletService();
      const xpub = deferred<{ xpub: string; fingerprint: string; path: string }>();
      const signature = deferred<PSBTSignResponse>();
      const verification = deferred<boolean>();
      const first = createMockAdapter('coldcard', {
        getXpub: vi.fn(() => xpub.promise),
        signPSBT: vi.fn(() => signature.promise),
        verifyAddress: vi.fn(() => verification.promise),
      });
      const second = createMockAdapter('bitbox');
      service.registerAdapter(first.adapter);
      service.registerAdapter(second.adapter);
      await service.connect('coldcard');

      let operationPromise: Promise<unknown>;
      let expected: unknown;
      let resolveOperation: () => void;
      if (operation === 'xpub') {
        const path = "m/84'/0'/0'";
        operationPromise = service.getXpub(path);
        expected = { xpub: 'xpub-A', fingerprint: 'abcd1234', path };
        resolveOperation = () => {
          xpub.resolve(expected as { xpub: string; fingerprint: string; path: string });
        };
      } else if (operation === 'sign') {
        operationPromise = service.signPSBT({ psbt: 'fixture' });
        expected = { psbt: 'signed-A', signatures: 1 };
        resolveOperation = () => signature.resolve(expected as PSBTSignResponse);
      } else {
        operationPromise = service.verifyAddress("m/84'/0'/0'/0/0", 'bc1qfixture');
        expected = true;
        resolveOperation = () => verification.resolve(true);
      }

      await flushPromises();
      const connectB = service.connectWithLease('bitbox');
      expect(second.adapter.connect).not.toHaveBeenCalled();
      resolveOperation();
      await expect(operationPromise).rejects.toThrow(/lease was superseded/i);
      await expect(connectB).resolves.toMatchObject({ device: second.device });
    },
  );

  it('stops a superseded signing flow before broadcast and then connects the replacement', async () => {
    const service = new HardwareWalletService();
    const signature = deferred<PSBTSignResponse>();
    const first = createMockAdapter('coldcard', {
      signPSBT: vi.fn(() => signature.promise),
    });
    const second = createMockAdapter('bitbox');
    service.registerAdapter(first.adapter);
    service.registerAdapter(second.adapter);
    await service.connect('coldcard');
    mockPost.mockResolvedValueOnce({
      psbt: 'unsigned-psbt',
      signingContext: { ...testPsbtSigningContext, walletId: 'w-exclusive' },
      intentId: 'intent-exclusive',
      intentDigest: 'd'.repeat(64),
    });

    const signing = service.signTransaction({
      walletId: 'w-exclusive',
      recipient: 'bc1qdest',
      amount: 1000,
      feeRate: 1,
    });
    await flushPromises();
    const connectB = service.connectWithLease('bitbox');
    expect(second.adapter.connect).not.toHaveBeenCalled();
    signature.resolve({ psbt: 'signed-exclusive', signatures: 1 });

    await expect(signing).rejects.toThrow(/lease was superseded/i);
    await expect(connectB).resolves.toMatchObject({ device: second.device });
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('stops a disconnected signing flow after PSBT creation and before hardware signing', async () => {
    const service = new HardwareWalletService();
    const createResponse = deferred<{
      psbt: string;
      signingContext: typeof testPsbtSigningContext;
      intentId: string;
      intentDigest: string;
    }>();
    const { adapter } = createMockAdapter('coldcard');
    service.registerAdapter(adapter);
    await service.connect('coldcard');
    mockPost.mockImplementationOnce(() => createResponse.promise);

    const signing = service.signTransaction({
      walletId: 'w-disconnect',
      recipient: 'bc1qdest',
      amount: 1000,
      feeRate: 1,
    });
    await flushPromises();
    const disconnect = service.disconnect();
    createResponse.resolve({
      psbt: 'unsigned-psbt',
      signingContext: { ...testPsbtSigningContext, walletId: 'w-disconnect' },
      intentId: 'intent-disconnect',
      intentDigest: 'e'.repeat(64),
    });

    await expect(signing).rejects.toThrow(/lease was superseded/i);
    await expect(disconnect).resolves.toBeUndefined();
    expect(adapter.signPSBT).not.toHaveBeenCalled();
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it.each(['create', 'sign'] as const)(
    'an exact lease release stops a deferred %s stage before the next funds boundary',
    async (stage) => {
      const service = new HardwareWalletService();
      const createResponse = deferred<{
        psbt: string;
        signingContext: typeof testPsbtSigningContext;
        intentId: string;
        intentDigest: string;
      }>();
      const signature = deferred<PSBTSignResponse>();
      const { adapter } = createMockAdapter('coldcard', {
        signPSBT: vi.fn(() => signature.promise),
      });
      service.registerAdapter(adapter);
      const owned = await service.connectWithLease('coldcard');
      const psbtResponse = {
        psbt: 'unsigned-release-psbt',
        signingContext: { ...testPsbtSigningContext, walletId: 'w-release' },
        intentId: 'intent-release',
        intentDigest: 'f'.repeat(64),
      };
      if (stage === 'create') {
        mockPost.mockImplementationOnce(() => createResponse.promise);
      } else {
        mockPost.mockResolvedValueOnce(psbtResponse);
      }

      const signing = service.signTransactionForLease(owned.lease, {
        walletId: 'w-release',
        recipient: 'bc1qdest',
        amount: 1000,
        feeRate: 1,
      });
      if (stage === 'sign') {
        await vi.waitFor(() => expect(adapter.signPSBT).toHaveBeenCalledTimes(1));
      } else {
        await flushPromises();
      }
      const release = service.releaseConnection(owned.lease);
      if (stage === 'create') createResponse.resolve(psbtResponse);
      else signature.resolve({ psbt: 'signed-release', signatures: 1 });

      await expect(signing).rejects.toThrow(/lease was released/i);
      await expect(release).resolves.toBeUndefined();
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(adapter.signPSBT).toHaveBeenCalledTimes(stage === 'create' ? 0 : 1);
    },
  );

  it('disconnects active adapter and clears active state', async () => {
    const service = new HardwareWalletService();
    const { adapter } = createMockAdapter('coldcard');
    service.registerAdapter(adapter);
    await service.connect('coldcard');

    await service.disconnect();
    expect(adapter.disconnect).toHaveBeenCalled();
    expect(service.isConnected()).toBe(false);
  });

  it('disconnect is a no-op when there is no active adapter', async () => {
    const service = new HardwareWalletService();
    await expect(service.disconnect()).resolves.toBeUndefined();
  });

  it('tolerates a queued lease release clearing ownership before disconnect runs', async () => {
    const service = new HardwareWalletService();
    const { adapter } = createMockAdapter('coldcard');
    service.registerAdapter(adapter);
    const owned = await service.connectWithLease('coldcard');

    const release = service.releaseConnection(owned.lease);
    const disconnect = service.disconnect();

    await expect(Promise.all([release, disconnect])).resolves.toEqual([undefined, undefined]);
    expect(adapter.disconnect).toHaveBeenCalledTimes(1);
  });

  it('cancels a connect() that resolves after a concurrent disconnect() and disconnects the adapter', async () => {
    const service = new HardwareWalletService();
    let resolveConnect: ((value: HardwareWalletDevice) => void) | undefined;
    const { adapter, device } = createMockAdapter('coldcard', {
      connect: vi.fn(
        () =>
          new Promise<HardwareWalletDevice>((resolve) => {
            resolveConnect = resolve;
          })
      ),
    });
    service.registerAdapter(adapter);

    const connectPromise = service.connect('coldcard');
    await flushPromises();
    const disconnectPromise = service.disconnect();
    await expect(disconnectPromise).resolves.toBeUndefined();
    resolveConnect?.(device);

    await expect(connectPromise).rejects.toThrow(/superseded/i);
    expect(service.isConnected()).toBe(false);
    expect(adapter.disconnect).toHaveBeenCalledTimes(1);
  });

});
