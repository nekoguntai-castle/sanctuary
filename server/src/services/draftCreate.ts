import type { DraftTransaction, Prisma } from '../generated/prisma/client';
import { CreateDraftRequestSchema } from '@sanctuary/shared/schemas/draftRequests';
import { draftRepository, systemSettingRepository } from '../repositories';
import type { DraftDbClient } from '../repositories/draftRepository';
import type { DraftLockDbClient } from '../repositories/draftLockRepository';
import { ConflictError, InvalidInputError } from '../errors';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { SystemSettingSchemas } from '../utils/safeJson';
import { DEFAULT_DRAFT_EXPIRATION_DAYS } from '../constants';
import { lockUtxosForDraft, resolveUtxoIds } from './draftLockService';
import { dispatchDraftNotification } from './notifications/dispatch';
import { approvalService } from './vaultPolicy/approvalService';
import { validateInitialSigningState } from './draftSigning';
import type { CreateDraftInput, InitialSigningState } from './draftTypes';
import { loadSigningIntent, unsignedPsbtSha256 } from './bitcoin/signingIntent';

const log = createLogger('DRAFT:SVC_CREATE');

type CreateDraftDbClient = DraftDbClient & DraftLockDbClient;
type DraftRequestJsonField = CreateDraftInput['outputs'];

export interface CreateDraftOptions {
  client?: CreateDraftDbClient;
  runSideEffects?: boolean;
}

const optionalDraftJsonField = (value: DraftRequestJsonField): unknown => {
  return value === null ? undefined : value;
};

const toDraftAmountNumber = (value: unknown): unknown => {
  return typeof value === 'string' ? Number(value) : value;
};

const normalizeDraftJsonAmounts = (
  value: DraftRequestJsonField
): Prisma.InputJsonValue | null => {
  if (value === undefined || value === null) {
    return null;
  }

  return (value as Array<Record<string, unknown>>).map((item) => ({
    ...item,
    amount: toDraftAmountNumber(item.amount),
  })) as Prisma.InputJsonValue;
};

const buildDraftRequestValidationInput = (data: CreateDraftInput): Record<string, unknown> => ({
  recipient: data.recipient,
  amount: data.amount,
  feeRate: data.feeRate,
  selectedUtxoIds: data.selectedUtxoIds,
  enableRBF: data.enableRBF,
  subtractFees: data.subtractFees,
  sendMax: data.sendMax,
  outputs: optionalDraftJsonField(data.outputs),
  inputs: optionalDraftJsonField(data.inputs),
  decoyOutputs: optionalDraftJsonField(data.decoyOutputs),
  payjoinUrl: data.payjoinUrl,
  isRBF: data.isRBF,
  label: data.label,
  memo: data.memo,
  psbtBase64: data.psbtBase64,
  fee: data.fee,
  totalInput: data.totalInput,
  totalOutput: data.totalOutput,
  changeAmount: data.changeAmount,
  changeAddress: data.changeAddress,
  effectiveAmount: data.effectiveAmount,
  inputPaths: data.inputPaths,
  signedPsbtBase64: data.signedPsbtBase64,
  signedDeviceId: data.signedDeviceId,
  intentId: data.intentId,
  intentDigest: data.intentDigest,
});

const assertValidCreateDraftInput = (data: CreateDraftInput): void => {
  if (!CreateDraftRequestSchema.safeParse(buildDraftRequestValidationInput(data)).success) {
    throw new InvalidInputError('recipient, amount, feeRate, and psbtBase64 are required');
  }
};

const getDraftExpirationDays = async (): Promise<number> => {
  return systemSettingRepository.getParsed(
    'draftExpirationDays',
    SystemSettingSchemas.number,
    DEFAULT_DRAFT_EXPIRATION_DAYS
  );
};

const calculateExpirationDate = async (): Promise<Date> => {
  const expirationDays = await getDraftExpirationDays();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expirationDays);
  return expiresAt;
};

const buildDraftBehaviorFields = (data: CreateDraftInput) => ({
  selectedUtxoIds: data.selectedUtxoIds || [],
  enableRBF: data.enableRBF ?? true,
  subtractFees: data.subtractFees ?? false,
  sendMax: data.sendMax ?? false,
  isRBF: data.isRBF ?? false,
});

const buildDraftJsonFields = (data: CreateDraftInput) => ({
  outputs: normalizeDraftJsonAmounts(data.outputs),
  inputs: normalizeDraftJsonAmounts(data.inputs),
  decoyOutputs: normalizeDraftJsonAmounts(data.decoyOutputs),
});

const buildDraftTextFields = (data: CreateDraftInput) => ({
  payjoinUrl: data.payjoinUrl || null,
  label: data.label || null,
  memo: data.memo || null,
  changeAddress: data.changeAddress || null,
});

const buildDraftAmountFields = (data: CreateDraftInput) => ({
  amount: BigInt(data.amount),
  fee: BigInt(data.fee || 0),
  totalInput: BigInt(data.totalInput || 0),
  totalOutput: BigInt(data.totalOutput || 0),
  changeAmount: BigInt(data.changeAmount || 0),
  effectiveAmount: BigInt(data.effectiveAmount || data.amount),
});

const buildDraftAgentFields = (data: CreateDraftInput) => ({
  agentId: data.agentId ?? null,
  agentOperationalWalletId: data.agentOperationalWalletId ?? null,
});

