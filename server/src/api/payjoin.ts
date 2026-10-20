/**
 * Payjoin API Routes (BIP78)
 *
 * Implements the Payjoin receiver endpoint for enhanced transaction privacy.
 * The endpoint validates an original PSBT from the sender, then answers with
 * the BIP78 `unavailable` error until receiver input signing is implemented.
 */

import express, { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { BITCOIN_NETWORKS } from '@sanctuary/shared/constants/bitcoin';
import { authenticate, requireAuthenticatedUser } from '../middleware/auth';
import { requireFeature, isFeatureEnabledAsync } from '../middleware/featureGate';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../errors/errorHandler';
import { ErrorCodes, InvalidInputError, NotFoundError } from '../errors/ApiError';
import { findByIdWithAccess } from '../repositories/walletRepository';
import { findByIdWithAccess as findAddressByIdWithAccess } from '../repositories/addressRepository';
import { countEligibility } from '../repositories/utxoRepository';
import { requireWalletEditAccess } from '../services/accessControl';
import { createLogger } from '../utils/logger';
import { getConfig } from '../config';
import { rateLimitByIpAndKey } from '../middleware/rateLimit';
import {
  processPayjoinRequest,
  PayjoinErrors,
  parseBip21Uri,
  generateBip21Uri,
} from '../services/payjoinService';
import { parsePayjoinMinFeeRate } from '../services/payjoin/validation';
import { attemptPayjoinWithSignedOriginal } from '../services/payjoin/attempt';
import { restorePayjoinOriginalIntent } from '../services/payjoin/originalIntent';
import { assertFreshReceiveAddressSafeForDisplay } from '../services/addressDisplaySafety';
import { loadSigningIntent } from '../services/bitcoin/signingIntent/service';

const log = createLogger('PAYJOIN:ROUTE');

const router = Router();
export const PAYJOIN_RECEIVER_BODY_LIMIT_BYTES = 100 * 1024;

const ParseUriBodySchema = z.object({
  uri: z.string().min(1),
});

const NonnegativeSafeIntegerStringSchema = z.string()
  .refine(
    value => /^(0|[1-9]\d*)$/.test(value)
      && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER),
  )
  .transform(value => Number(value));

const PayjoinUriQuerySchema = z.object({
  amount: NonnegativeSafeIntegerStringSchema.optional(),
  label: z.string().optional(),
  message: z.string().optional(),
});

const AttemptPayjoinBodySchema = z.object({
  walletId: z.string().min(1, 'walletId is required'),
  signedPsbt: z.string().min(1, 'signedPsbt is required'),
  intentId: z.string().min(1, 'intentId is required'),
  intentDigest: z.string().regex(/^[0-9a-f]{64}$/, 'intentDigest is invalid'),
  payjoinUrl: z.string().min(1, 'payjoinUrl is required').url('payjoinUrl must be a valid URL'),
  network: z.enum(BITCOIN_NETWORKS).optional(),
}).strict();

type AttemptPayjoinBody = z.infer<typeof AttemptPayjoinBodySchema>;

const attemptPayjoinRequiredFields = ['walletId', 'signedPsbt', 'intentId', 'intentDigest', 'payjoinUrl'];

const isMissingAttemptPayjoinField = (issue: { path: string; message: string }) => (
  attemptPayjoinRequiredFields.includes(issue.path)
  && (
    issue.message.includes('required')
    || issue.message.includes('received undefined')
    || issue.message.includes('Too small')
  )
);

const attemptPayjoinValidationMessage = (issues: Array<{ path: string; message: string }>) => {
  if (issues.some(issue => issue.path === 'network')) {
    return 'Invalid network. Must be mainnet, testnet3, testnet4, signet, or regtest';
  }
  if (issues.some(isMissingAttemptPayjoinField)) {
    return 'walletId, signedPsbt, signing intent, and payjoinUrl are required';
  }
  if (issues.some(issue => issue.path === 'payjoinUrl')) {
    return 'payjoinUrl must be a valid URL';
  }
  return 'Invalid Payjoin attempt request';
};

const ReleaseOriginalBodySchema = z.object({
  walletId: z.string().min(1, 'walletId is required'),
  intentId: z.string().min(1, 'intentId is required'),
  intentDigest: z.string().regex(/^[0-9a-f]{64}$/, 'intentDigest is invalid'),
}).strict();

