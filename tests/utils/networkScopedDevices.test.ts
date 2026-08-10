import { describe, expect, it } from 'vitest';

import { filterDevicesByNetwork } from '../../src/utils/networkScopedDevices';

describe('networkScopedDevices', () => {
  it('keeps devices visible when derivation paths match the selected network even without matching wallet links', () => {
    const devices = [
      {
        id: 'device-mainnet-path',
        accounts: [{ derivationPath: "m/84'/0'/0'" }],
        wallets: [{ wallet: { network: 'testnet' } }],
        walletCount: 1,
      },
      {
        id: 'device-testnet-path',
        accounts: [{ derivationPath: "m/84'/1'/0'" }],
        wallets: [{ wallet: { network: 'testnet' } }],
        walletCount: 1,
      },
    ];

    expect(filterDevicesByNetwork(devices, 'mainnet')).toEqual([
      {
        id: 'device-mainnet-path',
        accounts: [{ derivationPath: "m/84'/0'/0'" }],
        wallets: [],
        walletCount: 0,
      },
    ]);
  });

  it('uses canonical legacy-device paths and excludes malformed path evidence', () => {
    const devices = [
      {
        id: 'legacy-mainnet',
        derivationPath: "m/49'/0'/0'",
        wallets: [],
        walletCount: 0,
      },
      {
        id: 'legacy-testnet-family',
        derivationPath: "m/49'/1'/0'",
        wallets: [],
        walletCount: 0,
      },
      {
        id: 'legacy-unknown',
        derivationPath: 'not-a-path',
        wallets: [],
        walletCount: 0,
      },
    ];

    expect(filterDevicesByNetwork(devices, 'mainnet').map((device) => device.id)).toEqual([
      'legacy-mainnet',
    ]);
    expect(filterDevicesByNetwork(devices, 'signet').map((device) => device.id)).toEqual([
      'legacy-testnet-family',
    ]);
  });

  it('preserves aggregate wallet counts when no wallet-link details are available to scope', () => {
    const devices = [
      {
        id: 'aggregate-count-only',
        derivationPath: "m/84'/0'/0'",
        wallets: [],
        walletCount: 7,
      },
    ];

    expect(filterDevicesByNetwork(devices, 'mainnet')).toEqual(devices);
  });
});
