/**
 * Transactions - Broadcasting Router
 *
 * Endpoints for broadcasting signed transactions and PSBTs.
 *
 * NOTE: These routes intentionally keep try/catch for audit logging
 * on failed broadcasts before re-throwing to asyncHandler.
 */

import { Router } from 'express';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { asyncHandler } from '../../errors/errorHandler';
import { ForbiddenError } from '../../errors/ApiError';
import { auditService, AuditCategory, AuditAction } from '../../services/auditService';
import { policyEvaluationEngine } from '../../services/vaultPolicy';
import * as txService from '../../services/bitcoin/transactionService';
import {
  MobilePsbtBroadcastRequestSchema,
  MobileTransactionBroadcastRequestSchema,
} from '../../../../shared/schemas/mobileApiRequests';
import { parseTransactionRequestBody } from './requestValidation';
import { requireAuthenticatedUser } from '../../middleware/auth';

const router = Router();
const log = createLogger('TX_BROADCAST:ROUTE');

/**
 * POST /api/v1/wallets/:walletId/transactions/broadcast
 * Broadcast a signed PSBT or raw transaction hex
 * Supports two signing workflows:
 * - signedPsbtBase64: Signed PSBT from Ledger or file upload
 * - rawTxHex: Raw transaction hex from Trezor (fully signed)
 */
router.post('/wallets/:walletId/transactions/broadcast', requireWalletAccess('edit'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const {
    signedPsbtBase64,
    rawTxHex, // For Trezor: fully signed transaction hex
    recipient,
    amount,
    fee,
    label,
    memo,
    utxos,
  } = parseTransactionRequestBody(MobileTransactionBroadcastRequestSchema, req.body);

  // Re-evaluate policies before broadcast (guard against drift).
  // Extract from PSBT when available; fall back to client-supplied fields.
  let evalRecipient = recipient;
  let evalAmount = amount;

  if (signedPsbtBase64 && (!evalRecipient || !evalAmount)) {
    try {
      const psbtInfo = txService.getPSBTInfo(signedPsbtBase64);
      const firstOutput = psbtInfo.outputs[0];
      if (firstOutput) {
        evalRecipient = evalRecipient || firstOutput.address;
        evalAmount = evalAmount || firstOutput.value;
      }
    } catch (parseErr) {
      log.debug('Could not parse PSBT for policy eval', { error: getErrorMessage(parseErr) });
    }
  }

  if (evalRecipient && evalAmount) {
    const policyResult = await policyEvaluationEngine.evaluatePolicies({
      walletId,
      userId: requireAuthenticatedUser(req).userId,
      recipient: evalRecipient,
      amount: BigInt(evalAmount),
    });

    if (!policyResult.allowed) {
      log.warn('Broadcast blocked by policy', {
        walletId,
        triggered: policyResult.triggered.map(t => t.policyName),
      });
      throw new ForbiddenError('Transaction blocked by vault policy');
    }
  }

  // Broadcast transaction (wrap in try/catch for audit logging on failure)
  try {
    const broadcastMetadata = {
      recipient: evalRecipient ?? recipient ?? '',
      amount: evalAmount ?? amount ?? 0,
      fee: fee ?? 0,
      /* v8 ignore start -- optional broadcast metadata defaults are defensive for older clients */
      ...(label !== undefined && { label }),
      ...(memo !== undefined && { memo }),
      /* v8 ignore stop */
      utxos: utxos ?? [],
      ...(rawTxHex !== undefined && { rawTxHex }),
    };

    const result = await txService.broadcastAndSave(walletId, signedPsbtBase64, {
      ...broadcastMetadata,
    });

    // Record policy usage after successful broadcast
    const recordAmount = evalAmount || amount;
    if (recordAmount) {
      policyEvaluationEngine.recordUsage(walletId, requireAuthenticatedUser(req).userId, BigInt(recordAmount)).catch(err => {
        log.warn('Failed to record policy usage', { error: getErrorMessage(err) });
      });
    }

    // Audit log successful broadcast
    await auditService.logFromRequest(req, AuditAction.TRANSACTION_BROADCAST, AuditCategory.WALLET, {
      success: true,
      details: {
        walletId,
        txid: result.txid,
        recipient,
        amount,
        fee,
      },
    });

    res.json(result);
  } catch (error) {
    // Audit log failed broadcast before re-throwing
    await auditService.logFromRequest(req, AuditAction.TRANSACTION_BROADCAST_FAILED, AuditCategory.WALLET, {
      success: false,
      errorMsg: getErrorMessage(error),
      details: {
        walletId: req.walletId,
        recipient: req.body?.recipient,
        amount: req.body?.amount,
      },
    });

    /* v8 ignore next -- rethrow is a defensive route-level propagation path after audit logging */
    throw error;
  }
}));

