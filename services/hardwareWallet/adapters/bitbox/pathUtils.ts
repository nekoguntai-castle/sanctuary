/**
 * BitBox02 Path Utilities
 *
 * Functions for converting derivation paths and script types to BitBox02 API constants.
 */

import { constants } from 'bitbox02-api';
import * as bitcoin from 'bitcoinjs-lib';
import { isTestnetPath } from '../../pathUtils';
import { createLogger } from '../../../../utils/logger';

const log = createLogger('BitBoxPathUtils');

// Re-export for backward compatibility
export { extractAccountPath } from '../../pathUtils';

/**
 * Get script type constant from path or script type string
 */
export const getSimpleType = (
  scriptType?: string,
  path?: string
): number => {
  // If scriptType is provided, use it
  if (scriptType) {
    switch (scriptType) {
      case 'p2wpkh':
        return constants.messages.BTCScriptConfig_SimpleType.P2WPKH;
      case 'p2sh-p2wpkh':
        return constants.messages.BTCScriptConfig_SimpleType.P2WPKH_P2SH;
      case 'p2tr':
        return constants.messages.BTCScriptConfig_SimpleType.P2TR;
      default:
        return constants.messages.BTCScriptConfig_SimpleType.P2WPKH;
    }
  }

  // Infer from path
  if (path) {
    if (path.includes("/84'") || path.includes("/84h")) {
      return constants.messages.BTCScriptConfig_SimpleType.P2WPKH;
    }
    if (path.includes("/49'") || path.includes("/49h")) {
      return constants.messages.BTCScriptConfig_SimpleType.P2WPKH_P2SH;
    }
    if (path.includes("/86'") || path.includes("/86h")) {
      return constants.messages.BTCScriptConfig_SimpleType.P2TR;
    }
  }

  return constants.messages.BTCScriptConfig_SimpleType.P2WPKH;
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
  // Default to standard xpub/tpub
  return isTestnet
    ? constants.messages.BTCXPubType.TPUB
    : constants.messages.BTCXPubType.XPUB;
};

/**
 * Get coin constant from path
 */
export const getCoin = (path: string): number => {
  return isTestnetPath(path)
    ? constants.messages.BTCCoin.TBTC
    : constants.messages.BTCCoin.BTC;
};

/**
 * Get output type constant from address
 */
export const getOutputType = (address: string, network: bitcoin.Network): number => {
  // Try to decode as different address types
  try {
    const decoded = bitcoin.address.fromBech32(address);
    if (decoded.version === 0) {
      return decoded.data.length === 20
        ? constants.messages.BTCOutputType.P2WPKH
        : constants.messages.BTCOutputType.P2WSH;
    }
    if (decoded.version === 1) {
      return constants.messages.BTCOutputType.P2TR;
    }
  } catch (error) {
    log.debug('Address is not bech32 for BitBox output type detection', { error });
    // Not bech32
  }

  try {
    const decoded = bitcoin.address.fromBase58Check(address);
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

  // Default to P2WPKH
  return constants.messages.BTCOutputType.P2WPKH;
};
