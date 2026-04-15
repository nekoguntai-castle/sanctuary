/**
 * Nested SegWit (P2SH-P2WPKH/P2SH-P2WSH) Script Type Handler
 *
 * BIP-49 for single-sig, BIP-48 script type 1 for multisig.
 * Backwards-compatible SegWit wrapped in P2SH.
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

export const nestedSegwitHandler: ScriptTypeHandler = {
  id: 'nested_segwit',
  name: 'Nested SegWit (P2SH-P2WPKH)',
  description: 'BIP-49 wrapped SegWit addresses starting with 3',
  bip: 49,
  multisigBip: 48,
  multisigScriptTypeNumber: 1,
  supportsMultisig: true,
  aliases: ['p2sh-p2wpkh', 'wrapped_segwit', 'p2sh_p2wpkh'],

  getDerivationPath(network: Network, account: number = 0): string {
    return buildCoinTypeDerivationPath(49, network, account);
  },

  getMultisigDerivationPath(network: Network, account: number = 0): string {
    return buildBip48DerivationPath(network, 1, account);
  },

  buildSingleSigDescriptor(device: DeviceKeyInfo, options: DescriptorBuildOptions): string {
    const derivationPath = device.derivationPath || this.getDerivationPath(options.network);
    return `sh(wpkh(${buildRangedKeyExpression(device, derivationPath, options)}))`;
  },

  buildMultiSigDescriptor(devices: DeviceKeyInfo[], options: MultiSigBuildOptions): string {
    const fallbackPath = this.getMultisigDerivationPath(options.network);
    const keyExpressions = buildMultiSigKeyExpressions(devices, fallbackPath, options);
    return `sh(wsh(${buildSortedMulti(keyExpressions, options)}))`;
  },

  validateDevice(deviceScriptTypes: string[]): boolean {
    const validTypes = ['nested_segwit', 'p2sh-p2wpkh', 'wrapped_segwit', 'segwit'];
    return supportsAnyScriptType(deviceScriptTypes, validTypes);
  },
};
