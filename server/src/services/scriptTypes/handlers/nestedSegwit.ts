/**
 * Nested SegWit (P2SH-P2WPKH/P2SH-P2WSH) Script Type Handler
 *
 * BIP-49 for single-sig, BIP-48 script type 1 for multisig.
 * Backwards-compatible SegWit wrapped in P2SH.
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

export const nestedSegwitHandler: ScriptTypeHandler = {
  id: WalletScriptType.NESTED_SEGWIT,
  name: 'Nested SegWit (P2SH-P2WPKH)',
  description: 'BIP-49 wrapped SegWit addresses starting with 3',
  bip: 49,
  multisigBip: 48,
  multisigScriptTypeNumber: 1,
  supportsMultisig: true,
  aliases: ['p2sh-p2wpkh', 'wrapped_segwit', 'p2sh_p2wpkh'],

  getDerivationPath(network: Network, account: number): string {
    return buildWalletPolicyDerivationPath(WalletType.SINGLE_SIG, WalletScriptType.NESTED_SEGWIT, network, account);
  },

  getMultisigDerivationPath(network: Network, account: number): string {
    return buildWalletPolicyDerivationPath(WalletType.MULTI_SIG, WalletScriptType.NESTED_SEGWIT, network, account);
  },

  buildSingleSigDescriptor(device: DeviceKeyInfo, options: DescriptorBuildOptions): string {
    return wrapWalletPolicyDescriptor(
      WalletType.SINGLE_SIG,
      WalletScriptType.NESTED_SEGWIT,
      buildRangedKeyExpression(device, device.derivationPath, options),
    );
  },

  buildMultiSigDescriptor(devices: DeviceKeyInfo[], options: MultiSigBuildOptions): string {
    const keyExpressions = buildMultiSigKeyExpressions(devices, options);
    return wrapWalletPolicyDescriptor(
      WalletType.MULTI_SIG,
      WalletScriptType.NESTED_SEGWIT,
      buildSortedMulti(keyExpressions, options),
    );
  },

  validateDevice(deviceScriptTypes: string[]): boolean {
    const validTypes = [WalletScriptType.NESTED_SEGWIT, 'p2sh-p2wpkh', 'wrapped_segwit', 'segwit'];
    return supportsAnyScriptType(deviceScriptTypes, validTypes);
  },
};
