/**
 * Transactions - Address Router
 *
 * Endpoints for listing and generating wallet addresses
 */

import { Router } from 'express';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { db as prisma } from '../../repositories/db';
import * as addressDerivation from '../../services/bitcoin/addressDerivation';
import { createLogger } from '../../utils/logger';
import { bigIntToNumberOrZero, validatePagination, getErrorMessage } from '../../utils/errors';
import { asyncHandler } from '../../errors/errorHandler';
import { NotFoundError, ValidationError } from '../../errors/ApiError';
import { INITIAL_ADDRESS_COUNT } from '../../constants';

const router = Router();
const log = createLogger('ADDRESS:ROUTE');

/**
 * GET /api/v1/wallets/:walletId/addresses
 * Get all addresses for a wallet
 * Auto-generates addresses if wallet has descriptor but no addresses
 */
router.get('/wallets/:walletId/addresses', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const { used, change } = req.query;
  const hasPagination = req.query.limit !== undefined || req.query.offset !== undefined;
  const DEFAULT_UNPAGED_LIMIT = 1000;
  const { limit, offset } = validatePagination(
    req.query.limit as string,
    req.query.offset as string,
    DEFAULT_UNPAGED_LIMIT
  );
  const effectiveLimit = hasPagination ? limit : DEFAULT_UNPAGED_LIMIT;
  const effectiveOffset = hasPagination ? offset : 0;

  // Get wallet for descriptor
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: { descriptor: true, network: true },
  });

  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }

  // Build derivation path filter for change/receive filtering.
  // BIP-44/48/84 paths end with /<change>/<index> where change is 0 (receive) or 1 (change).
  // The `contains` match is safe because coin-type segments use apostrophes (/1'/) which
  // don't match the bare /1/ pattern.
  const changeFilter = change !== undefined
    ? { derivationPath: { contains: change === 'true' ? '/1/' : '/0/' } }
    : {};

  // Check if addresses exist
  let addresses = await prisma.address.findMany({
    where: {
      walletId,
      ...(used !== undefined && { used: used === 'true' }),
      ...changeFilter,
    },
    include: {
      addressLabels: {
        include: {
          label: true,
        },
      },
    },
    orderBy: { index: 'asc' },
    take: effectiveLimit,
    skip: effectiveOffset,
  });

  // Auto-generate addresses if none exist and wallet has a descriptor
  if (addresses.length === 0 && wallet.descriptor && used === undefined) {
    try {
      const addressesToCreate = [];

      // Generate receive addresses (change = 0)
      for (let i = 0; i < INITIAL_ADDRESS_COUNT; i++) {
        const { address, derivationPath } = addressDerivation.deriveAddressFromDescriptor(
          wallet.descriptor,
          i,
          {
            network: wallet.network as 'mainnet' | 'testnet' | 'regtest',
            change: false, // External/receive addresses
          }
        );
        addressesToCreate.push({
          walletId,
          address,
          derivationPath,
          index: i,
          used: false,
        });
      }

      // Generate change addresses (change = 1)
      for (let i = 0; i < INITIAL_ADDRESS_COUNT; i++) {
        const { address, derivationPath } = addressDerivation.deriveAddressFromDescriptor(
          wallet.descriptor,
          i,
          {
            network: wallet.network as 'mainnet' | 'testnet' | 'regtest',
            change: true, // Internal/change addresses
          }
        );
        addressesToCreate.push({
          walletId,
          address,
          derivationPath,
          index: i,
          used: false,
        });
      }

      // Bulk insert addresses
      await prisma.address.createMany({
        data: addressesToCreate,
      });

      // Re-fetch the created addresses (respect pagination)
      addresses = await prisma.address.findMany({
        where: {
          walletId,
        },
        include: {
          addressLabels: {
            include: {
              label: true,
            },
          },
        },
        orderBy: { index: 'asc' },
        take: effectiveLimit,
        skip: effectiveOffset,
      });
    } catch (err) {
      log.error('Failed to auto-generate addresses', { error: getErrorMessage(err) });
      // Return empty array if generation fails
    }
  }

  // Get balances for each address from UTXOs
  const addressList = addresses.map(addr => addr.address);
  const utxos = await prisma.uTXO.findMany({
    where: {
      walletId,
      spent: false,
      ...(addressList.length > 0 && { address: { in: addressList } }),
    },
    select: {
      address: true,
      amount: true,
    },
  });

  // Sum balances by address
  const addressBalances = new Map<string, number>();
  for (const utxo of utxos) {
    const current = addressBalances.get(utxo.address) || 0;
    addressBalances.set(utxo.address, current + bigIntToNumberOrZero(utxo.amount));
  }

  // Add balance, labels, and isChange flag to each address
  const addressesWithBalance = addresses.map(({ addressLabels, ...addr }) => {
    // Determine if this is a change address from derivation path
    // Change addresses have /1/ before the final index, receive addresses have /0/
    // e.g., m/84'/0'/0'/1/5 is change, m/84'/0'/0'/0/5 is receive
    const pathParts = addr.derivationPath.split('/');
    const isChange = pathParts.length >= 2 && pathParts[pathParts.length - 2] === '1';

    return {
      ...addr,
      balance: addressBalances.get(addr.address) || 0,
      labels: addressLabels.map(al => al.label),
      isChange,
    };
  });

  if (!hasPagination) {
    res.setHeader('X-Result-Limit', String(DEFAULT_UNPAGED_LIMIT));
    res.setHeader('X-Result-Truncated', addresses.length >= DEFAULT_UNPAGED_LIMIT ? 'true' : 'false');
  }

  res.json(addressesWithBalance);
}));

