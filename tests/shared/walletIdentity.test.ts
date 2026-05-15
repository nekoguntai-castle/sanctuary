import { describe, expect, it } from 'vitest';
import {
  DEVICE_ACCOUNT_PURPOSE_VALUES,
  DeviceAccountPurpose,
  WALLET_SCRIPT_TYPE_VALUES,
  WALLET_TYPE_TO_ACCOUNT_PURPOSE,
  WALLET_TYPE_VALUES,
  WalletScriptType,
  WalletType,
  accountPurposeForWalletType,
  parseDeviceAccountPurpose,
  parseWalletScriptType,
  parseWalletType,
} from '@sanctuary/shared/constants/walletIdentity';

describe('wallet identity constants', () => {
  it('defines canonical persisted/API wallet identity values', () => {
    expect(WALLET_TYPE_VALUES).toEqual(['single_sig', 'multi_sig']);
    expect(WALLET_SCRIPT_TYPE_VALUES).toEqual([
      'legacy',
      'nested_segwit',
      'native_segwit',
      'taproot',
    ]);
    expect(DEVICE_ACCOUNT_PURPOSE_VALUES).toEqual(['single_sig', 'multisig']);
  });

  it('keeps wallet type to device account purpose mapping explicit', () => {
    expect(WALLET_TYPE_TO_ACCOUNT_PURPOSE).toEqual({
      [WalletType.SINGLE_SIG]: DeviceAccountPurpose.SINGLE_SIG,
      [WalletType.MULTI_SIG]: DeviceAccountPurpose.MULTISIG,
    });
    expect(accountPurposeForWalletType(WalletType.SINGLE_SIG)).toBe(DeviceAccountPurpose.SINGLE_SIG);
    expect(accountPurposeForWalletType(WalletType.MULTI_SIG)).toBe(DeviceAccountPurpose.MULTISIG);
  });

  it('parses only canonical wallet identity values', () => {
    expect(parseWalletType(WalletType.SINGLE_SIG)).toBe(WalletType.SINGLE_SIG);
    expect(parseWalletType('multisig')).toBeNull();
    expect(parseWalletType(null)).toBeNull();

    expect(parseWalletScriptType(WalletScriptType.NATIVE_SEGWIT)).toBe(WalletScriptType.NATIVE_SEGWIT);
    expect(parseWalletScriptType('p2wpkh')).toBeNull();
    expect(parseWalletScriptType(undefined)).toBeNull();

    expect(parseDeviceAccountPurpose(DeviceAccountPurpose.MULTISIG)).toBe(DeviceAccountPurpose.MULTISIG);
    expect(parseDeviceAccountPurpose(WalletType.MULTI_SIG)).toBeNull();
    expect(parseDeviceAccountPurpose('')).toBeNull();
  });
});
