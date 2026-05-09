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
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from '../../errors/ApiError';
import { auditService, AuditCategory, AuditAction } from '../../services/auditService';
import { policyEvaluationEngine } from '../../services/vaultPolicy';
import * as txService from '../../services/bitcoin/transactionService';
import {
  ACTIONABLE_DRAFT_STATUSES,
  draftRepository,
} from '../../repositories/draftRepository';
import { walletRepository } from '../../repositories/walletRepository';
import { isBitcoinNetwork, type BitcoinNetwork } from '../../services/bitcoin/networks';
import {
  type MobilePsbtBroadcastRequest,
  MobilePsbtBroadcastRequestSchema,
  type MobileTransactionBroadcastRequest,
  MobileTransactionBroadcastRequestSchema,
} from '../../../../shared/schemas/mobileApiRequests';
import { parseTransactionRequestBody } from './requestValidation';
import { requireAuthenticatedUser } from '../../middleware/auth';
import type { DraftTransaction } from '../../generated/prisma/client';

const router = Router();
const log = createLogger('TX_BROADCAST:ROUTE');

type WalletRequest = Request & { walletId?: string };
type TransactionBroadcastBody = MobileTransactionBroadcastRequest;
type PsbtBroadcastBody = MobilePsbtBroadcastRequest;
type BroadcastDraft = DraftTransaction;

const ACTIONABLE_BROADCAST_DRAFT_STATUSES = new Set<string>(ACTIONABLE_DRAFT_STATUSES);
const APPROVED_BROADCAST_APPROVAL_STATUSES = new Set(['not_required', 'approved']);
const APPROVAL_REJECTION_REASONS: Record<string, string> = {
  pending: 'pending_approval',
  rejected: 'approval_rejected',
  vetoed: 'approval_vetoed',
  expired: 'approval_expired',
};

/**
 * Resolve the wallet's broadcast network. Older wallet rows may store `testnet`
 * from before Testnet3/Testnet4 were split; those rows map to Testnet3.
 */
const resolveWalletNetwork = async (walletId: string): Promise<BitcoinNetwork> => {
  const network = await walletRepository.findNetwork(walletId);
  if (network === null) {
    throw new NotFoundError('Wallet not found', undefined, { walletId });
  }
  if (network === 'testnet') {
    return 'testnet3';
  }
  if (isBitcoinNetwork(network)) {
    return network;
  }
  throw new InvalidInputError('Wallet has unsupported Bitcoin network', 'network', { walletId, network });
};

