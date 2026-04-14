/**
 * Transactions - Transaction Detail Router
 *
 * Endpoints for fetching individual transaction details
 */

import { Router } from 'express';
import { transactionRepository } from '../../repositories';
import { createLogger } from '../../utils/logger';
import { asyncHandler } from '../../errors/errorHandler';
import { NotFoundError } from '../../errors/ApiError';

const router = Router();
const log = createLogger('TX_DETAIL:ROUTE');

/**
 * GET /api/v1/transactions/:txid/raw
 * Get raw transaction hex for hardware wallet signing (Trezor needs full prev tx data)
 * First checks database (with wallet access verification), then fetches from mempool.space if not found
 */
router.get('/transactions/:txid/raw', asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { txid } = req.params;

  // First, check if we have it in our database WITH wallet access verification
  const transaction = await transactionRepository.findByTxidWithAccess(txid, userId, {
    select: { id: true, rawTx: true, wallet: { select: { network: true } } },
  });

  if (transaction?.rawTx) {
    return res.json({ hex: transaction.rawTx });
  }

  // If we found a transaction but no rawTx, or need to fetch externally,
  // use the network from the found transaction or default to mainnet
  const network = transaction?.wallet?.network || 'mainnet';
  const mempoolBaseUrl = network === 'testnet'
    ? 'https://mempool.space/testnet/api'
    : 'https://mempool.space/api';

  const response = await fetch(`${mempoolBaseUrl}/tx/${txid}/hex`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    log.warn('Failed to fetch raw tx from mempool.space', { txid, status: response.status });
    throw new NotFoundError('Transaction not found');
  }

  const hex = await response.text();
  return res.json({ hex });
}));

/**
 * GET /api/v1/transactions/:txid
 * Get a specific transaction by txid
 */
router.get('/transactions/:txid', asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { txid } = req.params;

  const transaction = await transactionRepository.findByTxidWithAccess(txid, userId, {
    include: {
      wallet: {
        select: {
          id: true,
          name: true,
          type: true,
        },
      },
      address: true,
      transactionLabels: {
        include: {
          label: true,
        },
      },
      // Include transaction inputs and outputs
      inputs: {
        orderBy: { inputIndex: 'asc' },
      },
      outputs: {
        orderBy: { outputIndex: 'asc' },
      },
    },
  });

  if (!transaction) {
    throw new NotFoundError('Transaction not found');
  }

  // Convert BigInt amounts to numbers for JSON serialization
  const serializedTransaction = {
    ...transaction,
    amount: Number(transaction.amount),
    fee: transaction.fee ? Number(transaction.fee) : null,
    balanceAfter: transaction.balanceAfter ? Number(transaction.balanceAfter) : null,
    blockHeight: transaction.blockHeight ? Number(transaction.blockHeight) : null,
    labels: transaction.transactionLabels.map((tl) => tl.label),
    transactionLabels: undefined, // Remove the raw join data
    // Serialize inputs/outputs
    inputs: transaction.inputs.map((input) => ({
      ...input,
      amount: Number(input.amount),
    })),
    outputs: transaction.outputs.map((output) => ({
      ...output,
      amount: Number(output.amount),
    })),
  };

  res.json(serializedTransaction);
}));

export default router;
