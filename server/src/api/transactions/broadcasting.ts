/**
 * Transactions - Broadcasting Router
 *
 * Endpoints for broadcasting signed transactions and PSBTs.
 *
 * NOTE: These routes intentionally keep try/catch for audit logging
 * on failed broadcasts before re-throwing to asyncHandler.
 */

import { Router, type Request } from 'express';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { asyncHandler } from '../../errors/errorHandler';
import { ForbiddenError } from '../../errors/ApiError';
import { auditService, AuditCategory, AuditAction } from '../../services/auditService';
import { policyEvaluationEngine } from '../../services/vaultPolicy';
import * as txService from '../../services/bitcoin/transactionService';
import {
  type MobilePsbtBroadcastRequest,
  MobilePsbtBroadcastRequestSchema,
  type MobileTransactionBroadcastRequest,
  MobileTransactionBroadcastRequestSchema,
} from '../../../../shared/schemas/mobileApiRequests';
import { parseTransactionRequestBody } from './requestValidation';
import { requireAuthenticatedUser } from '../../middleware/auth';

const router = Router();
const log = createLogger('TX_BROADCAST:ROUTE');

type WalletRequest = Request & { walletId?: string };
type TransactionBroadcastBody = MobileTransactionBroadcastRequest;
type PsbtBroadcastBody = MobilePsbtBroadcastRequest;

const resolveTransactionPolicyFields = (
  signedPsbtBase64: string | undefined,
  recipient: string | undefined,
  amount: number | undefined
): { evalRecipient?: string; evalAmount?: number } => {
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

  return { evalRecipient, evalAmount };
};

const assertPolicyAllowsBroadcast = async (
  req: Request,
  walletId: string,
  recipient: string | undefined,
  amount: number | undefined,
  blockedMessage: string
): Promise<void> => {
  if (!recipient || !amount) return;

  const policyResult = await policyEvaluationEngine.evaluatePolicies({
    walletId,
    userId: requireAuthenticatedUser(req).userId,
    recipient,
    amount: BigInt(amount),
  });

  if (!policyResult.allowed) {
    log.warn(blockedMessage, {
      walletId,
      triggered: policyResult.triggered.map(t => t.policyName),
    });
    throw new ForbiddenError('Transaction blocked by vault policy');
  }
};

const recordPolicyUsage = (
  walletId: string,
  req: Request,
  amount: number | undefined
): void => {
  if (!amount) return;

  policyEvaluationEngine.recordUsage(walletId, requireAuthenticatedUser(req).userId, BigInt(amount)).catch(err => {
    log.warn('Failed to record policy usage', { error: getErrorMessage(err) });
  });
};

const auditTransactionBroadcastSuccess = async (
  req: Request,
  walletId: string,
  details: Record<string, unknown>
): Promise<void> => {
  await auditService.logFromRequest(req, AuditAction.TRANSACTION_BROADCAST, AuditCategory.WALLET, {
    success: true,
    details: {
      walletId,
      ...details,
    },
  });
};

const auditTransactionBroadcastFailure = async (
  req: WalletRequest,
  error: unknown,
  details: Record<string, unknown>
): Promise<void> => {
  await auditService.logFromRequest(req, AuditAction.TRANSACTION_BROADCAST_FAILED, AuditCategory.WALLET, {
    success: false,
    errorMsg: getErrorMessage(error),
    details: {
      walletId: req.walletId,
      ...details,
    },
  });
};

const pickDefinedBroadcastFields = <K extends keyof TransactionBroadcastBody>(
  body: TransactionBroadcastBody,
  fields: readonly K[]
): Partial<Pick<TransactionBroadcastBody, K>> => {
  return Object.fromEntries(
    fields.flatMap(field => body[field] === undefined ? [] : [[field, body[field]]])
  ) as Partial<Pick<TransactionBroadcastBody, K>>;
};

const buildTransactionBroadcastMetadata = (
  body: TransactionBroadcastBody,
  evalRecipient: string | undefined,
  evalAmount: number | undefined
) => {
  return {
    recipient: evalRecipient ?? body.recipient ?? '',
    amount: evalAmount ?? body.amount ?? 0,
    fee: body.fee ?? 0,
    ...pickDefinedBroadcastFields(body, ['label', 'memo'] as const),
    utxos: body.utxos ?? [],
    ...pickDefinedBroadcastFields(body, ['rawTxHex'] as const),
  };
};

