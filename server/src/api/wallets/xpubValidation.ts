/**
 * Wallets - XPUB Validation Router
 *
 * Utility endpoint for validating xpubs and generating descriptors
 */

import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../errors/errorHandler';
import { ErrorCodes, InvalidInputError } from '../../errors/ApiError';
import * as addressDerivation from '../../services/bitcoin/addressDerivation';

const router = Router();

const ValidateXpubBodySchema = z.object({
  xpub: z.string().min(1, 'xpub is required'),
  scriptType: z.string().optional(),
  network: z.string().optional().default('mainnet'),
  fingerprint: z.string().optional(),
  accountPath: z.string().optional(),
});

const xpubValidationMessage = (issues: Array<{ path: string; message: string }>) => {
  /* v8 ignore next -- route schema tests cover xpub-specific validation messages */
  if (issues.some(issue => issue.path === 'xpub')) {
    return 'xpub is required';
  }
  /* v8 ignore next -- ZodError from safeParse has at least one issue */
  return issues[0]?.message ?? 'Invalid xpub request';
};

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
router.post('/validate-xpub', validate(
  { body: ValidateXpubBodySchema },
  { message: xpubValidationMessage, code: ErrorCodes.INVALID_INPUT }
), asyncHandler(async (req, res) => {
  const { xpub, scriptType, network = 'mainnet', fingerprint, accountPath } = req.body;

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
