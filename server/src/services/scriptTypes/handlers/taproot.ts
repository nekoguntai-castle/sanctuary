/**
 * Taproot (P2TR) Script Type Handler
 *
 * BIP-86 for single-sig. Multisig not yet fully supported.
 * Latest Bitcoin script type with enhanced privacy and efficiency.
 */

import type {
  ScriptTypeHandler,
  DeviceKeyInfo,
  DescriptorBuildOptions,
  Network,
} from '../types';
import {
  buildBip48DerivationPath,
  buildCoinTypeDerivationPath,
  buildRangedKeyExpression,
  supportsAnyScriptType,
} from './descriptorHelpers';

export const taprootHandler: ScriptTypeHandler = {
  id: 'taproot',
  name: 'Taproot (P2TR)',
  description: 'BIP-86 Taproot addresses starting with bc1p',
  bip: 86,
  multisigBip: 48,
  multisigScriptTypeNumber: 3,
  supportsMultisig: false, // MuSig2 multisig not yet widely supported
  aliases: ['p2tr', 'bech32m', 'tr'],

  getDerivationPath(network: Network, account: number = 0): string {
    return buildCoinTypeDerivationPath(86, network, account);
  },

  getMultisigDerivationPath(network: Network, account: number = 0): string {
    return buildBip48DerivationPath(network, 3, account);
  },

  buildSingleSigDescriptor(device: DeviceKeyInfo, options: DescriptorBuildOptions): string {
    const derivationPath = device.derivationPath || this.getDerivationPath(options.network);
    return `tr(${buildRangedKeyExpression(device, derivationPath, options)})`;
  },

  // Multisig not implemented - would require MuSig2 or script path spending
  // buildMultiSigDescriptor is omitted since supportsMultisig is false

  validateDevice(deviceScriptTypes: string[]): boolean {
    const validTypes = ['taproot', 'p2tr', 'bech32m', 'tr'];
    return supportsAnyScriptType(deviceScriptTypes, validTypes);
  },
};