const handleTransactionBroadcast = async (
  req: WalletRequest,
  walletId: string,
  body: TransactionBroadcastBody
) => {
  const { evalRecipient, evalAmount } = resolveTransactionPolicyFields(
    body.signedPsbtBase64,
    body.recipient,
    body.amount
  );
  await assertPolicyAllowsBroadcast(
    req,
    walletId,
    evalRecipient,
    evalAmount,
    'Broadcast blocked by policy'
  );

  try {
    const result = await txService.broadcastAndSave(
      walletId,
      body.signedPsbtBase64,
      buildTransactionBroadcastMetadata(body, evalRecipient, evalAmount)
    );

    recordPolicyUsage(walletId, req, evalAmount || body.amount);
    await auditTransactionBroadcastSuccess(req, walletId, {
      txid: result.txid,
      recipient: body.recipient,
      amount: body.amount,
      fee: body.fee,
    });
    return result;
  } catch (error) {
    await auditTransactionBroadcastFailure(req, error, {
      recipient: body.recipient,
      amount: body.amount,
    });
    throw error;
  }
};

const getPrimaryPsbtOutput = (signedPsbt: string): {
  psbtInfo: ReturnType<typeof txService.getPSBTInfo>;
  amount: number;
  recipientAddress: string;
} => {
  const psbtInfo = txService.getPSBTInfo(signedPsbt);
  const recipientOutput = psbtInfo.outputs[0];
  return {
    psbtInfo,
    amount: recipientOutput?.value || 0,
    recipientAddress: recipientOutput?.address || '',
  };
};

const handlePsbtBroadcast = async (
  req: WalletRequest,
  walletId: string,
  body: PsbtBroadcastBody
) => {
  const { psbtInfo, amount, recipientAddress } = getPrimaryPsbtOutput(body.signedPsbt);

  await assertPolicyAllowsBroadcast(
    req,
    walletId,
    recipientAddress || undefined,
    amount > 0 ? amount : undefined,
    'PSBT broadcast blocked by policy'
  );

  try {
    const result = await txService.broadcastAndSave(walletId, body.signedPsbt, {
      recipient: recipientAddress,
      amount,
      fee: psbtInfo.fee,
      label: body.label,
      memo: body.memo,
      utxos: psbtInfo.inputs.map(i => ({ txid: i.txid, vout: i.vout })),
    });

    recordPolicyUsage(walletId, req, amount > 0 ? amount : undefined);
    await auditTransactionBroadcastSuccess(req, walletId, {
      txid: result.txid,
      recipient: recipientAddress,
      amount,
      fee: psbtInfo.fee,
    });

    return {
      txid: result.txid,
      broadcasted: result.broadcasted,
    };
  } catch (error) {
    /* v8 ignore start -- broadcast failure audit path is covered at service boundary */
    await auditTransactionBroadcastFailure(req, error, {});
    throw error;
    /* v8 ignore stop */
  }
};

/**
 * POST /api/v1/wallets/:walletId/transactions/broadcast
 * Broadcast a signed PSBT or raw transaction hex
 * Supports two signing workflows:
 * - signedPsbtBase64: Signed PSBT from Ledger or file upload
 * - rawTxHex: Raw transaction hex from Trezor (fully signed)
 */
router.post('/wallets/:walletId/transactions/broadcast', requireWalletAccess('edit'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const body = parseTransactionRequestBody(MobileTransactionBroadcastRequestSchema, req.body);
  res.json(await handleTransactionBroadcast(req, walletId, body));
}));

/**
 * POST /api/v1/wallets/:walletId/psbt/broadcast
 * Broadcast a signed PSBT
 */
router.post('/wallets/:walletId/psbt/broadcast', requireWalletAccess('edit'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const body = parseTransactionRequestBody(MobilePsbtBroadcastRequestSchema, req.body);
  res.json(await handlePsbtBroadcast(req, walletId, body));
}));

export default router;
