/**
 * Wallets - XPUB Validation Router
 *
 * Utility endpoint for validating xpubs and generating descriptors
 */

import { Router } from 'express';
import { z } from 'zod';
import {
  WalletScriptType,
  type WalletScriptType as WalletScriptTypeValue,
} from '@sanctuary/shared/constants/walletIdentity';
import { MasterFingerprintSchema } from '@sanctuary/shared/schemas/deviceIdentity';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../errors/errorHandler';
import { ErrorCodes, InvalidInputError } from '../../errors/ApiError';
import * as addressDerivation from '../../services/bitcoin/addressDerivation';

const router = Router();

const ValidateXpubBodySchema = z.object({
  xpub: z.string().min(1, 'xpub is required'),
  scriptType: z.string().optional(),
  network: z.string().optional().default('mainnet'),
  fingerprint: MasterFingerprintSchema,
  accountPath: z.string().regex(
    /^(44|49|84|86)'\/[01]'\/\d+'$/,
    'Account path must be an exact hardened BIP44/49/84/86 account path',
  ),
});

const xpubValidationMessage = (issues: Array<{ path: string; message: string }>) => {
  /* v8 ignore next -- route schema tests cover xpub-specific validation messages */
  if (issues.some(issue => issue.path === 'xpub')) {
    return 'xpub is required';
  }
  /* v8 ignore next -- ZodError from safeParse has at least one issue */
  return issues[0]?.message ?? 'Invalid xpub request';
};

function parseSupportedScriptType(scriptType: string): WalletScriptTypeValue {
  if (Object.values(WalletScriptType).includes(scriptType as WalletScriptTypeValue)) {
    return scriptType as WalletScriptTypeValue;
  }
  throw new InvalidInputError('Invalid script type');
}

function expectedAccountPathPrefix(scriptType: WalletScriptTypeValue, network: string): string {
  const coinType = network === 'mainnet' ? "0'" : "1'";

  switch (scriptType) {
    case WalletScriptType.LEGACY:
      return `44'/${coinType}/`;
    case WalletScriptType.NESTED_SEGWIT:
      return `49'/${coinType}/`;
    case WalletScriptType.NATIVE_SEGWIT:
      return `84'/${coinType}/`;
    case WalletScriptType.TAPROOT:
      return `86'/${coinType}/`;
  }
}

function assertAccountPathMatchesPolicy(
  accountPath: string,
  scriptType: WalletScriptTypeValue,
  network: string,
): void {
  if (!accountPath.startsWith(expectedAccountPathPrefix(scriptType, network))) {
    throw new InvalidInputError('Account path does not match the selected script type and network');
  }
}

function buildMultipathDescriptor(
  scriptType: WalletScriptTypeValue,
  fingerprint: string,
  accountPath: string,
  xpub: string,
): string {
  const key = `[${fingerprint}/${accountPath}]${xpub}/<0;1>/*`;
  switch (scriptType) {
    case WalletScriptType.NATIVE_SEGWIT:
      return `wpkh(${key})`;
    case WalletScriptType.NESTED_SEGWIT:
      return `sh(wpkh(${key}))`;
    case WalletScriptType.TAPROOT:
      return `tr(${key})`;
    case WalletScriptType.LEGACY:
      return `pkh(${key})`;
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
  const detectedScriptType = parseSupportedScriptType(
    scriptType || validation.scriptType || WalletScriptType.NATIVE_SEGWIT,
  );

  // A single receive-only descriptor cannot be imported as a complete policy.
  // BIP389 multipath preserves the exact raw-key provenance in one token while
  // allowing import validation to expand receive branch 0 and change branch 1.
  assertAccountPathMatchesPolicy(accountPath, detectedScriptType, network);
  const descriptor = buildMultipathDescriptor(
    detectedScriptType,
    fingerprint,
    accountPath,
    xpub,
  );

  // Derive through the canonical descriptor path so the serialized extended
  // key depth and hardened child number are bound to the declared origin.
  let address: string;
  try {
    ({ address } = addressDerivation.deriveCanonicalAddress({
      receiveDescriptor: descriptor.replace('<0;1>', '0'),
      changeDescriptor: descriptor.replace('<0;1>', '1'),
    }, { branch: 0, index: 0, network }));
  } catch (error) {
    throw new InvalidInputError(
      error instanceof Error ? error.message : 'Extended key origin is invalid',
    );
  }

  res.json({
    valid: true,
    descriptor,
    scriptType: detectedScriptType,
    firstAddress: address,
    xpub,
    fingerprint,
    accountPath,
  });
}));

export default router;