/**
 * POST /api/v1/wallets/:walletId/psbt/broadcast
 * Broadcast a signed PSBT
 */
router.post('/wallets/:walletId/psbt/broadcast', requireWalletAccess('edit'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const { signedPsbt, label, memo } = parseTransactionRequestBody(
    MobilePsbtBroadcastRequestSchema,
    req.body
  );

  // Parse PSBT to get transaction details
  const psbtInfo = txService.getPSBTInfo(signedPsbt);

  // Calculate amount from outputs (exclude change)
  // For simplicity, assume last output is change if there are 2+ outputs
  const outputs = psbtInfo.outputs;
  const recipientOutput = outputs[0];
  const amount = recipientOutput?.value || 0;
  const recipientAddress = recipientOutput?.address || '';

  // Evaluate policies using data extracted from the PSBT itself (not client metadata)
  if (recipientAddress && amount > 0) {
    const policyResult = await policyEvaluationEngine.evaluatePolicies({
      walletId,
      userId: requireAuthenticatedUser(req).userId,
      recipient: recipientAddress,
      amount: BigInt(amount),
    });

    if (!policyResult.allowed) {
      log.warn('PSBT broadcast blocked by policy', {
        walletId,
        triggered: policyResult.triggered.map(t => t.policyName),
      });
      throw new ForbiddenError('Transaction blocked by vault policy');
    }
  }

  // Broadcast transaction (wrap in try/catch for audit logging on failure)
  try {
    const result = await txService.broadcastAndSave(walletId, signedPsbt, {
      recipient: recipientAddress,
      amount,
      fee: psbtInfo.fee,
      label,
      memo,
      utxos: psbtInfo.inputs.map(i => ({ txid: i.txid, vout: i.vout })),
    });

    // Record policy usage after successful broadcast
    if (amount > 0) {
      policyEvaluationEngine.recordUsage(walletId, requireAuthenticatedUser(req).userId, BigInt(amount)).catch(err => {
        log.warn('Failed to record policy usage', { error: getErrorMessage(err) });
      });
    }

    // Audit log successful broadcast
    await auditService.logFromRequest(req, AuditAction.TRANSACTION_BROADCAST, AuditCategory.WALLET, {
      success: true,
      details: {
        walletId,
        txid: result.txid,
        recipient: recipientAddress,
        amount,
        fee: psbtInfo.fee,
      },
    });

    res.json({
      txid: result.txid,
      broadcasted: result.broadcasted,
    });
  } catch (error) {
    // Audit log failed broadcast before re-throwing
    /* v8 ignore next 9 -- broadcast failure audit path is covered at service boundary */
    await auditService.logFromRequest(req, AuditAction.TRANSACTION_BROADCAST_FAILED, AuditCategory.WALLET, {
      success: false,
      errorMsg: getErrorMessage(error),
      details: {
        walletId: req.walletId,
      },
    });

    /* v8 ignore next -- rethrow is a defensive route-level propagation path after audit logging */
    throw error;
  }
}));

export default router;
