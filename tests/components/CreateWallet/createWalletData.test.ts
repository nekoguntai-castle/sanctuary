import { describe, expect, it } from 'vitest';
import {
  DeviceAccountPurpose,
  WalletScriptType,
} from '@sanctuary/shared/constants/walletIdentity';
import { WalletType } from '../../../src/types';
import {
  buildCreateWalletPayload,
  canAdvanceCreateWalletStep,
  getCompatibleDevices,
  getExactAccount,
  getIncompatibleDevices,
  getNextCreateWalletStep,
  getNextSelectedSigners,
  getRequiredAccountPurpose,
  getSelectionScriptTypes,
  getSupportedScriptTypes,
  rebindSingleSigSelection,
  reconcileSelectedSigners,
  resolveSignerBinding,
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

const nestedOnlyDevice = {
  id: 'nested-only',
  accounts: [
    {
      id: 'nested-only-account',
      purpose: DeviceAccountPurpose.SINGLE_SIG,
      scriptType: WalletScriptType.NESTED_SEGWIT,
      derivationPath: "m/49'/0'/0'",
      xpub: 'ypub-nested-only',
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
  it('drops a selected signer when its device disappeared on refresh', () => {
    expect(reconcileSelectedSigners(
      [{ deviceId: 'removed-device', deviceAccountId: 'old-account' }],
      [], WalletType.SINGLE_SIG, WalletScriptType.NATIVE_SEGWIT, 'mainnet'
    )).toEqual([]);
  });
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

  it('lists the single-sig script types a device has exactly one account for', () => {
    expect(getSupportedScriptTypes(nestedOnlyDevice as any, WalletType.SINGLE_SIG, 'mainnet'))
      .toEqual([WalletScriptType.NESTED_SEGWIT]);
    const nativeAmbiguousTaproot = {
      id: 'ambiguous-native',
      accounts: [
        { id: 'n0', purpose: DeviceAccountPurpose.SINGLE_SIG, scriptType: WalletScriptType.NATIVE_SEGWIT, derivationPath: "m/84'/0'/0'" },
        { id: 'n1', purpose: DeviceAccountPurpose.SINGLE_SIG, scriptType: WalletScriptType.NATIVE_SEGWIT, derivationPath: "m/84'/0'/1'" },
        { id: 't0', purpose: DeviceAccountPurpose.SINGLE_SIG, scriptType: WalletScriptType.TAPROOT, derivationPath: "m/86'/0'/0'" },
      ],
    };
    expect(getSupportedScriptTypes(nativeAmbiguousTaproot as any, WalletType.SINGLE_SIG, 'mainnet'))
      .toEqual([WalletScriptType.TAPROOT]);
    expect(getSupportedScriptTypes(nestedOnlyDevice as any, WalletType.SINGLE_SIG, 'testnet3')).toEqual([]);
  });

  it('lists a single-sig device whose only account is not the current script type', () => {
    const devices = [singleMainnetDevice, nestedOnlyDevice, multisigTestnetDevice] as any[];

    expect(getCompatibleDevices(devices, WalletType.SINGLE_SIG, WalletScriptType.NATIVE_SEGWIT, 'mainnet')
      .map(device => device.id)).toEqual(['single-mainnet', 'nested-only']);
    expect(getIncompatibleDevices(devices, WalletType.SINGLE_SIG, WalletScriptType.NATIVE_SEGWIT, 'mainnet')
      .map(device => device.id)).toEqual(['multi-testnet']);
    // Multisig stays exact-match on the fixed script type.
    expect(getCompatibleDevices(devices, WalletType.MULTI_SIG, WalletScriptType.NATIVE_SEGWIT, 'testnet3')
      .map(device => device.id)).toEqual(['multi-testnet']);
  });

  it('binds a signer to the current script type when supported, else to its first supported type', () => {
    expect(resolveSignerBinding(singleMainnetDevice as any, WalletType.SINGLE_SIG, WalletScriptType.TAPROOT, 'mainnet'))
      .toEqual({ scriptType: WalletScriptType.NATIVE_SEGWIT, account: singleMainnetDevice.accounts[0] });
    expect(resolveSignerBinding(nestedOnlyDevice as any, WalletType.SINGLE_SIG, WalletScriptType.NESTED_SEGWIT, 'mainnet')?.account.id)
      .toBe('nested-only-account');
    expect(resolveSignerBinding(nestedOnlyDevice as any, WalletType.SINGLE_SIG, WalletScriptType.NATIVE_SEGWIT, 'testnet3')).toBeNull();
    expect(resolveSignerBinding(multisigTestnetDevice as any, WalletType.MULTI_SIG, WalletScriptType.NATIVE_SEGWIT, 'testnet3')?.account.id)
      .toBe('multi-testnet-account');
    expect(resolveSignerBinding(singleMainnetDevice as any, WalletType.MULTI_SIG, WalletScriptType.NATIVE_SEGWIT, 'mainnet')).toBeNull();
  });

  it('offers the selected single-sig signer script types, or every type without one', () => {
    const devices = [singleMainnetDevice, nestedOnlyDevice] as any[];
    const nested = [{ deviceId: 'nested-only', deviceAccountId: 'nested-only-account' }];

    expect(getSelectionScriptTypes(nested, devices, WalletType.SINGLE_SIG, 'mainnet')).toEqual([WalletScriptType.NESTED_SEGWIT]);
    expect(getSelectionScriptTypes([], devices, WalletType.SINGLE_SIG, 'mainnet')).toHaveLength(4);
    expect(getSelectionScriptTypes(nested, devices, WalletType.MULTI_SIG, 'mainnet')).toHaveLength(4);
  });

  it('rebinds a single-sig selection in place and refuses types the signer lacks', () => {
    const devices = [nestedOnlyDevice] as any[];
    const nested = [{ deviceId: 'nested-only', deviceAccountId: 'stale-account' }];

    expect(rebindSingleSigSelection([], devices, WalletScriptType.TAPROOT, 'mainnet')).toEqual([]);
    expect(rebindSingleSigSelection(nested, devices, WalletScriptType.NESTED_SEGWIT, 'mainnet'))
      .toEqual([{ deviceId: 'nested-only', deviceAccountId: 'nested-only-account' }]);
    expect(rebindSingleSigSelection(nested, devices, WalletScriptType.TAPROOT, 'mainnet')).toBeNull();
    expect(rebindSingleSigSelection(nested, [], WalletScriptType.NESTED_SEGWIT, 'mainnet')).toBeNull();
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

  it('defensively blocks the step-3 gate when the quorum still exceeds the selected signers', () => {
    const overQuorumState = {
      walletType: WalletType.MULTI_SIG,
      selectedSigners: [
        { deviceId: 'device-1', deviceAccountId: 'account-1' },
        { deviceId: 'device-2', deviceAccountId: 'account-2' },
      ],
      walletName: 'Treasury',
      quorumM: 3,
    };

    expect(canAdvanceCreateWalletStep(3, overQuorumState)).toBe(false);
    expect(getNextCreateWalletStep(3, overQuorumState)).toEqual({
      error: {
        message: 'Quorum cannot exceed the number of selected signers.',
        title: 'Validation Error',
      },
    });
  });

  it('allows the step-3 gate to pass once the quorum is within the selected signer count', () => {
    const validState = {
      walletType: WalletType.MULTI_SIG,
      selectedSigners: [
        { deviceId: 'device-1', deviceAccountId: 'account-1' },
        { deviceId: 'device-2', deviceAccountId: 'account-2' },
      ],
      walletName: 'Treasury',
      quorumM: 2,
    };

    expect(canAdvanceCreateWalletStep(3, validState)).toBe(true);
    expect(getNextCreateWalletStep(3, validState)).toEqual({ nextStep: 4 });
  });

  it('does not apply the quorum gate to single-sig wallets', () => {
    const singleSigState = {
      walletType: WalletType.SINGLE_SIG,
      selectedSigners: [{ deviceId: 'device-1', deviceAccountId: 'account-1' }],
      walletName: 'Cold Wallet',
      quorumM: 5,
    };

    expect(canAdvanceCreateWalletStep(3, singleSigState)).toBe(true);
    expect(getNextCreateWalletStep(3, singleSigState)).toEqual({ nextStep: 4 });
  });
});
