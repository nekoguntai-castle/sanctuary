import { describe, expect, it } from 'vitest';
import {
  DeviceAccountPurpose,
  WalletScriptType,
} from '@sanctuary/shared/constants/walletIdentity';
import { WalletType } from '../../../types';
import {
  buildCreateWalletPayload,
  getCompatibleDevices,
  getDisplayAccount,
  getIncompatibleDevices,
  getRequiredAccountPurpose,
  hasCompatibleAccount,
  hasCompatibleNetworkAccount,
} from '../../../components/CreateWallet/createWalletData';

const singleMainnetDevice = {
  id: 'single-mainnet',
  accounts: [
    {
      id: 'single-mainnet-account',
      purpose: DeviceAccountPurpose.SINGLE_SIG,
      derivationPath: "m/84'/0'/0'",
    },
  ],
};

const multisigTestnetDevice = {
  id: 'multi-testnet',
  accounts: [
    {
      id: 'multi-testnet-account',
      purpose: DeviceAccountPurpose.MULTISIG,
      derivationPath: "m/48'/1'/0'/2'",
    },
  ],
};

describe('createWalletData', () => {
  it('derives required device account purpose from canonical wallet type mapping', () => {
    expect(getRequiredAccountPurpose(WalletType.SINGLE_SIG)).toBe(DeviceAccountPurpose.SINGLE_SIG);
    expect(getRequiredAccountPurpose(WalletType.MULTI_SIG)).toBe(DeviceAccountPurpose.MULTISIG);
  });

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

  it('preserves canonical wallet and script type values in create payloads', () => {
    const payload = buildCreateWalletPayload({
      walletType: WalletType.MULTI_SIG,
      selectedDeviceIds: new Set(['device-1', 'device-2']),
      walletName: 'Treasury',
      scriptType: WalletScriptType.NATIVE_SEGWIT,
      network: 'mainnet',
      quorumM: 2,
    });

    expect(payload.type).toBe(WalletType.MULTI_SIG);
    expect(payload.scriptType).toBe(WalletScriptType.NATIVE_SEGWIT);
    expect(payload.quorum).toBe(2);
    expect(payload.totalSigners).toBe(2);
  });

  it('rejects payload construction before wallet type selection', () => {
    expect(() => buildCreateWalletPayload({
      walletType: null,
      selectedDeviceIds: new Set(['device-1']),
      walletName: 'Draft',
      scriptType: WalletScriptType.NATIVE_SEGWIT,
      network: 'mainnet',
      quorumM: 1,
    })).toThrow('Wallet type is required');
  });
});
