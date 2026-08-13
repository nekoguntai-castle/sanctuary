/**
 * Legacy (P2PKH/P2SH) Script Type Handler
 *
 * BIP-44 for single-sig, BIP-45 for multisig.
 * Original Bitcoin script types - less efficient but universally supported.
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

export const legacyHandler: ScriptTypeHandler = {
  id: WalletScriptType.LEGACY,
  name: 'Legacy (P2PKH)',
  description: 'BIP-44 legacy addresses starting with 1',
  bip: 44,
  multisigBip: 45,
  supportsMultisig: false,
  aliases: ['p2pkh', 'pkh'],

  getDerivationPath(network: Network, account: number): string {
    return buildWalletPolicyDerivationPath(WalletType.SINGLE_SIG, WalletScriptType.LEGACY, network, account);
  },

  getMultisigDerivationPath(_network: Network, _account: number): string {
    throw new Error('Legacy multisig is not supported');
  },

  buildSingleSigDescriptor(device: DeviceKeyInfo, options: DescriptorBuildOptions): string {
    return wrapWalletPolicyDescriptor(
      WalletType.SINGLE_SIG,
      WalletScriptType.LEGACY,
      buildRangedKeyExpression(device, device.derivationPath, options),
    );
  },

  validateDevice(deviceScriptTypes: string[]): boolean {
    const validTypes = [WalletScriptType.LEGACY, 'p2pkh', 'pkh'];
    return supportsAnyScriptType(deviceScriptTypes, validTypes);
  },
};
