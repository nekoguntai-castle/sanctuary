/**
 * Transactions - UTXO Router
 *
 * Endpoints for listing and managing UTXOs
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { validate } from '../../middleware/validate';
import { systemSettingRepository, utxoRepository, transactionRepository } from '../../repositories';
import { checkWalletAccess } from '../../services/accessControl';
import { SystemSettingSchemas } from '../../utils/safeJson';
import { bigIntToNumberOrZero } from '../../utils/errors';
import { extractPagination, setTruncationHeaders } from '../../utils/pagination';
import { asyncHandler } from '../../errors/errorHandler';
import { NotFoundError, ForbiddenError } from '../../errors/ApiError';

const router = Router();

const FreezeUtxoBodySchema = z.object({
  frozen: z.boolean(),
});

/**
 * GET /api/v1/wallets/:walletId/utxos
 * Get all UTXOs for a wallet
 */
router.get('/wallets/:walletId/utxos', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const pagination = extractPagination(req.query as { limit?: string; offset?: string });
  const { effectiveLimit, effectiveOffset } = pagination;

  // Get confirmation threshold setting
  const confirmationThreshold = await systemSettingRepository.getParsed('confirmationThreshold', SystemSettingSchemas.number, 3);

  const [summary, utxos] = await Promise.all([
    utxoRepository.aggregateUnspent(walletId),
    utxoRepository.findUnspentWithDraftLocks(walletId, {
      take: effectiveLimit,
      skip: effectiveOffset,
    }),
  ]);

  // Get associated transactions to find blockTime for each UTXO
  const txids = [...new Set(utxos.map(u => u.txid))];
  const txBlockTimes = await transactionRepository.findBlockTimesByTxids(walletId, txids);

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

  setTruncationHeaders(res, utxos.length, pagination);

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
router.patch('/utxos/:utxoId/freeze', validate(
  { body: FreezeUtxoBodySchema },
  { message: 'frozen must be a boolean' }
), asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { utxoId } = req.params;
  const { frozen } = req.body;

  // Find the UTXO and verify user has access to the wallet
  const utxo = await utxoRepository.findByIdWithWalletAccess(utxoId, userId);

  if (!utxo) {
    throw new NotFoundError('UTXO not found');
  }

  // Check if user has edit access (owner or signer)
  const access = await checkWalletAccess(utxo.walletId, userId);
  if (!access.canEdit) {
    throw new ForbiddenError('You do not have permission to modify UTXOs in this wallet');
  }

  // Update the frozen status
  const updatedUtxo = await utxoRepository.updateById(utxoId, { frozen });

  res.json({
    id: updatedUtxo.id,
    txid: updatedUtxo.txid,
    vout: updatedUtxo.vout,
    frozen: updatedUtxo.frozen,
    message: frozen ? 'UTXO frozen successfully' : 'UTXO unfrozen successfully',
  });
}));

export default router;
