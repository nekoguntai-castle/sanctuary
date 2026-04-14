/**
 * Bitcoin - Address Router
 *
 * Address validation, lookup, and sync operations
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import * as blockchain from '../../services/bitcoin/blockchain';
import * as utils from '../../services/bitcoin/utils';
import { addressRepository } from '../../repositories';
import { asyncHandler } from '../../errors/errorHandler';
import { ValidationError, NotFoundError } from '../../errors/ApiError';

const router = Router();

const AddressValidateBodySchema = z.object({
  address: z.string().min(1),
  network: z.string().optional().default('mainnet'),
});

const AddressLookupBodySchema = z.object({
  addresses: z.array(z.string())
    .min(1, 'addresses must be a non-empty array')
    .max(100, 'Maximum 100 addresses per request'),
});

const addressLookupValidationMessage = (issues: Array<{ message: string }>) => {
  if (issues.some(issue => issue.message === 'Maximum 100 addresses per request')) {
    return 'Maximum 100 addresses per request';
  }
  return 'addresses must be a non-empty array';
};

/**
 * POST /api/v1/bitcoin/address/validate
 * Validate a Bitcoin address
 */
router.post('/address/validate', validate(
  { body: AddressValidateBodySchema },
  { message: 'address is required' }
), asyncHandler(async (req, res) => {
  const { address, network = 'mainnet' } = req.body;

  const result = await blockchain.checkAddress(address, network);

  res.json(result);
}));

/**
 * GET /api/v1/bitcoin/address/:address
 * Get address information from blockchain
 */
router.get('/address/:address', asyncHandler(async (req, res) => {
  const { address } = req.params;
  const networkParam = req.query.network as string | undefined;
  const network: 'mainnet' | 'testnet' | 'regtest' =
    networkParam === 'testnet' ? 'testnet' :
    networkParam === 'regtest' ? 'regtest' : 'mainnet';

  const result = await blockchain.checkAddress(address, network);

  if (!result.valid) {
    throw new ValidationError(result.error || 'Invalid address');
  }

  res.json({
    address,
    balance: result.balance || 0,
    transactionCount: result.transactionCount || 0,
    type: utils.getAddressType(address),
  });
}));

/**
 * POST /api/v1/bitcoin/address/:addressId/sync
 * Sync single address with blockchain
 */
router.post('/address/:addressId/sync', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { addressId } = req.params;

  // Check user has access to address's wallet
  const address = await addressRepository.findByIdWithAccess(addressId, userId);

  if (!address) {
    throw new NotFoundError('Address not found');
  }

  const result = await blockchain.syncAddress(addressId);

  res.json({
    message: 'Address synced successfully',
    ...result,
  });
}));

/**
 * POST /api/v1/bitcoin/address-lookup
 * Look up which wallets own given addresses (for internal wallet detection in send flow)
 */
router.post('/address-lookup', authenticate, validate(
  { body: AddressLookupBodySchema },
  { message: addressLookupValidationMessage }
), asyncHandler(async (req, res) => {
  const { addresses } = req.body;

  const userId = req.user!.userId;

  // Find addresses that belong to wallets the user has access to
  const addressRecords = await addressRepository.findByAddressesForUser(addresses, userId);

  // Build lookup map: address -> { walletId, walletName }
  const lookup: Record<string, { walletId: string; walletName: string }> = {};
  for (const record of addressRecords) {
    lookup[record.address] = {
      walletId: record.wallet.id,
      walletName: record.wallet.name,
    };
  }

  res.json({ lookup });
}));

export default router;
