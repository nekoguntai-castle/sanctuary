import { describe, expect, it, vi, beforeEach } from 'vitest';

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
      };
    }

    async connect() {
      this.connected = true;
      return {
        id: `${type}-1`,
        type,
        name: `${type}-device`,
        connected: true,
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

vi.mock('../../services/hardwareWallet/adapters/ledger', () => ({
  LedgerAdapter: makeMockAdapterClass('ledger'),
}));

vi.mock('../../services/hardwareWallet/adapters/trezor', () => ({
  TrezorAdapter: makeMockAdapterClass('trezor'),
}));

vi.mock('../../services/hardwareWallet/adapters/bitbox', () => ({
  BitBoxAdapter: makeMockAdapterClass('bitbox'),
}));

vi.mock('../../services/hardwareWallet/adapters/jade', () => ({
  JadeAdapter: makeMockAdapterClass('jade'),
}));

import { hardwareWalletService, getConnectedDevices } from '../../services/hardwareWallet/runtime';

describe('hardwareWallet runtime', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await hardwareWalletService.disconnect();
  });

  it('lazy-loads each adapter type and exposes connected devices helper', async () => {
    await expect(hardwareWalletService.connect('ledger')).resolves.toMatchObject({ type: 'ledger' });
    await expect(hardwareWalletService.connect('trezor')).resolves.toMatchObject({ type: 'trezor' });
    await expect(hardwareWalletService.connect('bitbox')).resolves.toMatchObject({ type: 'bitbox' });
    await expect(hardwareWalletService.connect('jade')).resolves.toMatchObject({ type: 'jade' });

    const devices = await getConnectedDevices();
    const deviceTypes = devices.map((device) => device.type).sort();
    expect(deviceTypes).toEqual(['bitbox', 'jade', 'ledger', 'trezor']);
  });
});
