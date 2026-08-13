/**
 * BitBox02 Path Utilities
 *
 * Functions for converting derivation paths and script types to BitBox02 API constants.
 */

import { constants } from 'bitbox02-api';
import * as bitcoin from 'bitcoinjs-lib';
import { parseDerivationPath } from '@sanctuary/shared/utils/bitcoin';
import { createLogger } from '../../../../utils/logger';

const log = createLogger('BitBoxPathUtils');

// Re-export for backward compatibility
export { extractAccountPath } from '../../pathUtils';

/**
 * Get script type constant from path or script type string
 */
const getRequestedSimpleType = (scriptType?: string): number | undefined => {
  if (!scriptType) return undefined;
  switch (scriptType) {
    case 'p2wpkh':
      return constants.messages.BTCScriptConfig_SimpleType.P2WPKH;
    case 'p2sh-p2wpkh':
      return constants.messages.BTCScriptConfig_SimpleType.P2WPKH_P2SH;
    case 'p2tr':
      return constants.messages.BTCScriptConfig_SimpleType.P2TR;
    default:
      throw new Error(`Unsupported BitBox02 script type: ${scriptType}`);
  }
};

const getPathSimpleType = (path?: string): number | undefined => {
  // The hardened purpose selects the signing policy: BIP84, BIP49, or BIP86.
  if (path?.includes("/84'") || path?.includes('/84h')) {
    return constants.messages.BTCScriptConfig_SimpleType.P2WPKH;
  }
  if (path?.includes("/49'") || path?.includes('/49h')) {
    return constants.messages.BTCScriptConfig_SimpleType.P2WPKH_P2SH;
  }
  if (path?.includes("/86'") || path?.includes('/86h')) {
    return constants.messages.BTCScriptConfig_SimpleType.P2TR;
  }
  return undefined;
};

export const getSimpleType = (
  scriptType?: string,
  path?: string
): number => {
  const requestedType = getRequestedSimpleType(scriptType);
  const pathType = getPathSimpleType(path);
  if (pathType !== undefined) {
    if (requestedType !== undefined && requestedType !== pathType) {
      throw new Error('BitBox02 script type disagrees with the account path');
    }
    return pathType;
  }

  if (requestedType !== undefined) return requestedType;
  throw new Error(`Unsupported BitBox02 script type for path: ${path ?? 'missing'}`);
};

/**
 * Get xpub type constant from path
 */
export const getXpubType = (path: string, isTestnet: boolean): number => {
  if (path.includes("/84'") || path.includes("/84h")) {
    return isTestnet
      ? constants.messages.BTCXPubType.VPUB
      : constants.messages.BTCXPubType.ZPUB;
  }
  if (path.includes("/49'") || path.includes("/49h")) {
    return isTestnet
      ? constants.messages.BTCXPubType.UPUB
      : constants.messages.BTCXPubType.YPUB;
  }
  if (path.includes("/86'") || path.includes("/86h")) {
    // Taproot - use xpub/tpub
    return isTestnet
      ? constants.messages.BTCXPubType.TPUB
      : constants.messages.BTCXPubType.XPUB;
  }
  throw new Error(`Unsupported BitBox02 xpub path: ${path}`);
};

/**
 * Get coin constant from path
 */
export const getCoin = (path: string): number => {
  const coinType = parseDerivationPath(path).coinType;
  if (coinType === 0) return constants.messages.BTCCoin.BTC;
  if (coinType === 1) return constants.messages.BTCCoin.TBTC;
  throw new Error(`Unsupported BitBox02 coin type for path: ${path}`);
};

/**
 * Get output type constant from address
 */
export const getOutputType = (address: string, network: bitcoin.Network): number => {
  // Try to decode as different address types
  try {
    const decoded = bitcoin.address.fromBech32(address);
    if (decoded.prefix !== network.bech32) throw new Error('bech32 network mismatch');
    if (decoded.version === 0) {
      if (decoded.data.length === 20) return constants.messages.BTCOutputType.P2WPKH;
      if (decoded.data.length === 32) return constants.messages.BTCOutputType.P2WSH;
      throw new Error('unsupported v0 witness program length');
    }
    if (decoded.version === 1 && decoded.data.length === 32) {
      return constants.messages.BTCOutputType.P2TR;
    }
  } catch (error) {
    log.debug('Address is not bech32 for BitBox output type detection', { error });
    // Not bech32
  }

  try {
    const decoded = bitcoin.address.fromBase58Check(address);
    if (decoded.hash.length !== 20) throw new Error('unsupported base58 payload length');
    if (decoded.version === network.pubKeyHash) {
      return constants.messages.BTCOutputType.P2PKH;
    }
    if (decoded.version === network.scriptHash) {
      return constants.messages.BTCOutputType.P2SH;
    }
  } catch (error) {
    log.debug('Address is not base58 for BitBox output type detection', { error });
    // Not base58
  }

  throw new Error(`Unsupported or invalid BitBox02 output address: ${address || 'missing'}`);
};
