/**
 * HardwareWalletService tests
 *
 * Uses mock adapters to exercise service routing/branch behavior
 * without requiring real hardware or browser USB APIs.
 */

import { beforeEach,describe,expect,it,vi } from 'vitest';

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

import {
  HardwareWalletService,
  createHardwareWalletService,
} from '../../src/services/hardwareWallet/service';
import type {
  DeviceAdapter,
  DeviceType,
  HardwareWalletDevice,
} from '../../src/services/hardwareWallet/types';
import { testPsbtSigningContext } from '../fixtures/psbtSigningContext';

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

describe('HardwareWalletService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCapabilityRow.mockReturnValue({ enabled: true });
  });

  it.each(['ledger', 'jade', 'trezor'] as const)(
    'blocks %s before loading or connecting an adapter',
    async (type) => {
      mockCapabilityRow.mockReturnValue({ enabled: false, reason: 'unverified' });
      const service = new HardwareWalletService();
      const { adapter } = createMockAdapter(type);
      service.registerAdapter(adapter);

      await expect(service.connect(type)).rejects.toThrow(
        'Hardware wallet connection is temporarily unavailable'
      );
      expect(adapter.connect).not.toHaveBeenCalled();
    }
  );

  it('fails closed with a generic reason when no capability row matches', async () => {
    mockCapabilityRow.mockReturnValue(null);
    const service = new HardwareWalletService();

    await expect(service.connect('unknown')).rejects.toThrow(
      'No reviewed capability row matches this device identity.',
    );
  });

  it('rejects and disconnects an adapter that connects without a master fingerprint', async () => {
    const service = new HardwareWalletService();
    const { adapter, device } = createMockAdapter('coldcard');
    vi.mocked(adapter.connect).mockResolvedValueOnce({
      ...device,
      fingerprint: undefined,
    });
    service.registerAdapter(adapter);

    await expect(service.connect('coldcard')).rejects.toThrow(/master fingerprint/i);
    expect(adapter.disconnect).toHaveBeenCalled();
    expect(service.isConnected()).toBe(false);
  });

  it('preserves the identity failure when cleanup disconnect also fails', async () => {
    const service = new HardwareWalletService();
    const { adapter, device } = createMockAdapter('coldcard', {
      disconnect: vi.fn(async () => {
        throw new Error('cleanup failed');
      }),
    });
    vi.mocked(adapter.connect).mockResolvedValueOnce({
      ...device,
      fingerprint: '00000000',
    });
    service.registerAdapter(adapter);

    await expect(service.connect('coldcard')).rejects.toThrow(/master fingerprint/i);
    expect(adapter.disconnect).toHaveBeenCalledTimes(1);
    expect(service.getDevice()).toBeNull();
  });

  it('does not retain a stale active adapter after a failed reconnect', async () => {
    const service = new HardwareWalletService();
    const { adapter } = createMockAdapter('coldcard');
    service.registerAdapter(adapter);
    await service.connect('coldcard');
    vi.mocked(adapter.connect).mockRejectedValueOnce(new Error('reconnect failed'));

    await expect(service.connect('coldcard')).rejects.toThrow('reconnect failed');
    expect(service.getDevice()).toBeNull();
    await expect(service.getXpub("m/84'/0'/0'")).rejects.toThrow('No device connected');
  });

  it.each(['ledger', 'jade', 'trezor'] as const)(
    'rechecks every funds-controlling %s operation for an in-flight connection',
    async (type) => {
      mockCapabilityRow.mockReturnValue({ enabled: false, reason: 'unverified' });
      const service = new HardwareWalletService();
      const { adapter } = createMockAdapter(type);
      (service as unknown as { activeAdapter: DeviceAdapter }).activeAdapter = adapter;

      await expect(service.getXpub("m/84'/0'/0'")).rejects.toThrow('temporarily unavailable');
      await expect(service.getAllXpubs()).rejects.toThrow('temporarily unavailable');
      await expect(service.signPSBT({ psbt: 'psbt', inputPaths: [] })).rejects.toThrow(
        'temporarily unavailable'
      );
      await expect(service.verifyAddress("m/84'/0'/0'/0/0", 'bc1qtest')).rejects.toThrow(
        'temporarily unavailable'
      );

      expect(adapter.getXpub).not.toHaveBeenCalled();
      expect(adapter.signPSBT).not.toHaveBeenCalled();
      expect(adapter.verifyAddress).not.toHaveBeenCalled();
    }
  );

  it('registers adapters and exposes adapter lookups', () => {
    const service = new HardwareWalletService();
    const { adapter: ledger } = createMockAdapter('coldcard');
    const { adapter: trezor } = createMockAdapter('bitbox');

    service.registerAdapter(ledger);
    service.registerAdapter(trezor);

    expect(service.getRegisteredAdapters()).toHaveLength(2);
    expect(service.getAdapter('coldcard')).toBe(ledger);
    expect(service.getAdapter('bitbox')).toBe(trezor);
  });

  it('checks support by type and across all adapters', () => {
    const service = new HardwareWalletService();
    const { adapter: supported } = createMockAdapter('coldcard', {
      isSupported: vi.fn(() => true),
    });
    const { adapter: unsupported } = createMockAdapter('bitbox', {
      isSupported: vi.fn(() => false),
    });
    service.registerAdapter(supported);
    service.registerAdapter(unsupported);

    expect(service.isSupported('coldcard')).toBe(true);
    expect(service.isSupported('bitbox')).toBe(false);
    expect(service.isSupported('passport')).toBe(false);
    expect(service.isSupported()).toBe(true);
  });

  it('returns false/null for connection state when no active adapter', () => {
    const service = new HardwareWalletService();
    expect(service.isConnected()).toBe(false);
    expect(service.getDevice()).toBeNull();
  });

  it('aggregates authorized devices and skips adapter failures', async () => {
    const service = new HardwareWalletService();
    const { adapter: okAdapter, device } = createMockAdapter('coldcard');
    const { adapter: badAdapter } = createMockAdapter('bitbox', {
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
    const { adapter, device } = createMockAdapter('coldcard');
    const { adapter: noListAdapter } = createMockAdapter('bitbox');
    noListAdapter.getAuthorizedDevices = undefined;
    service.registerAdapter(adapter);
    service.registerAdapter(noListAdapter);

    const devices = await service.getDevices();
    expect(devices).toEqual([device]);
  });

  it('throws when connect() has no type and multiple adapters', async () => {
    const service = new HardwareWalletService();
    service.registerAdapter(createMockAdapter('coldcard').adapter);
    service.registerAdapter(createMockAdapter('bitbox').adapter);

    await expect(service.connect()).rejects.toThrow('Device type must be specified');
  });

  it('connects to the only registered adapter when no type is provided', async () => {
    const service = new HardwareWalletService();
    const { adapter, device } = createMockAdapter('coldcard');
    service.registerAdapter(adapter);

    await expect(service.connect()).resolves.toEqual(device);
    expect(adapter.connect).toHaveBeenCalledTimes(1);
  });

  it('passes the selected chain and model binding to the adapter unchanged', async () => {
    const service = new HardwareWalletService();
    const { adapter, device } = createMockAdapter('coldcard');
    const options = { chainEnvironment: 'signet' as const, expectedModel: 'fixture-model' };
    service.registerAdapter(adapter);

    await expect(service.connect('coldcard', options)).resolves.toEqual(device);
    expect(adapter.connect).toHaveBeenCalledWith(options);
  });

  it('throws when connecting to missing or unsupported adapter', async () => {
    const service = new HardwareWalletService();
    await expect(service.connect('coldcard')).rejects.toThrow(
      'No adapter registered for device type: coldcard'
    );

    const { adapter } = createMockAdapter('coldcard', {
      isSupported: vi.fn(() => false),
    });
    service.registerAdapter(adapter);
    await expect(service.connect('coldcard')).rejects.toThrow(
      'is not supported in this environment'
    );
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

  it('reuses in-flight lazy adapter load for concurrent connects', async () => {
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

    expect(loader).toHaveBeenCalledTimes(1);
    resolveLoader?.(adapter);

    await expect(connectOne).resolves.toEqual(device);
    await expect(connectTwo).resolves.toEqual(device);
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

  it('continues connecting even if previous disconnect fails', async () => {
    const service = new HardwareWalletService();
    const { adapter: ledger } = createMockAdapter('coldcard', {
      disconnect: vi.fn(async () => {
        throw new Error('disconnect failed');
      }),
    });
    const { adapter: trezor, device: trezorDevice } = createMockAdapter('bitbox');
    service.registerAdapter(ledger);
    service.registerAdapter(trezor);

    await service.connect('coldcard');
    await expect(service.connect('bitbox')).resolves.toEqual(trezorDevice);
    expect(trezor.connect).toHaveBeenCalled();
  });

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

  it('requires a connected device for xpub/sign/verify operations', async () => {
    const service = new HardwareWalletService();
    await expect(service.getXpub("m/84'/0'/0'")).rejects.toThrow('No device connected');
    await expect(service.signPSBT({ psbt: 'psbt', inputPaths: [] })).rejects.toThrow(
      'No device connected'
    );
    await expect(service.verifyAddress("m/84'/0'/0'/0/0", 'bc1q...')).rejects.toThrow(
      'No device connected'
    );
  });

  it('rejects adapter evidence that contains no applicable signed transaction state', async () => {
    const service = new HardwareWalletService();
    const { adapter } = createMockAdapter('coldcard', {
      signPSBT: vi.fn(async () => ({
        signatures: 1,
        trezorArtifact: {
          type: 'trezor-connect-transaction' as const,
          sourcePsbt: 'unsigned-psbt',
          connectSignatures: ['300102'],
          serializedTx: 'raw-tx',
        },
      })),
    });
    service.registerAdapter(adapter);
    await service.connect('coldcard');

    await expect(
      service.signPSBT({
        psbt: 'unsigned-psbt',
        signingContext: testPsbtSigningContext,
      })
    ).rejects.toThrow('did not produce an applicable signed PSBT or transaction');
  });

  it('requires an applied PSBT for a multisig adapter response', async () => {
    const service = new HardwareWalletService();
    const { adapter } = createMockAdapter('coldcard', {
      signPSBT: vi.fn(async () => ({ signatures: 1, rawTx: 'raw-tx' })),
    });
    service.registerAdapter(adapter);
    await service.connect('coldcard');
    const multisigContext = {
      ...testPsbtSigningContext,
      walletType: 'multi_sig' as const,
      scriptType: 'native_segwit' as const,
    };

    await expect(
      service.signPSBT({
        psbt: 'unsigned-psbt',
        signingContext: multisigContext,
      })
    ).rejects.toThrow('Multisig hardware signing did not produce an applicable signed PSBT');
  });

  it('delegates getXpub to active adapter when connected', async () => {
    const service = new HardwareWalletService();
    const { adapter } = createMockAdapter('coldcard');
    service.registerAdapter(adapter);
    await service.connect('coldcard');

    const result = await service.getXpub("m/84'/0'/0'");
    expect(result).toEqual({
      xpub: 'xpub-coldcard',
      fingerprint: 'abcd1234',
      path: "m/84'/0'/0'",
    });
    expect(adapter.getXpub).toHaveBeenCalledWith("m/84'/0'/0'");
  });

  it('throws verifyAddress error when adapter does not support verification', async () => {
    const service = new HardwareWalletService();
    const { adapter } = createMockAdapter('coldcard');
    adapter.verifyAddress = undefined;
    service.registerAdapter(adapter);
    await service.connect('coldcard');

    await expect(service.verifyAddress("m/84'/0'/0'/0/0", 'bc1q...')).rejects.toThrow(
      'does not support address verification'
    );
  });

  it('delegates verifyAddress when adapter supports verification', async () => {
    const service = new HardwareWalletService();
    const { adapter } = createMockAdapter('coldcard', {
      verifyAddress: vi.fn(async () => true),
    });
    service.registerAdapter(adapter);
    await service.connect('coldcard');

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
    const { adapter } = createMockAdapter('coldcard', {
      getXpub: vi.fn(async (path: string) => {
        if (path === "m/49'/0'/0'") {
          throw new Error('path unsupported');
        }
        return { xpub: `xpub-${path}`, fingerprint: 'abcd1234', path };
      }),
    });
    service.registerAdapter(adapter);
    await service.connect('coldcard');

    const results = await service.getAllXpubs(progress);

    expect(progress).toHaveBeenCalledTimes(HardwareWalletService.STANDARD_PATHS.length);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.xpub.startsWith('xpub-'))).toBe(true);
  });

  it('returns skipped xpub path failures with partial batch results', async () => {
    const service = new HardwareWalletService();
    const { adapter } = createMockAdapter('coldcard', {
      getXpub: vi.fn(async (path: string) => {
        if (path.includes("/1'/")) {
          throw new Error('Bitcoin Test app not open');
        }
        return { xpub: `xpub-${path}`, fingerprint: 'abcd1234', path };
      }),
    });
    service.registerAdapter(adapter);
    await service.connect('coldcard');

    const batch = await service.getAllXpubsWithFailures();

    expect(batch.results).toHaveLength(6);
    expect(batch.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "m/84'/1'/0'",
          message: 'Bitcoin Test app not open',
        }),
      ])
    );
    expect(batch.totalPaths).toBe(HardwareWalletService.STANDARD_PATHS.length);
  });

  it('fetches all standard xpubs when every path succeeds', async () => {
    const service = new HardwareWalletService();
    const { adapter } = createMockAdapter('coldcard', {
      getXpub: vi.fn(async (path: string) => ({
        xpub: `xpub-${path}`,
        fingerprint: 'abcd1234',
        path,
      })),
    });
    service.registerAdapter(adapter);
    await service.connect('coldcard');

    const results = await service.getAllXpubs();

    expect(results).toHaveLength(HardwareWalletService.STANDARD_PATHS.length);
    expect(results.map((result) => result.path)).toEqual(
      HardwareWalletService.STANDARD_PATHS.map((standardPath) => standardPath.path)
    );
  });

  it.each([
    { fingerprint: '', label: 'missing' },
    { fingerprint: 'abcd123', label: 'short' },
    { fingerprint: 'not-hex!', label: 'non-hex' },
    { fingerprint: '00000000', label: 'zero' },
  ])(
    'rejects a $label master fingerprint without treating it as a skipped path',
    async ({ fingerprint }) => {
    const service = new HardwareWalletService();
    const { adapter } = createMockAdapter('coldcard', {
        getXpub: vi.fn(async (path: string) => ({
          xpub: `xpub-${path}`,
          fingerprint,
          path,
        })),
    });
    service.registerAdapter(adapter);
    await service.connect('coldcard');

    await expect(service.getAllXpubsWithFailures()).rejects.toThrow(/master fingerprint/i);
    }
  );

  it('rejects a changed master fingerprint before returning any partial batch', async () => {
    const service = new HardwareWalletService();
    let requestCount = 0;
    const { adapter } = createMockAdapter('coldcard', {
      getXpub: vi.fn(async (path: string) => ({
        xpub: `xpub-${path}`,
        fingerprint: requestCount++ === 0 ? 'abcd1234' : 'deadbeef',
        path,
      })),
    });
    service.registerAdapter(adapter);
    await service.connect('coldcard');

    await expect(service.getAllXpubsWithFailures()).rejects.toThrow(/fingerprint mismatch/i);
  });

  it('rejects an xpub response whose path does not exactly match the request', async () => {
    const service = new HardwareWalletService();
    const { adapter } = createMockAdapter('coldcard', {
      getXpub: vi.fn(async () => ({
        xpub: 'xpub-wrong-path',
        fingerprint: 'abcd1234',
        path: "m/84'/0'/1'",
      })),
    });
    service.registerAdapter(adapter);
    await service.connect('coldcard');

    await expect(service.getAllXpubsWithFailures()).rejects.toThrow(/path mismatch/i);
  });

  it('rejects an empty xpub response', async () => {
    const service = new HardwareWalletService();
    const { adapter } = createMockAdapter('coldcard', {
      getXpub: vi.fn(async (path: string) => ({
        xpub: '',
        fingerprint: 'abcd1234',
        path,
      })),
    });
    service.registerAdapter(adapter);
    await service.connect('coldcard');

    await expect(service.getAllXpubsWithFailures()).rejects.toThrow(/xpub/i);
  });

  it('includes testnet account paths in standard USB discovery', () => {
    expect(HardwareWalletService.STANDARD_PATHS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "m/84'/1'/0'",
          purpose: 'single_sig',
          scriptType: 'native_segwit',
          name: expect.stringContaining('Testnet'),
        }),
        expect.objectContaining({
          path: "m/48'/1'/0'/2'",
          purpose: 'multisig',
          scriptType: 'native_segwit',
          name: expect.stringContaining('Testnet'),
        }),
      ])
    );
  });

  it('derives exactly one mainnet and testnet-family discovery path per canonical policy', async () => {
    const { WALLET_POLICY_REGISTRY, parseCanonicalAccountPath } =
      await import('@sanctuary/shared/constants/walletPolicy');
    expect(HardwareWalletService.STANDARD_PATHS).toHaveLength(WALLET_POLICY_REGISTRY.length * 2);
    for (const standardPath of HardwareWalletService.STANDARD_PATHS) {
      const parsed = parseCanonicalAccountPath(standardPath.path);
      expect(parsed).not.toBeNull();
      expect(standardPath.purpose).toBe(parsed?.policy.accountPurpose);
      expect(standardPath.scriptType).toBe(parsed?.policy.scriptType);
      expect(parsed?.account).toBe(0);
    }
  });

  it('throws an actionable aggregated error if all standard xpub paths fail', async () => {
    const service = new HardwareWalletService();
    const { adapter } = createMockAdapter('coldcard', {
      getXpub: vi.fn(async (path: string) => {
        if (path === "m/86'/0'/0'") {
          throw new Error('taproot unsupported');
        }
        throw new Error('Bitcoin app not open on Ledger. Open the Bitcoin app and try again.');
      }),
    });
    service.registerAdapter(adapter);
    await service.connect('coldcard');

    await expect(service.getAllXpubs()).rejects.toThrow(
      /Failed to fetch any xpubs from device after trying 12\/12 standard account paths.*Most common error: Bitcoin app not open on Ledger.*Native SegWit/
    );
  });

  it('handles an empty standard path set defensively', async () => {
    const originalPaths = HardwareWalletService.STANDARD_PATHS;
    (HardwareWalletService as any).STANDARD_PATHS = [];

    try {
      const service = new HardwareWalletService();
      const { adapter } = createMockAdapter('coldcard');
      service.registerAdapter(adapter);
      await service.connect('coldcard');

      await expect(service.getAllXpubs()).rejects.toThrow(
        'Failed to fetch any xpubs from device after trying 0/0 standard account paths. Most common error: Unknown error.'
      );
    } finally {
      (HardwareWalletService as any).STANDARD_PATHS = originalPaths;
    }
  });

  it('normalizes string and unknown standard xpub failures in the aggregated error', async () => {
    const service = new HardwareWalletService();
    const { adapter } = createMockAdapter('coldcard', {
      getXpub: vi.fn(async (path: string) => {
        if (path === "m/84'/0'/0'") {
          throw 'usb session busy';
        }
        throw { code: 'opaque-failure' };
      }),
    });
    service.registerAdapter(adapter);
    await service.connect('coldcard');

    await expect(service.getAllXpubs()).rejects.toThrow(
      /Most common error: Unknown error.*Native SegWit/
    );
  });

  it('executes full signTransaction flow via backend and adapter', async () => {
    const service = new HardwareWalletService();
    const { adapter } = createMockAdapter('coldcard');
    service.registerAdapter(adapter);
    await service.connect('coldcard');

    const signingContext = { ...testPsbtSigningContext, walletId: 'w1' };
    mockPost
      .mockResolvedValueOnce({
        psbt: 'unsigned-psbt',
        fee: 500,
        signingContext,
        intentId: 'intent-1',
        intentDigest: 'a'.repeat(64),
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
    expect(mockPost).toHaveBeenNthCalledWith(
      1,
      '/wallets/w1/psbt/create',
      {
        recipients: [{ address: 'bc1qdest', amount: 25000 }],
        feeRate: 10,
        utxoIds: ['utxo-1'],
        changeAddress: 'bc1qchange',
      },
      expect.objectContaining({ schema: expect.anything() })
    );
    expect(adapter.signPSBT).toHaveBeenCalledWith({
      walletId: 'w1',
      psbt: 'unsigned-psbt',
      signingContext,
    });
    expect(mockPost).toHaveBeenNthCalledWith(2, '/wallets/w1/transactions/broadcast', {
      signedPsbtBase64: 'signed-coldcard',
      intentId: 'intent-1',
      intentDigest: 'a'.repeat(64),
    });
  });

  it('blocks raw-only hardware broadcast until adapter proof is available', async () => {
    const service = new HardwareWalletService();
    const { adapter } = createMockAdapter('bitbox', {
      signPSBT: vi.fn(async () => ({
        psbt: 'signed-trezor',
        signatures: 1,
        rawTx: '020000...',
      })),
    });
    service.registerAdapter(adapter);
    await service.connect('bitbox');

    mockPost
      .mockResolvedValueOnce({
        psbt: 'unsigned-psbt',
        fee: 300,
        inputPaths: [],
        signingContext: { ...testPsbtSigningContext, walletId: 'w2' },
        intentId: 'intent-2',
        intentDigest: 'b'.repeat(64),
      })
      .mockResolvedValueOnce({ txid: 'txid-raw' });

    await expect(
      service.signTransaction({
      walletId: 'w2',
      recipient: 'bc1qdest2',
      amount: 10000,
      feeRate: 5,
      })
    ).rejects.toThrow('Raw-only hardware broadcast is disabled');

    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('rejects a full signing flow when the adapter returns no signed PSBT', async () => {
    const service = new HardwareWalletService();
    const { adapter } = createMockAdapter('coldcard', {
      signPSBT: vi.fn(async () => ({ signatures: 1, rawTx: '020000...' })),
    });
    service.registerAdapter(adapter);
    await service.connect('coldcard');
    mockPost.mockResolvedValueOnce({
      psbt: 'unsigned-psbt',
      fee: 300,
      signingContext: { ...testPsbtSigningContext, walletId: 'w-no-psbt' },
      intentId: 'intent-no-psbt',
      intentDigest: 'c'.repeat(64),
    });

    await expect(
      service.signTransaction({
        walletId: 'w-no-psbt',
        recipient: 'bc1qdest3',
        amount: 9000,
        feeRate: 4,
      })
    ).rejects.toThrow('Hardware signer did not return a signed PSBT');
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('throws in signTransaction when no adapter is connected', async () => {
    const service = new HardwareWalletService();
    await expect(
      service.signTransaction({
      walletId: 'w1',
      recipient: 'bc1qdest',
      amount: 1000,
      feeRate: 1,
      })
    ).rejects.toThrow('No device connected');
  });

  it('creates an empty service with no registered adapters by default', () => {
    const service = createHardwareWalletService();
    expect(service.getRegisteredAdapters()).toHaveLength(0);
  });
});