const resolveTransactionPolicyFields = (
  signedPsbtBase64: string | undefined,
  network: BitcoinNetwork,
  recipient: string | undefined,
  amount: number | undefined
): { evalRecipient?: string; evalAmount?: number } => {
  let evalRecipient = recipient;
  let evalAmount = amount;

  if (signedPsbtBase64 && (!evalRecipient || !evalAmount)) {
    try {
      const psbtInfo = txService.getPSBTInfoWithNetwork(signedPsbtBase64, network);
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

const loadBroadcastDraft = async (
  walletId: string,
  draftId: string | undefined
): Promise<BroadcastDraft | null> => {
  if (!draftId) return null;

  const draft = await draftRepository.findByIdInWallet(draftId, walletId);
  if (!draft) {
    throw new NotFoundError('Draft not found', undefined, { draftId });
  }

  assertDraftAllowsBroadcast(draft);
  return draft;
};

const assertDraftAllowsBroadcast = (draft: BroadcastDraft): void => {
  // Broadcast is the terminal side effect; approval and lifecycle gates must be
  // enforced before policy usage, audit success, or node submission can happen.
  if (!ACTIONABLE_BROADCAST_DRAFT_STATUSES.has(draft.status)) {
    throw new ConflictError('Draft is no longer actionable for broadcast', undefined, {
      draftId: draft.id,
      status: draft.status,
      reason: 'duplicate_submission',
    });
  }

  if (!APPROVED_BROADCAST_APPROVAL_STATUSES.has(draft.approvalStatus)) {
    const reason = APPROVAL_REJECTION_REASONS[draft.approvalStatus] ?? 'pending_approval';
    throw new ForbiddenError('Draft approval is required before broadcast', undefined, {
      draftId: draft.id,
      approvalStatus: draft.approvalStatus,
      reason,
    });
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

const pickDefinedMetadata = <T extends Record<string, unknown>>(values: T): Partial<T> => {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
};

const parseDraftUtxoReference = (utxoId: string): { txid: string; vout: number } | null => {
  // Drafts store selected UTXOs as txid:vout. Invalid legacy values are ignored
  // so explicit request metadata can still carry the spend set.
  const separatorIndex = utxoId.lastIndexOf(':');
  if (separatorIndex <= 0) return null;

  const txid = utxoId.slice(0, separatorIndex);
  const vout = Number(utxoId.slice(separatorIndex + 1));
  if (!/^[a-fA-F0-9]{64}$/.test(txid) || !Number.isInteger(vout) || vout < 0) {
    return null;
  }

  return { txid, vout };
};

const getDraftBroadcastAmount = (draft: BroadcastDraft | null): number | undefined => {
  if (!draft) return undefined;
  return Number(draft.effectiveAmount ?? draft.amount);
};

const getDraftBroadcastUtxos = (draft: BroadcastDraft | null): Array<{ txid: string; vout: number }> => {
  if (!draft) return [];
  return draft.selectedUtxoIds.flatMap(utxoId => {
    const parsed = parseDraftUtxoReference(utxoId);
    return parsed ? [parsed] : [];
  });
};

const resolveSignedPsbtForBroadcast = (
  body: TransactionBroadcastBody,
  draft: BroadcastDraft | null
): string | undefined => {
  if (body.signedPsbtBase64) return body.signedPsbtBase64;
  if (body.rawTxHex) return undefined;
  return draft?.signedPsbtBase64 ?? undefined;
};

const assertBroadcastPayloadAvailable = (
  body: TransactionBroadcastBody,
  signedPsbtBase64: string | undefined,
  draft: BroadcastDraft | null
): void => {
  if (body.rawTxHex || signedPsbtBase64) return;

  throw new InvalidInputError(
    'Draft does not have a signed PSBT to broadcast',
    'draftId',
    {
      draftId: draft?.id,
      reason: 'missing_witness_data',
    }
  );
};

const resolveBroadcastRecipient = (
  body: TransactionBroadcastBody,
  evalRecipient: string | undefined,
  draft: BroadcastDraft | null
): string => {
  if (evalRecipient !== undefined) return evalRecipient;
  if (body.recipient !== undefined) return body.recipient;
  return draft?.recipient ?? '';
};

const resolveBroadcastAmount = (
  body: TransactionBroadcastBody,
  evalAmount: number | undefined,
  draft: BroadcastDraft | null
): number => {
  if (evalAmount !== undefined) return evalAmount;
  if (body.amount !== undefined) return body.amount;

  const draftAmount = getDraftBroadcastAmount(draft);
  return draftAmount !== undefined ? draftAmount : 0;
};

const resolveBroadcastFee = (
  body: TransactionBroadcastBody,
  draft: BroadcastDraft | null
): number => {
  if (body.fee !== undefined) return body.fee;
  return draft ? Number(draft.fee) : 0;
};

const buildTransactionBroadcastMetadata = (
  body: TransactionBroadcastBody,
  network: BitcoinNetwork,
  evalRecipient: string | undefined,
  evalAmount: number | undefined,
  draft: BroadcastDraft | null
) => {
  return {
    network,
    recipient: resolveBroadcastRecipient(body, evalRecipient, draft),
    amount: resolveBroadcastAmount(body, evalAmount, draft),
    fee: resolveBroadcastFee(body, draft),
    ...pickDefinedMetadata({
      label: body.label ?? draft?.label ?? undefined,
      memo: body.memo ?? draft?.memo ?? undefined,
    }),
    utxos: body.utxos ?? getDraftBroadcastUtxos(draft),
    ...(draft && { draftId: draft.id }),
    ...pickDefinedBroadcastFields(body, ['rawTxHex'] as const),
  };
};

const handleTransactionBroadcast = async (
  req: WalletRequest,
  walletId: string,
  body: TransactionBroadcastBody
) => {
  const network = await resolveWalletNetwork(walletId);
  const draft = await loadBroadcastDraft(walletId, body.draftId);
  const signedPsbtBase64 = resolveSignedPsbtForBroadcast(body, draft);
  assertBroadcastPayloadAvailable(body, signedPsbtBase64, draft);

  const { evalRecipient, evalAmount } = resolveTransactionPolicyFields(
    signedPsbtBase64,
    network,
    body.recipient ?? draft?.recipient,
    body.amount ?? getDraftBroadcastAmount(draft)
  );
  await assertPolicyAllowsBroadcast(
    req,
    walletId,
    evalRecipient,
    evalAmount,
    'Broadcast blocked by policy'
  );

  try {
    const metadata = buildTransactionBroadcastMetadata(body, network, evalRecipient, evalAmount, draft);
    const result = await txService.broadcastAndSave(
      walletId,
      signedPsbtBase64,
      metadata
    );

    recordPolicyUsage(walletId, req, metadata.amount);
    await auditTransactionBroadcastSuccess(req, walletId, {
      txid: result.txid,
      draftId: draft?.id,
      recipient: metadata.recipient,
      amount: metadata.amount,
      fee: metadata.fee,
    });
    return result;
  } catch (error) {
    await auditTransactionBroadcastFailure(req, error, {
      draftId: draft?.id,
      recipient: body.recipient ?? draft?.recipient,
      amount: body.amount ?? getDraftBroadcastAmount(draft),
    });
    throw error;
  }
};

const getPrimaryPsbtOutput = (signedPsbt: string, network: BitcoinNetwork): {
  psbtInfo: ReturnType<typeof txService.getPSBTInfoWithNetwork>;
  amount: number;
  recipientAddress: string;
} => {
  const psbtInfo = txService.getPSBTInfoWithNetwork(signedPsbt, network);
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
  const network = await resolveWalletNetwork(walletId);
  const { psbtInfo, amount, recipientAddress } = getPrimaryPsbtOutput(body.signedPsbt, network);

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
      network,
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