/**
 * GET /api/v1/wallets/:walletId/addresses/summary
 * Get summary counts and balances for a wallet's addresses
 */
router.get('/wallets/:walletId/addresses/summary', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;

  const [totalCount, usedCount, unusedCount, totalBalanceResult, usedBalances] = await Promise.all([
    prisma.address.count({ where: { walletId } }),
    prisma.address.count({ where: { walletId, used: true } }),
    prisma.address.count({ where: { walletId, used: false } }),
    prisma.uTXO.aggregate({
      where: { walletId, spent: false },
      _sum: { amount: true },
    }),
    prisma.$queryRaw<Array<{ used: boolean; balance: bigint }>>`
      SELECT a."used" as used, COALESCE(SUM(u."amount"), 0) as balance
      FROM "utxos" u
      JOIN "addresses" a ON a."address" = u."address"
      WHERE u."walletId" = ${walletId} AND u."spent" = false
      GROUP BY a."used"
    `,
  ]);

  let usedBalance = 0;
  let unusedBalance = 0;
  for (const row of usedBalances) {
    if (row.used) {
      usedBalance = bigIntToNumberOrZero(row.balance);
    } else {
      unusedBalance = bigIntToNumberOrZero(row.balance);
    }
  }

  res.json({
    totalAddresses: totalCount,
    usedCount,
    unusedCount,
    totalBalance: bigIntToNumberOrZero(totalBalanceResult._sum.amount),
    usedBalance,
    unusedBalance,
  });
}));

/**
 * POST /api/v1/wallets/:walletId/addresses/generate
 * Generate more addresses for a wallet (requires edit access: owner or signer)
 */
router.post('/wallets/:walletId/addresses/generate', requireWalletAccess('edit'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const { count = 10 } = req.body;

  // Fetch wallet data
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
  });

  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }

  if (!wallet.descriptor) {
    throw new ValidationError('Wallet does not have a descriptor');
  }

  // Get current max index for receive and change addresses
  const existingAddresses = await prisma.address.findMany({
    where: { walletId },
    select: { derivationPath: true, index: true },
  });

  // Parse existing addresses to find max indices
  let maxReceiveIndex = -1;
  let maxChangeIndex = -1;

  for (const addr of existingAddresses) {
    const parts = addr.derivationPath.split('/');
    if (parts.length >= 2) {
      const changeIndicator = parts[parts.length - 2];
      const index = parseInt(parts[parts.length - 1], 10);
      if (changeIndicator === '0' && index > maxReceiveIndex) {
        maxReceiveIndex = index;
      } else if (changeIndicator === '1' && index > maxChangeIndex) {
        maxChangeIndex = index;
      }
    }
  }

  const addressesToCreate = [];

  // Generate more receive addresses
  for (let i = maxReceiveIndex + 1; i < maxReceiveIndex + 1 + count; i++) {
    try {
      const { address, derivationPath } = addressDerivation.deriveAddressFromDescriptor(
        wallet.descriptor,
        i,
        {
          network: wallet.network as 'mainnet' | 'testnet' | 'regtest',
          change: false,
        }
      );
      addressesToCreate.push({
        walletId,
        address,
        derivationPath,
        index: i,
        used: false,
      });
    } catch (err) {
      log.error(`Failed to derive receive address ${i}`, { error: getErrorMessage(err) });
    }
  }

  // Generate more change addresses
  for (let i = maxChangeIndex + 1; i < maxChangeIndex + 1 + count; i++) {
    try {
      const { address, derivationPath } = addressDerivation.deriveAddressFromDescriptor(
        wallet.descriptor,
        i,
        {
          network: wallet.network as 'mainnet' | 'testnet' | 'regtest',
          change: true,
        }
      );
      addressesToCreate.push({
        walletId,
        address,
        derivationPath,
        index: i,
        used: false,
      });
    } catch (err) {
      log.error(`Failed to derive change address ${i}`, { error: getErrorMessage(err) });
    }
  }

  // Bulk insert addresses (skip duplicates)
  if (addressesToCreate.length > 0) {
    await prisma.address.createMany({
      data: addressesToCreate,
      skipDuplicates: true,
    });
  }

  res.json({
    generated: addressesToCreate.length,
    receiveAddresses: count,
    changeAddresses: count,
  });
}));

export default router;
