/**
 * Payjoin API Routes (BIP78)
 *
 * Implements the Payjoin receiver endpoint for enhanced transaction privacy.
 * The endpoint accepts an original PSBT from the sender and returns a
 * modified PSBT with the receiver's input added.
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requireFeature, isFeatureEnabledAsync } from '../middleware/featureGate';
import { db as prisma } from '../repositories/db';
import { createLogger } from '../utils/logger';
import { getConfig } from '../config';
import { rateLimitByIpAndKey } from '../middleware/rateLimit';
import {
  processPayjoinRequest,
  PayjoinErrors,
  parseBip21Uri,
  generateBip21Uri,
} from '../services/payjoinService';

const log = createLogger('PAYJOIN-API');

const router = Router();

// Rate limiter for unauthenticated BIP78 endpoint
// Prevents DoS attacks by limiting requests per addressId
const payjoinRateLimiter = rateLimitByIpAndKey(
  'payjoin:create',
  (req) => req.params.addressId,
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
router.get('/status', authenticate, async (_req: Request, res: Response) => {
  try {
    const enabled = await isFeatureEnabledAsync('payjoinSupport');
    const config = getConfig();
    const configured = !!config.payjoin.publicUrl;

    res.json({ enabled, configured });
  } catch (error) {
    log.error('Error checking Payjoin status', { error: String(error) });
    res.status(500).json({ error: 'Failed to check Payjoin status' });
  }
});

/**
 * GET /api/v1/payjoin/eligibility/:walletId
 * Check if wallet is eligible for Payjoin receives
 */
router.get('/eligibility/:walletId', authenticate, requireFeature('payjoinSupport'), async (req: Request, res: Response) => {
  try {
    const { walletId } = req.params;
    const userId = req.user?.userId;

    // Verify wallet access
    const wallet = await prisma.wallet.findFirst({
      where: {
        id: walletId,
        OR: [
          { users: { some: { userId } } },
          { group: { members: { some: { userId } } } },
        ],
      },
    });

    if (!wallet) {
      return res.status(404).json({ error: 'Wallet not found or access denied' });
    }

    // Count UTXOs by eligibility status
    const [eligibleCount, totalCount, frozenCount, unconfirmedCount, lockedCount] = await Promise.all([
      // Eligible: confirmed, not frozen, not locked
      prisma.uTXO.count({
        where: {
          walletId,
          spent: false,
          frozen: false,
          confirmations: { gt: 0 },
          draftLock: null,
        },
      }),
      // Total unspent
      prisma.uTXO.count({
        where: { walletId, spent: false },
      }),
      // Frozen
      prisma.uTXO.count({
        where: { walletId, spent: false, frozen: true },
      }),
      // Unconfirmed
      prisma.uTXO.count({
        where: { walletId, spent: false, confirmations: 0 },
      }),
      // Locked by draft
      prisma.uTXO.count({
        where: { walletId, spent: false, draftLock: { isNot: null } },
      }),
    ]);

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
  } catch (error) {
    log.error('Error checking Payjoin eligibility', { error: String(error) });
    res.status(500).json({ error: 'Failed to check eligibility' });
  }
});

/**
 * GET /api/v1/payjoin/address/:addressId/uri
 * Generate a BIP21 URI with Payjoin endpoint for an address
 */
router.get('/address/:addressId/uri', authenticate, requireFeature('payjoinSupport'), async (req: Request, res: Response) => {
  try {
    const { addressId } = req.params;
    const { amount, label, message } = req.query;
    const userId = req.user?.userId;

    // Get address and verify access
    const address = await prisma.address.findFirst({
      where: {
        id: addressId,
        wallet: {
          OR: [
            { users: { some: { userId } } },
            { group: { members: { some: { userId } } } },
          ],
        },
      },
    });

    if (!address) {
      return res.status(404).json({ error: 'Address not found or access denied' });
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
  } catch (error) {
    log.error('Error generating Payjoin URI', { error: String(error) });
    res.status(500).json({ error: 'Failed to generate Payjoin URI' });
  }
});

/**
 * POST /api/v1/payjoin/parse-uri
 * Parse a BIP21 URI to extract address and Payjoin URL
 */
router.post('/parse-uri', authenticate, requireFeature('payjoinSupport'), async (req: Request, res: Response) => {
  try {
    const { uri } = req.body;

    if (!uri || typeof uri !== 'string') {
      return res.status(400).json({ error: 'URI is required' });
    }

    const parsed = parseBip21Uri(uri);

    res.json({
      address: parsed.address,
      amount: parsed.amount,
      label: parsed.label,
      message: parsed.message,
      payjoinUrl: parsed.payjoinUrl,
      hasPayjoin: !!parsed.payjoinUrl,
    });
  } catch (error) {
    log.error('Error parsing BIP21 URI', { error: String(error) });
    res.status(400).json({ error: 'Invalid URI format' });
  }
});

/**
 * POST /api/v1/payjoin/attempt
 * Attempt to perform a Payjoin send
 */
router.post('/attempt', authenticate, requireFeature('payjoinSupport'), async (req: Request, res: Response) => {
  try {
    const { psbt, payjoinUrl, network } = req.body;

    if (!psbt || !payjoinUrl) {
      return res.status(400).json({ error: 'psbt and payjoinUrl are required' });
    }

    // Validate network parameter
    if (network && !['mainnet', 'testnet', 'regtest'].includes(network)) {
      return res.status(400).json({ error: 'Invalid network. Must be mainnet, testnet, or regtest' });
    }

    const payjoinService = await import('../services/payjoinService');
    const { getNetwork } = await import('../services/bitcoin/utils');

    // Use provided network or default to mainnet
    const networkStr = (network || 'mainnet') as 'mainnet' | 'testnet' | 'regtest';
    const networkObj = getNetwork(networkStr);

    const result = await payjoinService.attemptPayjoinSend(
      psbt,
      payjoinUrl,
      [0], // Assume first input is sender's
      networkObj
    );

    res.json(result);
  } catch (error) {
    log.error('Error attempting Payjoin', { error: String(error) });
    res.status(500).json({ error: 'Payjoin attempt failed' });
  }
});

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
router.post('/:addressId', async (req: Request, res: Response, next) => {
  const enabled = await isFeatureEnabledAsync('payjoinSupport');
  if (!enabled) {
    return res.status(403).type('text/plain').send(PayjoinErrors.RECEIVER_ERROR);
  }
  next();
}, payjoinRateLimiter, async (req: Request, res: Response) => {
  const { addressId } = req.params;
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
