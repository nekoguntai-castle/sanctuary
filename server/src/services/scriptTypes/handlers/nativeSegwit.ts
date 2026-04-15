/**
 * Native SegWit (P2WPKH/P2WSH) Script Type Handler
 *
 * BIP-84 for single-sig, BIP-48 script type 2 for multisig.
 * Most modern and efficient on-chain script type.
 */

import type {
  ScriptTypeHandler,
  DeviceKeyInfo,
  DescriptorBuildOptions,
  MultiSigBuildOptions,
  Network,
} from '../types';
import {
  buildBip48DerivationPath,
  buildCoinTypeDerivationPath,
  buildMultiSigKeyExpressions,
  buildRangedKeyExpression,
  buildSortedMulti,
  supportsAnyScriptType,
} from './descriptorHelpers';

export const nativeSegwitHandler: ScriptTypeHandler = {
  id: 'native_segwit',
  name: 'Native SegWit (P2WPKH)',
  description: 'BIP-84 native SegWit addresses starting with bc1q',
  bip: 84,
  multisigBip: 48,
  multisigScriptTypeNumber: 2,
  supportsMultisig: true,
  aliases: ['p2wpkh', 'bech32', 'segwit', 'wpkh'],

  getDerivationPath(network: Network, account: number = 0): string {
    return buildCoinTypeDerivationPath(84, network, account);
  },

  getMultisigDerivationPath(network: Network, account: number = 0): string {
    return buildBip48DerivationPath(network, 2, account);
  },

  buildSingleSigDescriptor(device: DeviceKeyInfo, options: DescriptorBuildOptions): string {
    const derivationPath = device.derivationPath || this.getDerivationPath(options.network);
    return `wpkh(${buildRangedKeyExpression(device, derivationPath, options)})`;
  },

  buildMultiSigDescriptor(devices: DeviceKeyInfo[], options: MultiSigBuildOptions): string {
    const fallbackPath = this.getMultisigDerivationPath(options.network);
    const keyExpressions = buildMultiSigKeyExpressions(devices, fallbackPath, options);
    return `wsh(${buildSortedMulti(keyExpressions, options)})`;
  },

  validateDevice(deviceScriptTypes: string[]): boolean {
    const validTypes = ['native_segwit', 'p2wpkh', 'bech32', 'segwit', 'wpkh'];
    return supportsAnyScriptType(deviceScriptTypes, validTypes);
  },
};
