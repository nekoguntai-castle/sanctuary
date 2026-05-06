import { describe, expect, it } from 'vitest';
import { WalletType } from '../../../types';
import {
  getCompatibleDevices,
  getDisplayAccount,
  getIncompatibleDevices,
  hasCompatibleAccount,
  hasCompatibleNetworkAccount,
} from '../../../components/CreateWallet/createWalletData';

const singleMainnetDevice = {
  id: 'single-mainnet',
  accounts: [
    {
      id: 'single-mainnet-account',
      purpose: 'single_sig',
      derivationPath: "m/84'/0'/0'",
    },
  ],
};

const multisigTestnetDevice = {
  id: 'multi-testnet',
  accounts: [
    {
      id: 'multi-testnet-account',
      purpose: 'multisig',
      derivationPath: "m/48'/1'/0'/2'",
    },
  ],
};

describe('createWalletData', () => {
  it('keeps legacy compatibility checks pinned to mainnet', () => {
    expect(hasCompatibleAccount({ derivationPath: "m/84'/0'/0'" } as any, WalletType.SINGLE_SIG)).toBe(true);
    expect(hasCompatibleAccount({ derivationPath: "m/84'/1'/0'" } as any, WalletType.SINGLE_SIG)).toBe(false);
    expect(hasCompatibleAccount({ derivationPath: "m/48'/0'/0'/2'" } as any, WalletType.MULTI_SIG)).toBe(true);
  });

  it('scopes account compatibility and display accounts by selected network', () => {
    expect(hasCompatibleNetworkAccount(singleMainnetDevice as any, WalletType.SINGLE_SIG, 'mainnet')).toBe(true);
    expect(hasCompatibleNetworkAccount(singleMainnetDevice as any, WalletType.SINGLE_SIG, 'signet')).toBe(false);
    expect(hasCompatibleNetworkAccount(multisigTestnetDevice as any, WalletType.MULTI_SIG, 'signet')).toBe(true);
    expect(getDisplayAccount(multisigTestnetDevice as any, WalletType.MULTI_SIG, 'testnet3')?.id).toBe(
      'multi-testnet-account'
    );
    expect(getDisplayAccount(singleMainnetDevice as any, WalletType.MULTI_SIG, 'mainnet')).toBeNull();
  });

  it('splits compatible and incompatible devices for the selected wallet type', () => {
    const devices = [singleMainnetDevice, multisigTestnetDevice] as any[];

    expect(getCompatibleDevices(devices, WalletType.SINGLE_SIG, 'mainnet').map(device => device.id)).toEqual([
      'single-mainnet',
    ]);
    expect(getIncompatibleDevices(devices, WalletType.SINGLE_SIG, 'mainnet').map(device => device.id)).toEqual([
      'multi-testnet',
    ]);
    expect(getCompatibleDevices(devices, null, 'mainnet')).toBe(devices);
    expect(getIncompatibleDevices(devices, null, 'mainnet')).toEqual([]);
  });
});
