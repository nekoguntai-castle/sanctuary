/**
 * Address Derivation Utilities
 *
 * Shared utilities for network resolution, account path detection,
 * and xpub validation.
 */

import * as bitcoin from 'bitcoinjs-lib';
import bip32 from '../bip32';
import { getErrorMessage } from '../../../utils/errors';
import { convertToStandardXpub } from './xpubConversion';
import type { XpubValidationResult } from './types';

/**
 * Get network object from network string
 */
export function getNetwork(network: 'mainnet' | 'testnet' | 'regtest'): bitcoin.Network {
  switch (network) {
    case 'mainnet':
      return bitcoin.networks.bitcoin;
    case 'testnet':
      return bitcoin.networks.testnet;
    case 'regtest':
      return bitcoin.networks.regtest;
    default:
      // Explicit error instead of silent fallback to mainnet
      throw new Error(`Unsupported network: ${network}. Expected 'mainnet', 'testnet', or 'regtest'.`);
  }
}

/**
 * Get standard account path for xpub
 */
export function getAccountPath(
  xpub: string,
  scriptType: string,
  network: 'mainnet' | 'testnet' | 'regtest'
): string {
  // Standard BIP44/49/84/86 paths
  const coinType = network === 'mainnet' ? '0' : '1';

  // Try to detect from xpub prefix
  if (xpub.startsWith('xpub')) {
    // xpub can be used for any script type - use scriptType to determine path
    if (scriptType === 'native_segwit') {
      return `m/84'/${coinType}'/0'`; // BIP84 - native segwit
    } else if (scriptType === 'nested_segwit') {
      return `m/49'/${coinType}'/0'`; // BIP49
    } else if (scriptType === 'taproot') {
      return `m/86'/${coinType}'/0'`; // BIP86
    } else {
      return `m/44'/${coinType}'/0'`; // BIP44 - legacy
    }
  } else if (xpub.startsWith('ypub')) {
    return `m/49'/${coinType}'/0'`; // BIP49 - nested segwit
  } else if (xpub.startsWith('zpub')) {
    return `m/84'/${coinType}'/0'`; // BIP84 - native segwit
  } else if (xpub.startsWith('Zpub') || xpub.startsWith('Ypub')) {
    // Multisig versions
    if (scriptType === 'nested_segwit') {
      return `m/49'/${coinType}'/0'`;
    } else {
      return `m/84'/${coinType}'/0'`;
    }
  }

  // Default to native segwit path
  return `m/84'/${coinType}'/0'`;
}

/**
 * Validate xpub format
 */
export function validateXpub(xpub: string, network: 'mainnet' | 'testnet' | 'regtest' = 'mainnet'): XpubValidationResult {
  try {
    const networkObj = getNetwork(network);

    // Convert zpub/ypub/etc to standard xpub format for validation
    const standardXpub = convertToStandardXpub(xpub);
    bip32.fromBase58(standardXpub, networkObj);

    // Detect script type from original prefix
    let scriptType: 'native_segwit' | 'nested_segwit' | 'legacy' = 'native_segwit';
    // zpub/Zpub/vpub/Vpub prefixes intentionally keep the default native SegWit classification.
    if (xpub.startsWith('ypub') || xpub.startsWith('Ypub') || xpub.startsWith('upub') || xpub.startsWith('Upub')) {
      scriptType = 'nested_segwit';
    } else if (xpub.startsWith('xpub') || xpub.startsWith('tpub')) {
      scriptType = 'legacy'; // Could be either, but default to legacy
    }

    return { valid: true, scriptType };
  } catch (error) {
    return {
      valid: false,
      error: getErrorMessage(error, 'Invalid xpub format'),
    };
  }
}