type ReleaseOriginalBody = z.infer<typeof ReleaseOriginalBodySchema>;

// Rate limiter for unauthenticated BIP78 endpoint
// Prevents DoS attacks by limiting requests per addressId
const payjoinRateLimiter = rateLimitByIpAndKey(
  'payjoin:create',
  (req) => req.params.addressId as string,
  { message: PayjoinErrors.RECEIVER_ERROR, responseType: 'text', contentType: 'text/plain' }
);

type BodyParserError = Error & {
  status?: number;
  type?: string;
};

const payjoinTextBodyParser = express.text({
  type: 'text/plain',
  limit: PAYJOIN_RECEIVER_BODY_LIMIT_BYTES,
});

const parsePayjoinTextBody: RequestHandler = (req, res, next) => {
  payjoinTextBodyParser(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }

    const parserError = error as BodyParserError;
    const status = parserError.status === 413 ? 413 : 400;

    log.warn('Payjoin text body rejected by parser', {
      status,
      type: parserError.type,
      message: String(error),
    });
    res.status(status).type('text/plain').send(PayjoinErrors.ORIGINAL_PSBT_REJECTED);
  });
};

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
router.get('/address/:addressId/uri', authenticate, requireFeature('payjoinSupport'), validate(
  { query: PayjoinUriQuerySchema },
  { message: 'Invalid Payjoin URI query', code: ErrorCodes.INVALID_INPUT }
), asyncHandler(async (req, res) => {
  const { addressId } = req.params;
  const { amount, label, message } = req.query;
  const userId = requireAuthenticatedUser(req).userId;

  // Get address and verify access
  const address = await findAddressByIdWithAccess(addressId, userId);

  if (!address) {
    throw new NotFoundError('Address not found or access denied');
  }
  await assertFreshReceiveAddressSafeForDisplay(address.walletId, address);

  // Generate Payjoin URL using configured public URL or fallback to request host
  const config = getConfig();
  const baseUrl = config.payjoin.publicUrl || `${req.protocol}://${req.get('host')}`;
  const payjoinUrl = `${baseUrl}/api/v1/payjoin/${addressId}`;

  const uri = generateBip21Uri(address.address, {
    amount: amount as number | undefined,
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
 * BIP78 round one: the client sends the signed (not finalized) original for an
 * authenticated intent. The server verifies it exactly as broadcast would,
 * refuses ineligible wallets and policies before it leaves (C-D3/C-D8), posts
 * a finalized BIP78 original with `disableoutputsubstitution=true`, and
 * validates the proposal against the BIP78 senders' checklist: sender inputs
 * unfinalized (their stripped prevouts are restored from the original),
 * receiver inputs finalized P2WPKH/P2TR of the sender's script type, no key
 * paths or signatures, no sighash type other than ALL, one sequence, at least
 * one receiver input, and at least the original's fee rate (sent as BIP78
 * `minfeerate`). A payjoin proposal intent cannot be an original (409).
 * A valid proposal becomes a replacement intent; the response proposal has the
 * receiver's final fields stripped for round two and cannot be saved as a
 * draft. Every fallback answers `{ success: false, isPayjoin: false, error }`.
 */
router.post('/attempt', authenticate, requireFeature('payjoinSupport'), validate(
  { body: AttemptPayjoinBodySchema },
  { message: attemptPayjoinValidationMessage, code: ErrorCodes.INVALID_INPUT }
), asyncHandler(async (req, res) => {
  const body = req.body as AttemptPayjoinBody;
  const { walletId, intentId, intentDigest } = body;
  const userId = requireAuthenticatedUser(req).userId;
  const wallet = await findByIdWithAccess(walletId, userId);
  if (!wallet) throw new NotFoundError('Wallet not found or access denied');
  await requireWalletEditAccess(walletId, userId);
  // A consumed intent loads (as a replay) so the service can answer 409 already_broadcast.
  const original = await loadSigningIntent(
    { intentId, intentDigest },
    walletId,
    { allowConsumedBroadcastReplay: true, allowLiveDraftExtension: true },
  );
  res.json(await attemptPayjoinWithSignedOriginal({
    walletId,
    userId,
    walletNetwork: wallet.network,
    original,
    body,
  }));
}));

/**
 * POST /api/v1/payjoin/release-original
 * Make the signed original broadcastable again after an abandoned or failed
 * payjoin round. Answers `{ restored }`; 409 while the proposal's broadcast is
 * claimed or its outcome unknown, so both can never be broadcast.
 * Deliberately not behind requireFeature('payjoinSupport'): turning the flag
 * off while a proposal is pending must not strand the original.
 */
router.post('/release-original', authenticate, validate(
  { body: ReleaseOriginalBodySchema },
  { message: 'walletId and signing intent are required', code: ErrorCodes.INVALID_INPUT }
), asyncHandler(async (req, res) => {
  const { walletId, intentId, intentDigest } = req.body as ReleaseOriginalBody;
  const userId = requireAuthenticatedUser(req).userId;
  const wallet = await findByIdWithAccess(walletId, userId);
  if (!wallet) throw new NotFoundError('Wallet not found or access denied');
  await requireWalletEditAccess(walletId, userId);
  res.json(await restorePayjoinOriginalIntent({ walletId, intentId, intentDigest }));
}));

// ========================================
// BIP78 Payjoin endpoint (unauthenticated)
// ========================================

/**
 * POST /api/v1/payjoin/:addressId
 * BIP78 Payjoin endpoint (receiver)
 *
 * This endpoint is called by Payjoin-capable senders.
 * It validates the original PSBT (every input finalized with UTXO data, as
 * BIP78 requires) and returns precise BIP78 rejections for bad originals.
 * Valid originals get `unavailable`: a proposal needs a finalized receiver
 * input, and receiver-side input signing is not implemented yet.
 *
 * IMPORTANT: This route MUST be defined after all specific POST routes (/parse-uri, /attempt, /release-original)
 * to avoid the parameterized :addressId from capturing those paths.
 *
 * Query params:
 *   v=1 (required) - Protocol version
 *   minfeerate (optional) - Minimum fee rate in sat/vB
 *   maxadditionalfeecontribution (optional) - Max additional fee receiver will pay
 *
 * Body: Original PSBT (text/plain, base64, 100 KiB max)
 * Returns: BIP78 error (text/plain); `unavailable` for a valid original until
 *          receiver signing lands, after which a signed proposal PSBT
 */
router.post('/:addressId', async (req, res, next) => {
  const enabled = await isFeatureEnabledAsync('payjoinSupport');
  /* v8 ignore next -- feature-gate middleware covers disabled feature responses */
  if (!enabled) {
    return res.status(403).type('text/plain').send(PayjoinErrors.RECEIVER_ERROR);
  }
  next();
}, payjoinRateLimiter, parsePayjoinTextBody, async (req, res) => {
  const addressId = req.params.addressId as string;
  const { v, minfeerate, maxadditionalfeecontribution } = req.query;

  // BIP78 requires v=1
  if (v !== '1') {
    log.warn('Unsupported Payjoin protocol version', { version: v });
    return res.status(400).type('text/plain').send(PayjoinErrors.VERSION_UNSUPPORTED);
  }

  const minFeeRate = parsePayjoinMinFeeRate(minfeerate);
  // The receiver cannot yet enforce a sender-provided fee-contribution cap
  // through proposal construction, so fail closed instead of silently ignoring
  // that optional BIP78 parameter and violating the sender's expectation.
  if (minFeeRate === null || maxadditionalfeecontribution !== undefined) {
    log.warn('Invalid or unsupported Payjoin receiver query');
    return res.status(400).type('text/plain').send(PayjoinErrors.ORIGINAL_PSBT_REJECTED);
  }

  // Get the PSBT from the route-local text parser. Wrong or missing content
  // types must not be coerced from JSON/form bodies into BIP78 payloads.
  const originalPsbt = typeof req.body === 'string' ? req.body : undefined;

  if (!originalPsbt || originalPsbt.length === 0) {
    log.warn('Empty PSBT in Payjoin request');
    return res.status(400).type('text/plain').send(PayjoinErrors.ORIGINAL_PSBT_REJECTED);
  }

  try {
    const result = await processPayjoinRequest(
      addressId,
      originalPsbt,
      minFeeRate
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
