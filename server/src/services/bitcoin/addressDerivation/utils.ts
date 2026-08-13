/**
 * Address Derivation Utilities
 *
 * Shared utilities for network resolution and xpub validation.
 */

import * as bitcoin from 'bitcoinjs-lib';
import {
  WalletScriptType,
  type WalletScriptType as WalletScriptTypeValue,
} from '@sanctuary/shared/constants/walletIdentity';
import bip32 from '../bip32';
import { getErrorMessage } from '../../../utils/errors';
import { convertToStandardXpub } from './xpubConversion';
import type { AddressDerivationNetwork, XpubValidationResult } from './types';
import { bitcoinJsNetworkName, isBitcoinNetwork } from '../networks';

/**
 * Get network object from network string
 */
export function getNetwork(network: AddressDerivationNetwork): bitcoin.Network {
  if (network !== 'testnet' && !isBitcoinNetwork(network)) {
    throw new Error(`Unsupported network: ${String(network)}`);
  }

  const bitcoinJsNetwork = bitcoinJsNetworkName(network);
  if (bitcoinJsNetwork === 'testnet') return bitcoin.networks.testnet;
  if (bitcoinJsNetwork === 'regtest') return bitcoin.networks.regtest;
  return bitcoin.networks.bitcoin;
}

/**
 * Validate xpub format
 */
export function validateXpub(xpub: string, network: AddressDerivationNetwork = 'mainnet'): XpubValidationResult {
  try {
    const networkObj = getNetwork(network);

    // Convert zpub/ypub/etc to standard xpub format for validation
    const standardXpub = convertToStandardXpub(xpub);
    bip32.fromBase58(standardXpub, networkObj);

    // Detect script type from original prefix
    let scriptType: WalletScriptTypeValue = WalletScriptType.NATIVE_SEGWIT;
    // zpub/Zpub/vpub/Vpub prefixes intentionally keep the default native SegWit classification.
    if (xpub.startsWith('ypub') || xpub.startsWith('Ypub') || xpub.startsWith('upub') || xpub.startsWith('Upub')) {
      scriptType = WalletScriptType.NESTED_SEGWIT;
    } else if (xpub.startsWith('xpub') || xpub.startsWith('tpub')) {
      scriptType = WalletScriptType.LEGACY; // Could be either, but default to legacy
    }

    return { valid: true, scriptType };
  } catch (error) {
    return {
      valid: false,
      error: getErrorMessage(error, 'Invalid xpub format'),
    };
  }
}
