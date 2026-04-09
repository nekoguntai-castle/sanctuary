/**
 * Transactions - Address Router
 *
 * Endpoints for listing and generating wallet addresses
 */

import { Router } from 'express';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { walletRepository, addressRepository } from '../../repositories';
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
  const wallet = await walletRepository.findById(walletId);

  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }

  // Build derivation path filter for change/receive filtering.
  // BIP-44/48/84 paths end with /<change>/<index> where change is 0 (receive) or 1 (change).
  // The `contains` match is safe because coin-type segments use apostrophes (/1'/) which
  // don't match the bare /1/ pattern.
  const changeFilter = change !== undefined
    ? { derivationPath: { contains: change === 'true' ? '/1/' : '/0/' } }
    : undefined;

  // Check if addresses exist
  let addresses = await addressRepository.findByWalletIdWithLabels(walletId, {
    used: used !== undefined ? used === 'true' : undefined,
    changeFilter,
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
      await addressRepository.createMany(addressesToCreate);

      // Re-fetch the created addresses (respect pagination)
      addresses = await addressRepository.findByWalletIdWithLabels(walletId, {
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
  const utxos = await addressRepository.findUtxoBalancesByAddresses(walletId, addressList);

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

  const summary = await addressRepository.getAddressSummary(walletId);

  let usedBalance = 0;
  let unusedBalance = 0;
  for (const row of summary.usedBalances) {
    if (row.used) {
      usedBalance = bigIntToNumberOrZero(row.balance);
    } else {
      unusedBalance = bigIntToNumberOrZero(row.balance);
    }
  }

  res.json({
    totalAddresses: summary.totalCount,
    usedCount: summary.usedCount,
    unusedCount: summary.unusedCount,
    totalBalance: bigIntToNumberOrZero(summary.totalBalanceResult._sum.amount),
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
  const wallet = await walletRepository.findById(walletId);

  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }

  if (!wallet.descriptor) {
    throw new ValidationError('Wallet does not have a descriptor');
  }

  // Get current max index for receive and change addresses
  const existingAddresses = await addressRepository.findDerivationPaths(walletId);

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
    await addressRepository.createMany(addressesToCreate, { skipDuplicates: true });
  }

  res.json({
    generated: addressesToCreate.length,
    receiveAddresses: count,
    changeAddresses: count,
  });
}));

export default router;
