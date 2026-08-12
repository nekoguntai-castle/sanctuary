import { beforeEach,describe,expect,it,vi } from 'vitest';

const capabilityState = vi.hoisted(() => ({ enabled: false }));

vi.mock('@sanctuary/shared/constants/hardwareWalletCapabilities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sanctuary/shared/constants/hardwareWalletCapabilities')>();
  return {
    ...actual,
    getHardwareWalletCapabilityRow: () => ({
      enabled: capabilityState.enabled,
      reason: capabilityState.enabled ? 'verified fixture' : 'unverified fixture',
    }),
  };
});

const makeMockAdapterClass = (type: 'ledger' | 'trezor' | 'bitbox' | 'jade') => {
  return class {
    readonly type = type;
    readonly displayName = `${type}-mock`;
    private connected = false;

    isSupported() {
      return true;
    }

    isConnected() {
      return this.connected;
    }

    getDevice() {
      if (!this.connected) return null;
      return {
        id: `${type}-1`,
        type,
        name: `${type}-device`,
        connected: true,
        fingerprint: 'f1f1f1f1',
      };
    }

    async connect() {
      this.connected = true;
      return {
        id: `${type}-1`,
        type,
        name: `${type}-device`,
        connected: true,
        fingerprint: 'f1f1f1f1',
      };
    }

    async disconnect() {
      this.connected = false;
    }

    async getXpub(path: string) {
      return { xpub: `${type}-xpub`, fingerprint: 'f1f1f1f1', path };
    }

    async signPSBT() {
      return { psbt: `${type}-signed`, signatures: 1 };
    }

    async getAuthorizedDevices() {
      return [
        {
          id: `${type}-authorized`,
          type,
          name: `${type}-device`,
          connected: false,
        },
      ];
    }
  };
};

vi.mock('../../src/services/hardwareWallet/adapters/ledger', () => ({
  LedgerAdapter: makeMockAdapterClass('ledger'),
}));

vi.mock('../../src/services/hardwareWallet/adapters/trezor', () => ({
  TrezorAdapter: makeMockAdapterClass('trezor'),
}));

vi.mock('../../src/services/hardwareWallet/adapters/bitbox', () => ({
  BitBoxAdapter: makeMockAdapterClass('bitbox'),
}));

vi.mock('../../src/services/hardwareWallet/adapters/jade', () => ({
  JadeAdapter: makeMockAdapterClass('jade'),
}));

describe('hardwareWallet runtime', () => {
  beforeEach(() => {
    capabilityState.enabled = false;
  });

  it('blocks every unverified adapter before lazy loading', async () => {
    // Other hardware-wallet tests mock this singleton. Import a fresh runtime
    // here so sharded coverage cannot inherit an adapter registry populated by
    // a previous test file and skip the lazy-loader callbacks.
    vi.resetModules();
    const { getConnectedDevices,hardwareWalletService } = await import(
      '../../src/services/hardwareWallet/runtime'
    );

    await expect(hardwareWalletService.connect('ledger')).rejects.toThrow('temporarily unavailable');
    await expect(hardwareWalletService.connect('trezor')).rejects.toThrow('temporarily unavailable');
    await expect(hardwareWalletService.connect('bitbox')).rejects.toThrow('temporarily unavailable');
    await expect(hardwareWalletService.connect('jade')).rejects.toThrow('temporarily unavailable');

    const devices = await getConnectedDevices();
    const deviceTypes = devices.map((device) => device.type).sort();
    expect(deviceTypes).toEqual([]);
    await hardwareWalletService.disconnect();
  });

  it('lazy-loads an adapter only after its capability is enabled', async () => {
    capabilityState.enabled = true;
    vi.resetModules();
    const { hardwareWalletService } = await import('../../src/services/hardwareWallet/runtime');

    await expect(hardwareWalletService.connect('bitbox')).resolves.toMatchObject({
      type: 'bitbox',
      fingerprint: 'f1f1f1f1',
    });

    await hardwareWalletService.disconnect();
  });
});
