import { describe, expect, it } from 'vitest';
import {
  DeviceAccountPurpose,
  WalletScriptType,
} from '@sanctuary/shared/constants/walletIdentity';
import { WalletType } from '../../../src/types';
import {
  buildCreateWalletPayload,
  getCompatibleDevices,
  getExactAccount,
  getIncompatibleDevices,
  getNextSelectedSigners,
  getRequiredAccountPurpose,
} from '../../../src/components/CreateWallet/createWalletData';

const singleMainnetDevice = {
  id: 'single-mainnet',
  accounts: [
    {
      id: 'single-mainnet-account',
      purpose: DeviceAccountPurpose.SINGLE_SIG,
      scriptType: WalletScriptType.NATIVE_SEGWIT,
      derivationPath: "m/84'/0'/0'",
      xpub: 'xpub-single-mainnet',
    },
  ],
};

const multisigTestnetDevice = {
  id: 'multi-testnet',
  accounts: [
    {
      id: 'multi-testnet-account',
      purpose: DeviceAccountPurpose.MULTISIG,
      scriptType: WalletScriptType.NATIVE_SEGWIT,
      derivationPath: "m/48'/1'/0'/2'",
      xpub: 'tpub-multi-testnet',
    },
  ],
};

describe('createWalletData', () => {
  it('derives required device account purpose from canonical wallet type mapping', () => {
    expect(getRequiredAccountPurpose(WalletType.SINGLE_SIG)).toBe(DeviceAccountPurpose.SINGLE_SIG);
    expect(getRequiredAccountPurpose(WalletType.MULTI_SIG)).toBe(DeviceAccountPurpose.MULTISIG);
  });

  it('rejects devices without an explicit account even when legacy fields look compatible', () => {
    const legacy = { derivationPath: "m/84'/0'/0'", xpub: 'xpub-legacy' } as any;
    expect(getExactAccount(
      legacy,
      WalletType.SINGLE_SIG,
      WalletScriptType.NATIVE_SEGWIT,
      'mainnet'
    )).toBeNull();
  });

  it('requires exactly one account matching purpose, script type, and network family', () => {
    expect(getExactAccount(
      singleMainnetDevice as any,
      WalletType.SINGLE_SIG,
      WalletScriptType.NATIVE_SEGWIT,
      'mainnet'
    )?.id).toBe('single-mainnet-account');
    expect(getExactAccount(
      singleMainnetDevice as any,
      WalletType.SINGLE_SIG,
      WalletScriptType.NATIVE_SEGWIT,
      'signet'
    )).toBeNull();
    expect(getExactAccount(
      multisigTestnetDevice as any,
      WalletType.MULTI_SIG,
      WalletScriptType.NATIVE_SEGWIT,
      'testnet3'
    )?.id).toBe(
      'multi-testnet-account'
    );
    expect(getExactAccount(
      multisigTestnetDevice as any,
      WalletType.MULTI_SIG,
      WalletScriptType.NESTED_SEGWIT,
      'testnet3'
    )).toBeNull();
  });

  it('fails closed when multiple accounts exactly match', () => {
    const duplicate = {
      ...singleMainnetDevice,
      accounts: [
        ...singleMainnetDevice.accounts,
        { ...singleMainnetDevice.accounts[0], id: 'duplicate-account', derivationPath: "m/84'/0'/7'" },
      ],
    };

    expect(getExactAccount(
      duplicate as any,
      WalletType.SINGLE_SIG,
      WalletScriptType.NATIVE_SEGWIT,
      'mainnet'
    )).toBeNull();
  });

  it('fails closed when matching metadata has an unparseable network path', () => {
    const invalidPath = {
      ...singleMainnetDevice,
      accounts: [{ ...singleMainnetDevice.accounts[0], derivationPath: 'unknown-path' }],
    };

    expect(getExactAccount(
      invalidPath as any,
      WalletType.SINGLE_SIG,
      WalletScriptType.NATIVE_SEGWIT,
      'mainnet'
    )).toBeNull();
  });

  it.each([
    ["m/49'/0'/0'", 'path-derived script type'],
    ["m/84/0'/0'", 'unhardened purpose'],
    ["m/84'/0'/0'/0/0", 'child path instead of account path'],
    ["m/84'/0'/2147483648'", 'account index above the BIP32 maximum'],
  ])('fails closed for matching metadata with an invalid %s (%s)', (derivationPath) => {
    const invalid = {
      ...singleMainnetDevice,
      accounts: [{ ...singleMainnetDevice.accounts[0], derivationPath }],
    };

    expect(getExactAccount(
      invalid as any,
      WalletType.SINGLE_SIG,
      WalletScriptType.NATIVE_SEGWIT,
      'mainnet'
    )).toBeNull();
  });

  it('accepts the maximum exact BIP32 account index', () => {
    const nonzero = {
      ...singleMainnetDevice,
      accounts: [{ ...singleMainnetDevice.accounts[0], derivationPath: "m/84'/0'/2147483647'" }],
    };

    expect(getExactAccount(
      nonzero as any,
      WalletType.SINGLE_SIG,
      WalletScriptType.NATIVE_SEGWIT,
      'mainnet'
    )?.id).toBe('single-mainnet-account');
  });

  it('splits compatible and incompatible devices for the selected wallet type', () => {
    const devices = [singleMainnetDevice, multisigTestnetDevice] as any[];

    expect(getCompatibleDevices(
      devices,
      WalletType.SINGLE_SIG,
      WalletScriptType.NATIVE_SEGWIT,
      'mainnet'
    ).map(device => device.id)).toEqual([
      'single-mainnet',
    ]);
    expect(getIncompatibleDevices(
      devices,
      WalletType.SINGLE_SIG,
      WalletScriptType.NATIVE_SEGWIT,
      'mainnet'
    ).map(device => device.id)).toEqual([
      'multi-testnet',
    ]);
    expect(getCompatibleDevices(devices, null, WalletScriptType.NATIVE_SEGWIT, 'mainnet')).toBe(devices);
    expect(getIncompatibleDevices(devices, null, WalletScriptType.NATIVE_SEGWIT, 'mainnet')).toEqual([]);
  });

  it('preserves selection order while toggling exact signer bindings', () => {
    const first = { deviceId: 'device-1', deviceAccountId: 'account-7' };
    const second = { deviceId: 'device-2', deviceAccountId: 'account-2' };
    const selected = getNextSelectedSigners([], WalletType.MULTI_SIG, first);
    const both = getNextSelectedSigners(selected, WalletType.MULTI_SIG, second);

    expect(both).toEqual([first, second]);
    expect(getNextSelectedSigners(both, WalletType.MULTI_SIG, first)).toEqual([second]);
    expect(getNextSelectedSigners([first], WalletType.SINGLE_SIG, first)).toEqual([]);
    expect(getNextSelectedSigners([first], WalletType.SINGLE_SIG, second)).toEqual([second]);
  });

  it('preserves canonical wallet and script type values in create payloads', () => {
    const payload = buildCreateWalletPayload({
      walletType: WalletType.MULTI_SIG,
      selectedSigners: [
        { deviceId: 'device-2', deviceAccountId: 'account-9' },
        { deviceId: 'device-1', deviceAccountId: 'account-4' },
      ],
      walletName: 'Treasury',
      scriptType: WalletScriptType.NATIVE_SEGWIT,
      network: 'mainnet',
      quorumM: 2,
    });

    expect(payload.type).toBe(WalletType.MULTI_SIG);
    expect(payload.scriptType).toBe(WalletScriptType.NATIVE_SEGWIT);
    expect(payload.quorum).toBe(2);
    expect(payload.totalSigners).toBe(2);
    expect(payload.signers).toEqual([
      { deviceId: 'device-2', deviceAccountId: 'account-9', signerIndex: 0 },
      { deviceId: 'device-1', deviceAccountId: 'account-4', signerIndex: 1 },
    ]);
  });

  it('rejects payload construction before wallet type selection', () => {
    expect(() => buildCreateWalletPayload({
      walletType: null,
      selectedSigners: [{ deviceId: 'device-1', deviceAccountId: 'account-1' }],
      walletName: 'Draft',
      scriptType: WalletScriptType.NATIVE_SEGWIT,
      network: 'mainnet',
      quorumM: 1,
    })).toThrow('Wallet type is required');
  });

  it('rejects payload construction without an exact signer binding', () => {
    expect(() => buildCreateWalletPayload({
      walletType: WalletType.SINGLE_SIG,
      selectedSigners: [],
      walletName: 'Draft',
      scriptType: WalletScriptType.NATIVE_SEGWIT,
      network: 'mainnet',
      quorumM: 1,
    })).toThrow('At least one exact signer account is required');
  });
});
