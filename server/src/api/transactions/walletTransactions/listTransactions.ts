/**
 * Wallet Transactions - List Route
 *
 * Endpoint for listing wallet transactions with pagination.
 */

import { Router } from 'express';
import { requireWalletAccess } from '../../../middleware/walletAccess';
import { walletRepository, transactionRepository } from '../../../repositories';
import { validatePagination, bigIntToNumber, bigIntToNumberOrZero } from '../../../utils/errors';
import { asyncHandler } from '../../../errors/errorHandler';
import { getCachedBlockHeight } from '../../../services/bitcoin/blockchain';
import { calculateConfirmations } from './utils';

/**
 * Create the list transactions router
 */
export function createListTransactionsRouter(): Router {
  const router = Router();

  /**
   * GET /api/v1/wallets/:walletId/transactions
   * Get all transactions for a wallet
   */
  router.get('/wallets/:walletId/transactions', requireWalletAccess('view'), asyncHandler(async (req, res) => {
    const { walletId } = req.params;
    const { limit, offset } = validatePagination(
      req.query.limit as string,
      req.query.offset as string
    );

    // Get wallet network for network-specific block height cache
    const wallet = await walletRepository.findByIdWithSelect(walletId, { network: true });
    const network = (wallet?.network as 'mainnet' | 'testnet' | 'signet' | 'regtest') || 'mainnet';

    // Get cached block height for this network (no network call)
    const currentHeight = getCachedBlockHeight(network);

    const transactions = await transactionRepository.findByWalletIdWithDetails(walletId, {
      where: {
        // Exclude replaced RBF transactions which are no longer in mempool
        // These show as "pending" forever since they'll never confirm
        rbfStatus: { not: 'replaced' },
      },
      include: {
        address: {
          select: {
            address: true,
            derivationPath: true,
          },
        },
        transactionLabels: {
          include: {
            label: true,
          },
        },
      },
      // Sort pending transactions (null blockTime) first, then by date descending
      // Pending txs use createdAt for ordering, confirmed txs use blockTime
      orderBy: [
        { blockTime: { sort: 'desc', nulls: 'first' } },
        { createdAt: 'desc' },
      ],
      take: limit,
      skip: offset,
    });

    // Convert BigInt amounts to numbers
    // The amounts in the database are already correctly signed:
    // - sent: negative (amount + fee already deducted during sync)
    // - consolidation: negative fee only (only fee lost)
    // - received: positive (what you received)
    //
    // PRECISION NOTE: BigInt to Number conversion is safe for Bitcoin amounts
    // up to ~90 million BTC (Number.MAX_SAFE_INTEGER = 2^53 - 1 = 9,007,199,254,740,991 sats).
    // This exceeds Bitcoin's 21 million coin cap by 4x, so precision loss is not a concern
    // for transaction amounts. For amounts exceeding this threshold in other contexts,
    // consider converting to string instead.
    const serializedTransactions = transactions.map(tx => {
      const blockHeight = bigIntToNumber(tx.blockHeight);
      const rawAmount = bigIntToNumberOrZero(tx.amount);

      // The amount is already correctly signed in the database
      // Don't re-apply signing logic to avoid double-counting fees

      return {
        ...tx,
        amount: rawAmount,
        fee: bigIntToNumber(tx.fee),
        balanceAfter: bigIntToNumber(tx.balanceAfter),
        blockHeight,
        // Calculate confirmations dynamically from cached block height
        // Falls back to stored value if cache not yet populated
        confirmations: currentHeight > 0 ? calculateConfirmations(blockHeight, currentHeight) : tx.confirmations,
        labels: tx.transactionLabels.map((tl) => tl.label),
        transactionLabels: undefined, // Remove the raw join data
      };
    });

    res.json(serializedTransactions);
  }));

  return router;
}
