/**
 * Bitcoin - Address Router
 *
 * Address validation, lookup, and sync operations
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/auth';
import * as blockchain from '../../services/bitcoin/blockchain';
import * as utils from '../../services/bitcoin/utils';
import { db as prisma } from '../../repositories/db';
import { asyncHandler } from '../../errors/errorHandler';
import { ValidationError, NotFoundError } from '../../errors/ApiError';

const router = Router();

/**
 * POST /api/v1/bitcoin/address/validate
 * Validate a Bitcoin address
 */
router.post('/address/validate', asyncHandler(async (req: Request, res: Response) => {
  const { address, network = 'mainnet' } = req.body;

  if (!address) {
    throw new ValidationError('address is required');
  }

  const result = await blockchain.checkAddress(address, network);

  res.json(result);
}));

/**
 * GET /api/v1/bitcoin/address/:address
 * Get address information from blockchain
 */
router.get('/address/:address', asyncHandler(async (req: Request, res: Response) => {
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
router.post('/address/:addressId/sync', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { addressId } = req.params;

  // Check user has access to address's wallet
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
router.post('/address-lookup', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const { addresses } = req.body;

  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new ValidationError('addresses must be a non-empty array');
  }

  // Limit the number of addresses to prevent abuse
  if (addresses.length > 100) {
    throw new ValidationError('Maximum 100 addresses per request');
  }

  const userId = req.user!.userId;

  // Find addresses that belong to wallets the user has access to
  const addressRecords = await prisma.address.findMany({
    where: {
      address: { in: addresses },
      wallet: {
        users: {
          some: {
            userId,
          },
        },
      },
    },
    select: {
      address: true,
      wallet: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

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
