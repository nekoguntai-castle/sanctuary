/**
 * Payjoin API Routes (BIP78)
 *
 * Implements the Payjoin receiver endpoint for enhanced transaction privacy.
 * The endpoint accepts an original PSBT from the sender and returns a
 * modified PSBT with the receiver's input added.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAuthenticatedUser } from '../middleware/auth';
import { requireFeature, isFeatureEnabledAsync } from '../middleware/featureGate';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../errors/errorHandler';
import { ErrorCodes, InvalidInputError, NotFoundError } from '../errors/ApiError';
import { findByIdWithAccess } from '../repositories/walletRepository';
import { findByIdWithAccess as findAddressByIdWithAccess } from '../repositories/addressRepository';
import { countEligibility } from '../repositories/utxoRepository';
import { createLogger } from '../utils/logger';
import { getConfig } from '../config';
import { rateLimitByIpAndKey } from '../middleware/rateLimit';
import {
  processPayjoinRequest,
  PayjoinErrors,
  parseBip21Uri,
  generateBip21Uri,
  attemptPayjoinSend,
} from '../services/payjoinService';
import { getNetwork } from '../services/bitcoin/utils';

const log = createLogger('PAYJOIN:ROUTE');

const router = Router();

const ParseUriBodySchema = z.object({
  uri: z.string().min(1),
});

const AttemptPayjoinBodySchema = z.object({
  psbt: z.unknown(),
  payjoinUrl: z.unknown(),
  network: z.unknown().optional(),
}).superRefine((data, ctx) => {
  if (!data.psbt || !data.payjoinUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'psbt and payjoinUrl are required',
      path: ['psbt'],
    });
    return;
  }

  if (data.network && !['mainnet', 'testnet', 'regtest'].includes(data.network as string)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Invalid network. Must be mainnet, testnet, or regtest',
      path: ['network'],
    });
  }
});

const attemptPayjoinValidationMessage = (issues: Array<{ message: string }>) => (
  issues.some(issue => issue.message === 'Invalid network. Must be mainnet, testnet, or regtest')
    ? 'Invalid network. Must be mainnet, testnet, or regtest'
    : 'psbt and payjoinUrl are required'
);

// Rate limiter for unauthenticated BIP78 endpoint
// Prevents DoS attacks by limiting requests per addressId
const payjoinRateLimiter = rateLimitByIpAndKey(
  'payjoin:create',
  (req) => req.params.addressId as string,
  { message: PayjoinErrors.RECEIVER_ERROR, responseType: 'text', contentType: 'text/plain' }
);

// ========================================
// Authenticated endpoints for wallet management
// ========================================

/**
 * GET /api/v1/payjoin/status
 * Check if Payjoin is enabled and properly configured
 * NOT gated by requireFeature so the frontend can determine visibility
 */
router.get('/status', authenticate, asyncHandler(async (_req, res) => {
  const enabled = await isFeatureEnabledAsync('payjoinSupport');
  const config = getConfig();
  const configured = !!config.payjoin.publicUrl;

  res.json({ enabled, configured });
}));

/**
 * GET /api/v1/payjoin/eligibility/:walletId
 * Check if wallet is eligible for Payjoin receives
 */
router.get('/eligibility/:walletId', authenticate, requireFeature('payjoinSupport'), asyncHandler(async (req, res) => {
  const { walletId } = req.params;
  const userId = requireAuthenticatedUser(req).userId;

  // Verify wallet access
  const wallet = await findByIdWithAccess(walletId, userId);

  if (!wallet) {
    throw new NotFoundError('Wallet not found or access denied');
  }

  // Count UTXOs by eligibility status
  const { eligible: eligibleCount, total: totalCount, frozen: frozenCount, unconfirmed: unconfirmedCount, locked: lockedCount } = await countEligibility(walletId);

  // Determine status and reason
  let status: string;
  let reason: string | null = null;

  if (eligibleCount > 0) {
    status = 'ready';
  } else if (totalCount === 0) {
    status = 'no-utxos';
    reason = 'You need bitcoin in this wallet to enable Payjoin.';
  } else if (frozenCount === totalCount) {
    status = 'all-frozen';
    reason = 'All coins are frozen. Unfreeze at least one to enable Payjoin.';
  } else if (unconfirmedCount > 0 && unconfirmedCount + frozenCount + lockedCount >= totalCount) {
    status = 'pending-confirmations';
    reason = 'Waiting for confirmations. Your coins need at least 1 confirmation.';
  } else if (lockedCount > 0 && lockedCount + frozenCount >= totalCount) {
    status = 'all-locked';
    reason = 'All coins are locked by draft transactions.';
  } else {
    status = 'unavailable';
    reason = 'No eligible coins available.';
  }

  res.json({
    eligible: eligibleCount > 0,
    status,
    eligibleUtxoCount: eligibleCount,
    totalUtxoCount: totalCount,
    reason,
  });
}));

/**
 * GET /api/v1/payjoin/address/:addressId/uri
 * Generate a BIP21 URI with Payjoin endpoint for an address
 */
