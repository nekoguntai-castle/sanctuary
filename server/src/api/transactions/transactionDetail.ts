/**
 * Transactions - Transaction Detail Router
 *
 * Endpoints for fetching individual transaction details.
 */

import { Router, type Response } from 'express';
import type { Prisma } from '../../generated/prisma/client';
import { transactionRepository, walletRepository } from '../../repositories';
import { createLogger } from '../../utils/logger';
import { asyncHandler } from '../../errors/errorHandler';
import { ConflictError, InvalidInputError, NotFoundError } from '../../errors/ApiError';
import { requireAuthenticatedUser } from '../../middleware/auth';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { getMempoolApiBase } from '../../services/bitcoin/mempool/config';
import {
  normalizeLegacyBitcoinNetwork,
  type BitcoinNetwork,
} from '../../services/bitcoin/networks';
import { getDefaultNodeMempoolApiBase } from '@sanctuary/shared/constants/nodeConfig';

const router = Router();
const log = createLogger('TX_DETAIL:ROUTE');
const TXID_PATTERN = /^[0-9a-fA-F]{64}$/;
const LEGACY_ROUTE_SUNSET = 'Sat, 31 Jul 2027 00:00:00 GMT';

const transactionDetailInclude = {
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
  inputs: {
    orderBy: { inputIndex: 'asc' },
  },
  outputs: {
    orderBy: { outputIndex: 'asc' },
  },
} satisfies Prisma.TransactionInclude;

const rawTransactionSelect = {
  id: true,
  walletId: true,
  rawTx: true,
  wallet: { select: { network: true } },
} satisfies Prisma.TransactionSelect;

type TransactionDetail = Prisma.TransactionGetPayload<{
  include: typeof transactionDetailInclude;
}>;

function requireValidTxid(txid: string): string {
  if (!TXID_PATTERN.test(txid)) {
    throw new InvalidInputError('Invalid transaction id', 'txid');
  }

  return txid.toLowerCase();
}

function setLegacyRouteHeaders(
  res: Response,
  txid: string,
  raw: boolean,
  walletId?: string,
): void {
  const walletSegment = walletId ?? '%7BwalletId%7D';
  const suffix = raw ? '/raw' : '';
  const templated = walletId ? '' : '; templated="true"';

  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', LEGACY_ROUTE_SUNSET);
  res.setHeader(
    'Link',
    `</api/v1/wallets/${walletSegment}/transactions/${txid}${suffix}>; rel="successor-version"${templated}`,
  );
}

function serializeTransaction(transaction: TransactionDetail) {
  return {
    ...transaction,
    amount: Number(transaction.amount),
    fee: transaction.fee ? Number(transaction.fee) : null,
    balanceAfter: transaction.balanceAfter ? Number(transaction.balanceAfter) : null,
    blockHeight: transaction.blockHeight ? Number(transaction.blockHeight) : null,
    labels: transaction.transactionLabels.map((tl) => tl.label),
    transactionLabels: undefined,
    inputs: transaction.inputs.map((input) => ({
      ...input,
      amount: Number(input.amount),
    })),
    outputs: transaction.outputs.map((output) => ({
      ...output,
      amount: Number(output.amount),
    })),
  };
}

async function fetchExternalRawTransaction(
  txid: string,
  network: BitcoinNetwork,
): Promise<string> {
  const mempoolBaseUrl = network === 'regtest'
    ? getDefaultNodeMempoolApiBase('mainnet')
    : await getMempoolApiBase(network);
  const response = await fetch(`${mempoolBaseUrl}/tx/${txid}/hex`, {
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    log.warn('Failed to fetch raw tx from mempool.space', { txid, status: response.status });
    throw new NotFoundError('Transaction not found');
  }

  return response.text();
}

async function respondWithRawTransaction(
  res: Response,
  txid: string,
  rawTx: string | null | undefined,
  walletNetwork: string | null | undefined,
): Promise<Response> {
  if (rawTx) {
    return res.json({ hex: rawTx });
  }

  const network = normalizeLegacyBitcoinNetwork(walletNetwork, 'mainnet');
  const hex = await fetchExternalRawTransaction(txid, network);
  return res.json({ hex });
}

/**
 * GET /api/v1/wallets/:walletId/transactions/:txid/raw
 * Get raw transaction hex in an explicit wallet/network scope.
 */
router.get(
  '/wallets/:walletId/transactions/:txid/raw',
  requireWalletAccess('view'),
  asyncHandler(async (req, res) => {
    const { walletId } = req.params;
    const txid = requireValidTxid(req.params.txid);
    const [transaction, wallet] = await Promise.all([
      transactionRepository.findByTxid(txid, walletId, { select: rawTransactionSelect }),
      walletRepository.findByIdWithSelect(walletId, { network: true }),
    ]);

    if (!wallet) {
      throw new NotFoundError('Wallet not found');
    }

    return respondWithRawTransaction(res, txid, transaction?.rawTx, wallet.network);
  }),
);

/**
 * GET /api/v1/wallets/:walletId/transactions/:txid
 * Get a transaction in an explicit wallet scope.
 */
router.get(
  '/wallets/:walletId/transactions/:txid',
  requireWalletAccess('view'),
  asyncHandler(async (req, res) => {
    const { walletId } = req.params;
    const txid = requireValidTxid(req.params.txid);
    const transaction = await transactionRepository.findByTxid(txid, walletId, {
      include: transactionDetailInclude,
    });

    if (!transaction) {
      throw new NotFoundError('Transaction not found');
    }

    res.json(serializeTransaction(transaction));
  }),
);

/**
 * GET /api/v1/transactions/:txid/raw
 * Deprecated txid-only raw lookup retained for compatibility.
 */
router.get('/transactions/:txid/raw', asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const txid = requireValidTxid(req.params.txid);
  setLegacyRouteHeaders(res, txid, true);

  const matches = await transactionRepository.findAccessibleByTxidMatches(txid, userId, {
    select: rawTransactionSelect,
  });

  if (matches.length > 1) {
    throw new ConflictError('Transaction exists in multiple accessible wallets; use the wallet-scoped endpoint');
  }

  const transaction = matches[0];
  if (transaction) {
    setLegacyRouteHeaders(res, txid, true, transaction.walletId);
  }

  return respondWithRawTransaction(
    res,
    txid,
    transaction?.rawTx,
    transaction?.wallet.network,
  );
}));

/**
 * GET /api/v1/transactions/:txid
 * Deprecated txid-only detail lookup retained for compatibility.
 */
router.get('/transactions/:txid', asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const txid = requireValidTxid(req.params.txid);
  setLegacyRouteHeaders(res, txid, false);

  const matches = await transactionRepository.findAccessibleByTxidMatches(txid, userId, {
    include: transactionDetailInclude,
  });

  if (matches.length === 0) {
    throw new NotFoundError('Transaction not found');
  }
  if (matches.length > 1) {
    throw new ConflictError('Transaction exists in multiple accessible wallets; use the wallet-scoped endpoint');
  }

  const transaction = matches[0];
  setLegacyRouteHeaders(res, txid, false, transaction.walletId);
  res.json(serializeTransaction(transaction));
}));

export default router;