const createDraftRecord = async (
  walletId: string,
  userId: string,
  data: CreateDraftInput,
  initialSigningState: InitialSigningState,
  signingContext: Prisma.InputJsonValue,
  client?: Pick<CreateDraftDbClient, 'draftTransaction'>
): Promise<DraftTransaction> => {
  const draftData = {
    walletId,
    userId,
    recipient: data.recipient,
    feeRate: Number(data.feeRate),
    ...buildDraftBehaviorFields(data),
    ...buildDraftJsonFields(data),
    ...buildDraftTextFields(data),
    ...buildDraftAmountFields(data),
    ...buildDraftAgentFields(data),
    psbtBase64: data.psbtBase64,
    signedPsbtBase64: initialSigningState.signedPsbtBase64,
    signedDeviceIds: initialSigningState.signedDeviceIds,
    status: initialSigningState.status,
    inputPaths: data.inputPaths || [],
    signingIntentId: data.intentId,
    signingIntentDigest: data.intentDigest,
    signingContext,
    expiresAt: await calculateExpirationDate(),
  };

  return client ? draftRepository.create(draftData, client) : draftRepository.create(draftData);
};

const lockSelectedUtxos = async (
  walletId: string,
  draft: DraftTransaction,
  data: CreateDraftInput,
  client?: Pick<CreateDraftDbClient, 'draftUtxoLock' | 'uTXO'>
): Promise<void> => {
  if (!data.selectedUtxoIds || data.selectedUtxoIds.length === 0 || data.isRBF) {
    return;
  }

  const { found: utxoIds, notFound } = client
    ? await resolveUtxoIds(walletId, data.selectedUtxoIds, client)
    : await resolveUtxoIds(walletId, data.selectedUtxoIds);
  if (notFound.length > 0) {
    log.warn('Some UTXOs not found for locking', { notFound, draftId: draft.id });
  }

  if (utxoIds.length === 0) {
    return;
  }

  const lockResult = await lockUtxosForDraft(draft.id, utxoIds, {
    isRBF: false,
    ...(client && { client }),
  });
  if (!lockResult.success) {
    if (!client) {
      await draftRepository.remove(draft.id);
    }
    throw new ConflictError('One or more UTXOs are already locked by another draft transaction');
  }

  log.debug('Locked UTXOs for draft', {
    draftId: draft.id,
    lockedCount: lockResult.lockedCount,
  });
};

const createApprovalRequestsIfNeeded = async (
  draft: DraftTransaction,
  walletId: string,
  userId: string,
  data: CreateDraftInput
): Promise<void> => {
  if (!data.policyEvaluation?.triggered?.some(t => t.action === 'approval_required')) {
    return;
  }

  try {
    await approvalService.createApprovalRequestsForDraft(
      draft.id,
      walletId,
      userId,
      data.policyEvaluation.triggered
    );
  } catch (err) {
    log.error('Failed to create approval requests', { error: getErrorMessage(err), draftId: draft.id });
  }
};

const dispatchCreatedDraftNotification = (
  walletId: string,
  userId: string,
  draft: DraftTransaction,
  data: CreateDraftInput
): void => {
  dispatchDraftNotification(walletId, {
    id: draft.id,
    amount: draft.amount,
    recipient: draft.recipient,
    label: draft.label,
    feeRate: draft.feeRate,
    agentId: data.agentId ?? null,
    /* v8 ignore start -- agent-created drafts pass a notification label from the service layer */
    agentName: data.agentId ? data.notificationCreatedByLabel ?? null : null,
    /* v8 ignore stop */
    agentOperationalWalletId: data.agentOperationalWalletId ?? null,
    agentSigned: Boolean(data.agentId && data.signedDeviceId),
    /* v8 ignore start -- agent-created draft path supplies linked operational wallet id */
    dedupeKey: data.agentId
      ? `agent:${data.agentId}:${walletId}:${data.agentOperationalWalletId ?? ''}:${draft.recipient}:${draft.amount.toString()}`
      : undefined,
    /* v8 ignore stop */
  }, data.notificationCreatedByUserId === undefined ? userId : data.notificationCreatedByUserId, data.notificationCreatedByLabel).catch(err => {
    log.warn('Failed to send draft notification', { error: getErrorMessage(err) });
  });
};

export async function runDraftCreatedSideEffects(
  walletId: string,
  userId: string,
  draft: DraftTransaction,
  data: CreateDraftInput
): Promise<void> {
  await createApprovalRequestsIfNeeded(draft, walletId, userId, data);
  dispatchCreatedDraftNotification(walletId, userId, draft, data);
}

/**
 * Create a new draft transaction.
 */
export async function createDraft(
  walletId: string,
  userId: string,
  data: CreateDraftInput,
  options: CreateDraftOptions = {}
): Promise<DraftTransaction> {
  const intent = await loadSigningIntent(
    { intentId: data.intentId, intentDigest: data.intentDigest },
    walletId,
  );
  if (unsignedPsbtSha256(data.psbtBase64) !== intent.unsignedPsbtSha256) {
    throw new InvalidInputError('Draft PSBT does not match the server-issued signing intent');
  }
  if (!intent.signingContext) {
    throw new InvalidInputError('Draft signing intent has no authenticated account binding');
  }
  assertValidCreateDraftInput(data);

  const initialSigningState = await validateInitialSigningState(walletId, data);
  const draft = await createDraftRecord(
    walletId,
    userId,
    data,
    initialSigningState,
    intent.signingContext as Prisma.InputJsonValue,
    options.client,
  );
  await lockSelectedUtxos(walletId, draft, data, options.client);

  log.info('Created draft', { draftId: draft.id, walletId, userId, isRBF: data.isRBF ?? false });

  if (options.runSideEffects !== false) {
    await runDraftCreatedSideEffects(walletId, userId, draft, data);
  }

  return draft;
}
