/**
 * Native SegWit (P2WPKH/P2WSH) Script Type Handler
 *
 * BIP-84 for single-sig, BIP-48 script type 2 for multisig.
 * Most modern and efficient on-chain script type.
 */

import { WalletScriptType, WalletType } from '@sanctuary/shared/constants/walletIdentity';
import type {
  ScriptTypeHandler,
  DeviceKeyInfo,
  DescriptorBuildOptions,
  MultiSigBuildOptions,
  Network,
} from '../types';
import {
  buildWalletPolicyDerivationPath,
  buildMultiSigKeyExpressions,
  buildRangedKeyExpression,
  buildSortedMulti,
  supportsAnyScriptType,
  wrapWalletPolicyDescriptor,
} from './descriptorHelpers';

export const nativeSegwitHandler: ScriptTypeHandler = {
  id: WalletScriptType.NATIVE_SEGWIT,
  name: 'Native SegWit (P2WPKH)',
  description: 'BIP-84 native SegWit addresses starting with bc1q',
  bip: 84,
  multisigBip: 48,
  multisigScriptTypeNumber: 2,
  supportsMultisig: true,
  aliases: ['p2wpkh', 'bech32', 'segwit', 'wpkh'],

  getDerivationPath(network: Network, account: number): string {
    return buildWalletPolicyDerivationPath(WalletType.SINGLE_SIG, WalletScriptType.NATIVE_SEGWIT, network, account);
  },

  getMultisigDerivationPath(network: Network, account: number): string {
    return buildWalletPolicyDerivationPath(WalletType.MULTI_SIG, WalletScriptType.NATIVE_SEGWIT, network, account);
  },

  buildSingleSigDescriptor(device: DeviceKeyInfo, options: DescriptorBuildOptions): string {
    return wrapWalletPolicyDescriptor(
      WalletType.SINGLE_SIG,
      WalletScriptType.NATIVE_SEGWIT,
      buildRangedKeyExpression(device, device.derivationPath, options),
    );
  },

  buildMultiSigDescriptor(devices: DeviceKeyInfo[], options: MultiSigBuildOptions): string {
    const keyExpressions = buildMultiSigKeyExpressions(devices, options);
    return wrapWalletPolicyDescriptor(
      WalletType.MULTI_SIG,
      WalletScriptType.NATIVE_SEGWIT,
      buildSortedMulti(keyExpressions, options),
    );
  },

  validateDevice(deviceScriptTypes: string[]): boolean {
    const validTypes = [WalletScriptType.NATIVE_SEGWIT, 'p2wpkh', 'bech32', 'segwit', 'wpkh'];
    return supportsAnyScriptType(deviceScriptTypes, validTypes);
  },
};
