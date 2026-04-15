/**
 * Legacy (P2PKH/P2SH) Script Type Handler
 *
 * BIP-44 for single-sig, BIP-45 for multisig.
 * Original Bitcoin script types - less efficient but universally supported.
 */

import type {
  ScriptTypeHandler,
  DeviceKeyInfo,
  DescriptorBuildOptions,
  MultiSigBuildOptions,
  Network,
} from '../types';
import {
  buildCoinTypeDerivationPath,
  buildMultiSigKeyExpressions,
  buildRangedKeyExpression,
  buildSortedMulti,
  supportsAnyScriptType,
} from './descriptorHelpers';

export const legacyHandler: ScriptTypeHandler = {
  id: 'legacy',
  name: 'Legacy (P2PKH)',
  description: 'BIP-44 legacy addresses starting with 1',
  bip: 44,
  multisigBip: 45,
  supportsMultisig: true,
  aliases: ['p2pkh', 'pkh'],

  getDerivationPath(network: Network, account: number = 0): string {
    return buildCoinTypeDerivationPath(44, network, account);
  },

  getMultisigDerivationPath(_network: Network, account: number = 0): string {
    // BIP45 doesn't use coin type
    return `m/45'/${account}'`;
  },

  buildSingleSigDescriptor(device: DeviceKeyInfo, options: DescriptorBuildOptions): string {
    const derivationPath = device.derivationPath || this.getDerivationPath(options.network);
    return `pkh(${buildRangedKeyExpression(device, derivationPath, options)})`;
  },

  buildMultiSigDescriptor(devices: DeviceKeyInfo[], options: MultiSigBuildOptions): string {
    const fallbackPath = this.getMultisigDerivationPath(options.network);
    const keyExpressions = buildMultiSigKeyExpressions(devices, fallbackPath, options);
    return `sh(${buildSortedMulti(keyExpressions, options)})`;
  },

  validateDevice(deviceScriptTypes: string[]): boolean {
    const validTypes = ['legacy', 'p2pkh', 'pkh'];
    return supportsAnyScriptType(deviceScriptTypes, validTypes);
  },
};