router.get('/address/:addressId/uri', authenticate, requireFeature('payjoinSupport'), asyncHandler(async (req, res) => {
  const { addressId } = req.params;
  const { amount, label, message } = req.query;
  const userId = requireAuthenticatedUser(req).userId;

  // Get address and verify access
  const address = await findAddressByIdWithAccess(addressId, userId);

  if (!address) {
    throw new NotFoundError('Address not found or access denied');
  }

  // Generate Payjoin URL using configured public URL or fallback to request host
  const config = getConfig();
  const baseUrl = config.payjoin.publicUrl || `${req.protocol}://${req.get('host')}`;
  const payjoinUrl = `${baseUrl}/api/v1/payjoin/${addressId}`;

  const uri = generateBip21Uri(address.address, {
    amount: amount ? parseInt(amount as string, 10) : undefined,
    label: label as string,
    message: message as string,
    payjoinUrl,
  });

  res.json({
    uri,
    address: address.address,
    payjoinUrl,
  });
}));

/**
 * POST /api/v1/payjoin/parse-uri
 * Parse a BIP21 URI to extract address and Payjoin URL
 */
router.post('/parse-uri', authenticate, requireFeature('payjoinSupport'), validate(
  { body: ParseUriBodySchema },
  { message: 'URI is required', code: ErrorCodes.INVALID_INPUT }
), asyncHandler(async (req, res) => {
  const { uri } = req.body;

  let parsed;
  try {
    parsed = parseBip21Uri(uri);
  } catch {
    throw new InvalidInputError('Invalid URI format');
  }

  res.json({
    address: parsed.address,
    amount: parsed.amount,
    label: parsed.label,
    message: parsed.message,
    payjoinUrl: parsed.payjoinUrl,
    hasPayjoin: !!parsed.payjoinUrl,
  });
}));

/**
 * POST /api/v1/payjoin/attempt
 * Attempt to perform a Payjoin send
 */
router.post('/attempt', authenticate, requireFeature('payjoinSupport'), validate(
  { body: AttemptPayjoinBodySchema },
  { message: attemptPayjoinValidationMessage, code: ErrorCodes.INVALID_INPUT }
), asyncHandler(async (req, res) => {
  const { psbt, payjoinUrl, network } = req.body;

  // Use provided network or default to mainnet
  const networkStr = (network || 'mainnet') as 'mainnet' | 'testnet' | 'regtest';
  const networkObj = getNetwork(networkStr);

  const result = await attemptPayjoinSend(
    psbt,
    payjoinUrl,
    [0], // Assume first input is sender's
    networkObj
  );

  res.json(result);
}));

// ========================================
// BIP78 Payjoin endpoint (unauthenticated)
// ========================================

/**
 * POST /api/v1/payjoin/:addressId
 * BIP78 Payjoin endpoint (receiver)
 *
 * This endpoint is called by Payjoin-capable senders.
 * It processes the original PSBT and returns a proposal with the receiver's input added.
 *
 * IMPORTANT: This route MUST be defined after all specific POST routes (/parse-uri, /attempt)
 * to avoid the parameterized :addressId from capturing those paths.
 *
 * Query params:
 *   v=1 (required) - Protocol version
 *   minfeerate (optional) - Minimum fee rate in sat/vB
 *   maxadditionalfeecontribution (optional) - Max additional fee receiver will pay
 *
 * Body: Original PSBT (text/plain, base64)
 * Returns: Proposal PSBT (text/plain, base64)
 */
router.post('/:addressId', async (req, res, next) => {
  const enabled = await isFeatureEnabledAsync('payjoinSupport');
  /* v8 ignore next -- feature-gate middleware covers disabled feature responses */
  if (!enabled) {
    return res.status(403).type('text/plain').send(PayjoinErrors.RECEIVER_ERROR);
  }
  next();
}, payjoinRateLimiter, async (req, res) => {
  const addressId = req.params.addressId as string;
  const { v, minfeerate } = req.query;

  // BIP78 requires v=1
  if (v !== '1') {
    log.warn('Unsupported Payjoin protocol version', { version: v });
    return res.status(400).type('text/plain').send(PayjoinErrors.VERSION_UNSUPPORTED);
  }

  // Get the PSBT from body (raw text)
  const originalPsbt = typeof req.body === 'string'
    ? req.body
    : req.body?.toString?.();

  if (!originalPsbt || originalPsbt.length === 0) {
    log.warn('Empty PSBT in Payjoin request');
    return res.status(400).type('text/plain').send(PayjoinErrors.ORIGINAL_PSBT_REJECTED);
  }

  try {
    const result = await processPayjoinRequest(
      addressId,
      originalPsbt,
      parseFloat(minfeerate as string) || 1
    );

    if (!result.success) {
      log.info('Payjoin request rejected', {
        addressId,
        error: result.error,
        message: result.errorMessage,
      });
      return res.status(400).type('text/plain').send(result.error || PayjoinErrors.RECEIVER_ERROR);
    }

    log.info('Payjoin proposal sent', { addressId });
    res.type('text/plain').send(result.proposalPsbt);
  } catch (err) {
    log.error('Payjoin endpoint error', { error: String(err) });
    res.status(500).type('text/plain').send(PayjoinErrors.RECEIVER_ERROR);
  }
});

export default router;
