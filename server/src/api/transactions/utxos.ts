/**
 * Transactions - UTXO Router
 *
 * Endpoints for listing and managing UTXOs
 */

import { Router, Request, Response } from 'express';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { db as prisma } from '../../repositories/db';
import { systemSettingRepository } from '../../repositories';
import { checkWalletAccess } from '../../services/accessControl';
import { SystemSettingSchemas } from '../../utils/safeJson';
import { bigIntToNumberOrZero, validatePagination } from '../../utils/errors';
import { asyncHandler } from '../../errors/errorHandler';
import { ValidationError, NotFoundError, ForbiddenError } from '../../errors/ApiError';

const router = Router();

/**
 * GET /api/v1/wallets/:walletId/utxos
 * Get all UTXOs for a wallet
 */
router.get('/wallets/:walletId/utxos', requireWalletAccess('view'), asyncHandler(async (req: Request, res: Response) => {
  const walletId = req.walletId!;
  const hasPagination = req.query.limit !== undefined || req.query.offset !== undefined;
  const DEFAULT_UNPAGED_LIMIT = 1000;
  const { limit, offset } = validatePagination(
    req.query.limit as string,
    req.query.offset as string,
    DEFAULT_UNPAGED_LIMIT
  );
  const effectiveLimit = hasPagination ? limit : DEFAULT_UNPAGED_LIMIT;
  const effectiveOffset = hasPagination ? offset : 0;

  // Get confirmation threshold setting
  const confirmationThreshold = await systemSettingRepository.getParsed('confirmationThreshold', SystemSettingSchemas.number, 3);

  const [summary, utxos] = await Promise.all([
    prisma.uTXO.aggregate({
      where: { walletId, spent: false },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.uTXO.findMany({
      where: {
        walletId,
        spent: false,
      },
      orderBy: { amount: 'desc' },
      include: {
        draftLock: {
          include: {
            draft: {
              select: { id: true, label: true },
            },
          },
        },
      },
      take: effectiveLimit,
      skip: effectiveOffset,
    }),
  ]);

  // Get associated transactions to find blockTime for each UTXO
  const txids = [...new Set(utxos.map(u => u.txid))];
  const transactions = await prisma.transaction.findMany({
    where: {
      txid: { in: txids },
      walletId,
    },
    select: {
      txid: true,
      blockTime: true,
    },
  });
  const txBlockTimes = new Map(transactions.map(t => [t.txid, t.blockTime]));

  // Convert BigInt amounts to numbers for JSON serialization
  // Use transaction blockTime for the UTXO date (when it was created on blockchain)
  const serializedUtxos = utxos.map(utxo => {
    const blockTime = txBlockTimes.get(utxo.txid);
    const isLockedByDraft = !!utxo.draftLock;
    return {
      ...utxo,
      amount: Number(utxo.amount),
      blockHeight: utxo.blockHeight ? Number(utxo.blockHeight) : null,
      // Spendable if not frozen, not locked by draft, and has enough confirmations
      spendable: !utxo.frozen && !isLockedByDraft && utxo.confirmations >= confirmationThreshold,
      // Use blockTime from transaction if available, otherwise fall back to createdAt
      createdAt: blockTime ? blockTime.toISOString() : utxo.createdAt.toISOString(),
      // Draft lock info (if locked)
      lockedByDraftId: utxo.draftLock?.draftId,
      lockedByDraftLabel: utxo.draftLock?.draft?.label,
      draftLock: undefined, // Remove the raw relation data
    };
  });

  // Total balance/count across all unspent UTXOs (independent of pagination)
  const totalBalance = bigIntToNumberOrZero(summary._sum.amount);
  const totalCount = summary._count._all;

  if (!hasPagination) {
    res.setHeader('X-Result-Limit', String(DEFAULT_UNPAGED_LIMIT));
    res.setHeader('X-Result-Truncated', utxos.length >= DEFAULT_UNPAGED_LIMIT ? 'true' : 'false');
  }

  res.json({
    utxos: serializedUtxos,
    count: totalCount,
    totalBalance,
  });
}));

/**
 * PATCH /api/v1/utxos/:utxoId/freeze
 * Toggle the frozen status of a UTXO (requires edit access: owner or signer)
 */
router.patch('/utxos/:utxoId/freeze', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { utxoId } = req.params;
  const { frozen } = req.body;

  // Validate frozen parameter
  if (typeof frozen !== 'boolean') {
    throw new ValidationError('frozen must be a boolean');
  }

  // Find the UTXO and verify user has access to the wallet
  const utxo = await prisma.uTXO.findFirst({
    where: {
      id: utxoId,
      wallet: {
        OR: [
          { users: { some: { userId } } },
          { group: { members: { some: { userId } } } },
        ],
      },
    },
    include: {
      wallet: {
        include: {
          users: {
            where: { userId },
          },
        },
      },
    },
  });

  if (!utxo) {
    throw new NotFoundError('UTXO not found');
  }

  // Check if user has edit access (owner or signer)
  const access = await checkWalletAccess(utxo.walletId, userId);
  if (!access.canEdit) {
    throw new ForbiddenError('You do not have permission to modify UTXOs in this wallet');
  }

  // Update the frozen status
  const updatedUtxo = await prisma.uTXO.update({
    where: { id: utxoId },
    data: { frozen },
  });

  res.json({
    id: updatedUtxo.id,
    txid: updatedUtxo.txid,
    vout: updatedUtxo.vout,
    frozen: updatedUtxo.frozen,
    message: frozen ? 'UTXO frozen successfully' : 'UTXO unfrozen successfully',
  });
}));

export default router;
