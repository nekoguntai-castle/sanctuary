/**
 * Wallets - XPUB Validation Router
 *
 * Utility endpoint for validating xpubs and generating descriptors
 */

import { Router } from 'express';
import { asyncHandler } from '../../errors/errorHandler';
import { InvalidInputError } from '../../errors/ApiError';
import * as addressDerivation from '../../services/bitcoin/addressDerivation';

const router = Router();

/**
 * Helper to get default account path based on script type and network
 */
function getDefaultAccountPath(scriptType: string, network: string): string {
  const coinType = network === 'mainnet' ? "0'" : "1'";

  switch (scriptType) {
    case 'legacy':
      return `44'/${coinType}/0'`;
    case 'nested_segwit':
      return `49'/${coinType}/0'`;
    case 'native_segwit':
      return `84'/${coinType}/0'`;
    case 'taproot':
      return `86'/${coinType}/0'`;
    default:
      return `84'/${coinType}/0'`;
  }
}

/**
 * POST /api/v1/wallets/validate-xpub
 * Validate an xpub and generate descriptor
 */
router.post('/validate-xpub', asyncHandler(async (req, res) => {
  const { xpub, scriptType, network = 'mainnet', fingerprint, accountPath } = req.body;

  if (!xpub) {
    throw new InvalidInputError('xpub is required');
  }

  // Validate xpub
  const validation = addressDerivation.validateXpub(xpub, network);

  if (!validation.valid) {
    throw new InvalidInputError(validation.error || 'Invalid xpub');
  }

  // Determine script type
  const detectedScriptType = scriptType || validation.scriptType || 'native_segwit';

  // Generate descriptor
  let descriptor: string;
  const fingerprintStr = fingerprint || '00000000';
  const accountPathStr = accountPath || getDefaultAccountPath(detectedScriptType, network);

  switch (detectedScriptType) {
    case 'native_segwit':
      descriptor = `wpkh([${fingerprintStr}/${accountPathStr}]${xpub}/0/*)`;
      break;
    case 'nested_segwit':
      descriptor = `sh(wpkh([${fingerprintStr}/${accountPathStr}]${xpub}/0/*))`;
      break;
    case 'taproot':
      descriptor = `tr([${fingerprintStr}/${accountPathStr}]${xpub}/0/*)`;
      break;
    case 'legacy':
      descriptor = `pkh([${fingerprintStr}/${accountPathStr}]${xpub}/0/*)`;
      break;
    default:
      throw new InvalidInputError('Invalid script type');
  }

  // Derive first address as example
  const { address } = addressDerivation.deriveAddress(xpub, 0, {
    scriptType: detectedScriptType,
    network,
    change: false,
  });

  res.json({
    valid: true,
    descriptor,
    scriptType: detectedScriptType,
    firstAddress: address,
    xpub,
    fingerprint: fingerprintStr,
    accountPath: accountPathStr,
  });
}));

export default router;
