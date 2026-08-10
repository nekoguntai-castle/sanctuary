/**
 * Taproot (P2TR) Script Type Handler
 *
 * BIP-86 for single-sig. Multisig not yet fully supported.
 * Latest Bitcoin script type with enhanced privacy and efficiency.
 */

import { WalletScriptType, WalletType } from '@sanctuary/shared/constants/walletIdentity';
import type {
  ScriptTypeHandler,
  DeviceKeyInfo,
  DescriptorBuildOptions,
  Network,
} from '../types';
import {
  buildWalletPolicyDerivationPath,
  buildRangedKeyExpression,
  supportsAnyScriptType,
  wrapWalletPolicyDescriptor,
} from './descriptorHelpers';

export const taprootHandler: ScriptTypeHandler = {
  id: WalletScriptType.TAPROOT,
  name: 'Taproot (P2TR)',
  description: 'BIP-86 Taproot addresses starting with bc1p',
  bip: 86,
  multisigBip: 48,
  multisigScriptTypeNumber: 3,
  supportsMultisig: false, // MuSig2 multisig not yet widely supported
  aliases: ['p2tr', 'bech32m', 'tr'],

  getDerivationPath(network: Network, account: number = 0): string {
    return buildWalletPolicyDerivationPath(WalletType.SINGLE_SIG, WalletScriptType.TAPROOT, network, account);
  },

  getMultisigDerivationPath(_network: Network, _account: number = 0): string {
    throw new Error('Taproot multisig is not supported');
  },

  buildSingleSigDescriptor(device: DeviceKeyInfo, options: DescriptorBuildOptions): string {
    const derivationPath = device.derivationPath || this.getDerivationPath(options.network);
    return wrapWalletPolicyDescriptor(
      WalletType.SINGLE_SIG,
      WalletScriptType.TAPROOT,
      buildRangedKeyExpression(device, derivationPath, options),
    );
  },

  // Multisig not implemented - would require MuSig2 or script path spending
  // buildMultiSigDescriptor is omitted since supportsMultisig is false

  validateDevice(deviceScriptTypes: string[]): boolean {
    const validTypes = [WalletScriptType.TAPROOT, 'p2tr', 'bech32m', 'tr'];
    return supportsAnyScriptType(deviceScriptTypes, validTypes);
  },
};
