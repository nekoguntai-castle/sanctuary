/**
 * Descriptor Utilities
 *
 * Low-level utility functions for parsing Bitcoin output descriptors:
 * network detection, key expression parsing, script type detection, etc.
 */

import { parseDerivationPath } from '@sanctuary/shared/utils/bitcoin';
import type { DetectedNetwork } from './types';

/**
 * Detect network from xpub prefix or derivation path
 */
export function detectNetwork(xpub: string, derivationPath: string): DetectedNetwork {
  const parsedPath = parseDerivationPath(derivationPath);
  if (parsedPath.valid && parsedPath.coinType === 1) {
    return 'testnet';
  }

  // Check xpub prefix for testnet/regtest
  if (
    xpub.startsWith('tpub')
    || xpub.startsWith('upub')
    || xpub.startsWith('vpub')
    || xpub.startsWith('Upub')
    || xpub.startsWith('Vpub')
  ) {
    return 'testnet';
  }

  return 'mainnet';
}
