/**
 * Wallet Transactions - Pending Route
 *
 * Endpoint for listing pending (unconfirmed) transactions
 * with mempool data enrichment.
 */

import { Router } from 'express';
import { requireWalletAccess } from '../../../middleware/walletAccess';
import { walletRepository, transactionRepository } from '../../../repositories';
import { createLogger } from '../../../utils/logger';
import { asyncHandler } from '../../../errors/errorHandler';
import { mapWithConcurrency } from '../../../utils/async';

const log = createLogger('TX_PENDING:ROUTE');
const MEMPOOL_FETCH_CONCURRENCY = 5;

type PendingTxRecord = Awaited<ReturnType<typeof transactionRepository.findByWalletIdWithDetails>>[number];
type PendingWallet = Awaited<ReturnType<typeof walletRepository.findByIdWithSelect>>;

const pendingTransactionWhere = {
  rbfStatus: { not: 'replaced' },
  OR: [
    { blockHeight: 0 },
    { blockHeight: null },
  ],
};

const getMempoolBaseUrl = (wallet: PendingWallet): string => {
  return wallet?.network === 'testnet'
    ? 'https://mempool.space/testnet/api'
    : 'https://mempool.space/api';
};

const fetchMempoolTxData = async (
  mempoolBaseUrl: string,
  txid: string
): Promise<{ weight?: number; fee?: number } | null> => {
  try {
    const response = await fetch(`${mempoolBaseUrl}/tx/${txid}`, {
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok ? await response.json() as { weight?: number; fee?: number } : null;
  } catch (err) {
    log.warn('Failed to fetch tx from mempool.space', { txid, error: err });
    return null;
  }
};

const calculateRawTransactionFeeRate = (rawTx: string | null, fee: number): number => {
  if (!rawTx || fee <= 0) return 0;

  const size = Math.ceil(rawTx.length / 2);
  return size > 0 ? Math.round((fee / size) * 10) / 10 : 0;
};

const buildPendingTransactionResponse = async (
  tx: PendingTxRecord,
  wallet: PendingWallet,
  mempoolBaseUrl: string
) => {
  let fee = tx.fee ? Number(tx.fee) : 0;
  let vsize: number | undefined;
  let feeRate = 0;

  const txData = await fetchMempoolTxData(mempoolBaseUrl, tx.txid);
  if (txData) {
    vsize = txData.weight ? Math.ceil(txData.weight / 4) : undefined;
    if (fee === 0 && txData.fee) {
      fee = txData.fee;
    }
    if (vsize && fee > 0) {
      feeRate = Math.round((fee / vsize) * 10) / 10;
    }
  }

  if (feeRate === 0) {
    feeRate = calculateRawTransactionFeeRate(tx.rawTx, fee);
  }

  const displayType: 'sent' | 'received' =
    tx.type === 'received' || tx.type === 'receive' ? 'received' : 'sent';
  const rawAmount = Math.abs(Number(tx.amount));

  return {
    txid: tx.txid,
    walletId: tx.walletId,
    walletName: wallet?.name,
    type: displayType,
    amount: displayType === 'sent' ? -rawAmount : rawAmount,
    fee,
    feeRate,
    vsize,
    recipient: tx.counterpartyAddress || undefined,
    timeInQueue: Math.floor((Date.now() - tx.createdAt.getTime()) / 1000),
    createdAt: tx.createdAt.toISOString(),
  };
};

const loadPendingTransactions = async (walletId: string) => {
  const wallet = await walletRepository.findByIdWithSelect(walletId, { name: true, network: true });
  const pendingTxs = await transactionRepository.findByWalletIdWithDetails(walletId, {
    where: pendingTransactionWhere,
    orderBy: { createdAt: 'desc' },
  });

  if (pendingTxs.length === 0) {
    return [];
  }

  const mempoolBaseUrl = getMempoolBaseUrl(wallet);
  return mapWithConcurrency(
    pendingTxs,
    tx => buildPendingTransactionResponse(tx, wallet, mempoolBaseUrl),
    MEMPOOL_FETCH_CONCURRENCY
  );
};

/**
 * Create the pending transactions router
 */
export function createPendingRouter(): Router {
  const router = Router();

  /**
   * GET /api/v1/wallets/:walletId/transactions/pending
   * Get pending (unconfirmed) transactions for a wallet
   * Returns data formatted for block queue visualization
   */
  router.get('/wallets/:walletId/transactions/pending', requireWalletAccess('view'), asyncHandler(async (req, res) => {
    const walletId = req.walletId!;
    res.json(await loadPendingTransactions(walletId));
  }));

  return router;
}
