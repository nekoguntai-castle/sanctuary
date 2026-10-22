import type { DraftTransaction, Prisma } from '../generated/prisma/client';
import {
  CreateDraftRequestSchema,
  type CreateDraftRequest,
  type DraftDecoyOutputRequest,
  type DraftInputRequest,
  type DraftOutputRequest,
} from '@sanctuary/shared/schemas/draftRequests';
import { canonicalSegwitAddressCase } from '@sanctuary/shared/utils/bitcoin';
import { draftRepository, systemSettingRepository, transactionSigningIntentRepository } from '../repositories';
import type { DraftDbClient } from '../repositories/draftRepository';
import type { DraftLockDbClient } from '../repositories/draftLockRepository';
import type { SigningIntentDraftLockDbClient } from '../repositories/transactionSigningIntentRepository';
import { ConflictError, ForbiddenError, InvalidInputError } from '../errors';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { SystemSettingSchemas } from '../utils/safeJson';
import { DEFAULT_DRAFT_EXPIRATION_DAYS } from '../constants';
import { lockUtxosForDraft, resolveUtxoIds } from './draftLockService';
import { dispatchDraftNotification } from './notifications/dispatch';
import { approvalService, type ApprovalDbClient } from './vaultPolicy/approvalService';
import { validateInitialSigningState } from './draftSigning';
import type { CreateDraftInput, InitialSigningState } from './draftTypes';
import {
  deriveIntentSpend,
  hasPayjoinReplacement,
  loadSigningIntent,
  unsignedPsbtSha256,
  type IntentSpend,
  type SigningIntentEnvelope,
} from './bitcoin/signingIntent';
import { policyEvaluationEngine } from './vaultPolicy/policyEvaluationEngine';
import { buildIntentPolicyInput, requiresEnforcedApproval } from './vaultPolicy/intentPolicyInput';

const log = createLogger('DRAFT:SVC_CREATE');

type CreateDraftDbClient = DraftDbClient & DraftLockDbClient & ApprovalDbClient & SigningIntentDraftLockDbClient;
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

const requiresApproval = (data: CreateDraftInput): boolean =>
  data.policyEvaluation !== undefined && requiresEnforcedApproval(data.policyEvaluation);

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

/** Returns the request as the strict schema parsed it, so the display rules read typed entries. */
const parseCreateDraftInput = (data: CreateDraftInput): CreateDraftRequest => {
  const parsed = CreateDraftRequestSchema.safeParse(buildDraftRequestValidationInput(data));
  if (!parsed.success) {
    throw new InvalidInputError('recipient, amount, feeRate, and psbtBase64 are required');
  }
  return parsed.data;
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
  /* v8 ignore next -- createDraft binds selectedUtxoIds to the intent first; defensive default only */
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
  client: Pick<CreateDraftDbClient, 'draftTransaction'>
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
    approvalStatus: requiresApproval(data) ? 'pending' : undefined,
    inputPaths: data.inputPaths || [],
    signingIntentId: data.intentId,
    signingIntentDigest: data.intentDigest,
    signingContext,
    expiresAt: await calculateExpirationDate(),
  };

  return draftRepository.create(draftData, client);
};

const lockSelectedUtxos = async (
  walletId: string,
  draft: DraftTransaction,
  data: CreateDraftInput,
  client: Pick<CreateDraftDbClient, 'draftUtxoLock' | 'uTXO'>
): Promise<void> => {
  if (!data.selectedUtxoIds || data.selectedUtxoIds.length === 0 || data.isRBF) {
    return;
  }

  const { found: utxoIds, notFound } = await resolveUtxoIds(walletId, data.selectedUtxoIds, client);
  if (notFound.length > 0) {
    log.warn('Some UTXOs not found for locking', { notFound, draftId: draft.id });
  }

  if (utxoIds.length === 0) {
    return;
  }

  const lockResult = await lockUtxosForDraft(draft.id, utxoIds, { isRBF: false, client });
  if (!lockResult.success) {
    // Thrown inside the draft's transaction, so the draft insert rolls back.
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
  data: CreateDraftInput,
  client?: ApprovalDbClient
): Promise<void> => {
  if (!requiresApproval(data)) {
    return;
  }

  const triggered = data.policyEvaluation!.triggered!;
  await approvalService.createApprovalRequestsForDraft(
    draft.id,
    walletId,
    userId,
    triggered,
    client
  );
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
    approvalRequired: draft.approvalStatus === 'pending',
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
  data: CreateDraftInput,
  client?: ApprovalDbClient
): Promise<void> {
  await createApprovalRequestsIfNeeded(draft, walletId, userId, data, client);
  dispatchCreatedDraftNotification(walletId, userId, draft, data);
}

/**
 * Post-commit notification dispatch for drafts created through an external
 * transaction client. Approval requests must already exist (created inside the
 * caller's transaction); this helper only dispatches notifications and never
 * creates approval requests.
 */
export const dispatchDraftCreatedPostCommitNotifications = (
  walletId: string,
  userId: string,
  draft: DraftTransaction,
  data: CreateDraftInput
): void => {
  dispatchCreatedDraftNotification(walletId, userId, draft, data);
};

/** A payjoin replacement, or an original one was minted from, cannot back a draft (C-D9). */
const payjoinIntentNotDraftable = (): ConflictError =>
  new ConflictError('Payjoin intents cannot be saved as drafts', undefined, {
    reason: 'payjoin_intent_not_draftable',
  });

const persistDraftWithLocks = async (
  walletId: string,
  userId: string,
  data: CreateDraftInput,
  initialSigningState: InitialSigningState,
  signingContext: Prisma.InputJsonValue,
  client: CreateDraftDbClient
): Promise<DraftTransaction> => {
  // Holds the intent row until this transaction commits, so a concurrent
  // payjoin supersession either finished first (nothing to lock) or waits and
  // then sees this draft (C-D9).
  if (!await transactionSigningIntentRepository.lockDraftableIntent(data.intentId, walletId, client)) {
    // The lock waited out the superseding transaction, so its successor is
    // committed and visible; only a payjoin replacement is a C-D9 refusal.
    if (await hasPayjoinReplacement(walletId, data.intentId)) throw payjoinIntentNotDraftable();
    throw new InvalidInputError('Signing intent has been superseded', 'intentId', { reason: 'stale_intent' });
  }
  const draft = await createDraftRecord(
    walletId,
    userId,
    data,
    initialSigningState,
    signingContext,
    client
  );
  await lockSelectedUtxos(walletId, draft, data, client);
  return draft;
};

// ========================================
// DRAFT ↔ SIGNING INTENT BINDING
// ========================================
//
// The stored recipient/amount/fee/selected UTXOs are what reviewers see, what
// broadcast compares and what gets locked, so they must describe the spend the
// intent actually signs. Omitted fields are compared as their stored defaults
// (selectedUtxoIds [] and fee 0), never skipped. The rules mirror broadcast's
// canonical comparisons.

const intentMismatch = (field: string, expected: unknown, actual: unknown): InvalidInputError =>
  new InvalidInputError('Draft does not match the server-issued signing intent', field, {
    reason: 'metadata_mismatch',
    expected,
    actual,
  });

/** A draft integer (number or numeric string) must be a safe integer equal to the canonical one. */
const assertIntegerMatches = (field: string, expected: number, value: unknown): void => {
  const actual = Number(value);
  if (!Number.isSafeInteger(actual) || !Number.isSafeInteger(expected) || actual !== expected) {
    throw intentMismatch(field, expected, actual);
  }
};

const sumAmounts = (items: Array<{ amount: number }>): number =>
  items.reduce((sum, item) => sum + item.amount, 0);

/** Txids compare case-insensitively wherever an outpoint is keyed. */
const outpointKey = (txid: string, vout: number): string => `${txid.toLowerCase()}:${vout}`;

/** (i) The selected UTXOs are exactly the intent's inputs; returns them normalised for locking. */
const assertSelectedOutpointsMatch = (data: CreateDraftInput, spend: IntentSpend): string[] => {
  const selected = (data.selectedUtxoIds || []).map(id => id.toLowerCase());
  const canonical = new Set(spend.inputs.map(input => outpointKey(input.txid, input.vout)));
  const distinct = new Set(selected);
  const matches = distinct.size === selected.length
    && distinct.size === canonical.size
    && selected.every(id => canonical.has(id));
  if (!matches) {
    throw intentMismatch('selectedUtxoIds', [...canonical], data.selectedUtxoIds ?? []);
  }
  return selected;
};

/** (ii) The fee is the intent's inputs minus outputs. */
const assertFeeMatches = (data: CreateDraftInput, totalInput: number, totalOutput: number): void => {
  assertIntegerMatches('fee', totalInput - totalOutput, data.fee || 0);
};

/** (iii) The recipient is the first external output (deterministic in both transaction builders). */
const assertRecipientMatches = (data: CreateDraftInput, spend: IntentSpend): void => {
  const expected = spend.externalOutputs[0].address;
  if (canonicalSegwitAddressCase(data.recipient) !== expected) {
    throw intentMismatch('recipient', expected, data.recipient);
  }
};

/** (iii) The effective amount is the intent's net spend; sendMax/subtractFees are client flags, so no exemption. */
const assertAmountMatches = (data: CreateDraftInput, spend: IntentSpend): void => {
  assertIntegerMatches('amount', spend.amount, data.effectiveAmount || data.amount);
};

/** (x) The stored amount is the stored effective amount, which (iii) binds to the intent when anything leaves the wallet. */
const assertStoredAmountMatches = (data: CreateDraftInput): void => {
  assertIntegerMatches('amount', Number(data.effectiveAmount || data.amount), data.amount);
};

/** (iv) Reported totals, when supplied non-zero, are the intent's sums. */
const assertTotalsMatch = (data: CreateDraftInput, totalInput: number, totalOutput: number): void => {
  const totals: Array<[string, unknown, number]> = [
    ['totalInput', data.totalInput, totalInput],
    ['totalOutput', data.totalOutput, totalOutput],
  ];
  for (const [field, value, expected] of totals) {
    if (value !== undefined && Number(value) !== 0) {
      assertIntegerMatches(field, expected, value);
    }
  }
};

/** (iii) With nothing paid outside the wallet, the recipient is still one of the intent's outputs. */
const assertConsolidationRecipient = (data: CreateDraftInput, spend: IntentSpend): void => {
  const recipient = canonicalSegwitAddressCase(data.recipient);
  if (!spend.outputs.some(output => output.address === recipient)) {
    throw intentMismatch('recipient', spend.outputs.map(output => output.address), data.recipient);
  }
};

type IntentOutput = IntentSpend['outputs'][number];
/** Intent output indexes already backing a displayed entry, shared by outputs, decoys and change. */
type ClaimedOutputs = Set<number>;

const isExternalOutput = (output: IntentOutput): boolean =>
  !output.isOurs && output.address.length > 0 && output.amount > 0;

/**
 * Claim the first unclaimed intent output at `address` that `fits`; -1 when
 * none does. Each intent output backs at most one displayed entry, whether it
 * is shown as an output, a decoy or the change.
 */
const claimOutput = (
  spend: IntentSpend,
  claimed: ClaimedOutputs,
  address: string,
  fits: (output: IntentOutput) => boolean,
): number => {
  const wanted = canonicalSegwitAddressCase(address);
  const index = spend.outputs.findIndex((output, i) => !claimed.has(i) && output.address === wanted && fits(output));
  if (index >= 0) claimed.add(index);
  return index;
};

/**
 * A displayed output amount is the intent's, except the two client shapes the
 * send flow stores: a sendMax entry may carry 0, and a subtractFees entry the
 * typed amount, which exceeds the paid amount by at most the fee not already
 * taken by earlier entries.
 */
const outputAmountFits = (
  request: CreateDraftRequest,
  entry: DraftOutputRequest,
  canonical: number,
  unclaimedFee: number,
): boolean => {
  const amount = Number(entry.amount);
  if (amount === canonical) return true;
  if (entry.sendMax === true && request.sendMax === true && amount === 0) return true;
  return request.subtractFees === true && amount > canonical && amount <= canonical + unclaimedFee;
};

/** Claims an intent output for every entry; false when one has none. Overstatements share one fee budget. */
const claimOutputEntries = (
  request: CreateDraftRequest,
  entries: DraftOutputRequest[],
  spend: IntentSpend,
  fee: number,
  claimed: ClaimedOutputs,
): boolean => {
  let unclaimedFee = fee;
  for (const entry of entries) {
    const index = claimOutput(spend, claimed, entry.address,
      output => outputAmountFits(request, entry, output.amount, unclaimedFee));
    if (index < 0) return false;
    unclaimedFee -= Math.max(0, Number(entry.amount) - spend.outputs[index].amount);
  }
  return true;
};

/**
 * (vi) Every displayed output is a distinct intent output, every external
 * output is displayed, and at most one entry is sendMax. Omitted outputs fall
 * back to the bound recipient, so they are allowed only when the intent pays at
 * most one external output.
 */
const assertOutputListMatches = (
  request: CreateDraftRequest,
  spend: IntentSpend,
  fee: number,
  claimed: ClaimedOutputs,
): void => {
  const entries = request.outputs ?? [];
  if (entries.length === 0 && spend.externalOutputs.length <= 1) return;
  const listed = entries.filter(entry => entry.sendMax === true).length <= 1
    && claimOutputEntries(request, entries, spend, fee, claimed);
  if (!listed || !spend.outputs.every((output, i) => claimed.has(i) || !isExternalOutput(output))) {
    throw intentMismatch('outputs', spend.outputs.map(({ address, amount }) => ({ address, amount })), request.outputs);
  }
};

/** (vii) Each decoy is a distinct, otherwise undisplayed wallet-owned intent output with its amount. */
const assertDecoysMatch = (request: CreateDraftRequest, spend: IntentSpend, claimed: ClaimedOutputs): void => {
  const decoys: DraftDecoyOutputRequest[] = request.decoyOutputs ?? [];
  for (const decoy of decoys) {
    const amount = Number(decoy.amount);
    if (claimOutput(spend, claimed, decoy.address, output => output.isOurs && output.amount === amount) < 0) {
      throw intentMismatch('decoyOutputs', undefined, request.decoyOutputs);
    }
  }
};

/**
 * (vii) The change address is an otherwise undisplayed wallet-owned intent
 * output paying exactly the change amount; with no change address the change
 * amount is 0 (decoy change is reported through decoyOutputs). Compared as
 * stored (`changeAmount || 0`).
 */
const assertChangeMatches = (request: CreateDraftRequest, spend: IntentSpend, claimed: ClaimedOutputs): void => {
  const changeAmount = Number(request.changeAmount || 0);
  if (!request.changeAddress) {
    assertIntegerMatches('changeAmount', 0, changeAmount);
    return;
  }
  if (claimOutput(spend, claimed, request.changeAddress, output => output.isOurs && output.amount === changeAmount) < 0) {
    throw intentMismatch('changeAddress', undefined, { changeAddress: request.changeAddress, changeAmount: request.changeAmount });
  }
};

/** One claimed set, so no intent output is shown as more than one of an output, a decoy and the change. */
const assertDisplayOutputsMatch = (request: CreateDraftRequest, spend: IntentSpend, fee: number): void => {
  const claimed: ClaimedOutputs = new Set();
  // Decoys and change need an exact amount on a wallet-owned output, so they claim first; only the flexible
  // outputs entries (subtractFees overstatement, sendMax 0) are then matched greedily against what is left.
  assertDecoysMatch(request, spend, claimed);
  assertChangeMatches(request, spend, claimed);
  assertOutputListMatches(request, spend, fee, claimed);
};

/** (viii) Displayed inputs, when supplied, are exactly the intent's inputs with their prevout address and amount. */
const assertDisplayInputsMatch = (request: CreateDraftRequest, spend: IntentSpend): void => {
  const entries: DraftInputRequest[] = request.inputs ?? [];
  if (entries.length === 0) return;
  const canonical = new Map(spend.inputs.map(input => [outpointKey(input.txid, input.vout), input]));
  const seen = new Set<string>();
  const matches = entries.length === canonical.size && entries.every(entry => {
    const key = outpointKey(entry.txid, entry.vout);
    const input = canonical.get(key);
    if (!input || seen.has(key)) return false;
    seen.add(key);
    return canonicalSegwitAddressCase(entry.address) === input.address && Number(entry.amount) === input.amount;
  });
  if (!matches) {
    throw intentMismatch('inputs', [...canonical.keys()], request.inputs);
  }
};

/** (v) isRBF (which skips UTXO locks) needs the intent's authenticated replacement target. */
const assertRbfBinding = (data: CreateDraftInput, spend: IntentSpend): void => {
  if (data.isRBF === true && !spend.replacementTxid) {
    throw intentMismatch('isRBF', false, true);
  }
};

/**
 * Refuse a draft whose display fields (recipient, amount, outputs, inputs,
 * change, decoys), totals, selected UTXOs or RBF flag
 * disagree with the signing intent. Returns the input with its selected UTXO
 * ids normalised, so the locks cover the PSBT's real inputs. `request` is
 * `data` as the strict schema parsed it; the display rules read its entries.
 */
const assertDraftMatchesIntent = (
  data: CreateDraftInput,
  request: CreateDraftRequest,
  spend: IntentSpend,
): CreateDraftInput => {
  const selectedUtxoIds = assertSelectedOutpointsMatch(data, spend);
  const totalInput = sumAmounts(spend.inputs);
  const totalOutput = sumAmounts(spend.outputs);
  assertFeeMatches(data, totalInput, totalOutput);
  if (spend.externalOutputs.length > 0) {
    assertRecipientMatches(data, spend);
    assertAmountMatches(data, spend);
  } else {
    assertConsolidationRecipient(data, spend);
  }
  assertStoredAmountMatches(data);
  assertTotalsMatch(data, totalInput, totalOutput);
  assertRbfBinding(data, spend);
  assertDisplayOutputsMatch(request, spend, totalInput - totalOutput);
  assertDisplayInputsMatch(request, spend);
  return { ...data, selectedUtxoIds };
};

/**
 * Every draft is evaluated against vault policy: a caller that already
 * evaluated (the agent funding path) passes its result, and anything else
 * (POST /drafts, RBF/CPFP drafts) is evaluated here from the authenticated
 * signing intent, so an enforce-mode approval_required policy makes the draft
 * `pending` with approval requests. Nothing to evaluate when the intent pays
 * nothing outside the wallet.
 */
const withServerPolicyEvaluation = async (
  data: CreateDraftInput,
  walletId: string,
  userId: string,
  intent: Pick<SigningIntentEnvelope, 'snapshot'>,
  spend: IntentSpend,
): Promise<CreateDraftInput> => {
  if (data.policyEvaluation !== undefined) return data;
  const input = await buildIntentPolicyInput(walletId, userId, intent, spend);
  if (!input) return data;
  const policyEvaluation = await policyEvaluationEngine.evaluatePolicies(input);
  if (!policyEvaluation.allowed) throw new ForbiddenError('Transaction blocked by vault policy');
  return { ...data, policyEvaluation };
};

/**
 * A payjoin replacement intent, or an original a payjoin proposal was minted
 * from, is never saved as a draft (C-D9): the proposal is signed and broadcast
 * in one flow, and its original is only the fallback for that flow. This is
 * the early refusal; the intent row lock taken with the draft insert
 * (persistDraftWithLocks) closes the race with a concurrent supersession.
 */
const assertIntentDraftable = async (
  walletId: string,
  intent: Pick<SigningIntentEnvelope, 'intentId' | 'source'>,
): Promise<void> => {
  if (intent.source === 'payjoin' || await hasPayjoinReplacement(walletId, intent.intentId)) {
    throw payjoinIntentNotDraftable();
  }
};

/**
 * Create a new draft transaction.
 */
export async function createDraft(
  walletId: string,
  userId: string,
  data: CreateDraftInput,
  options: CreateDraftOptions = {}
): Promise<DraftTransaction> {
  if (options.client && options.runSideEffects !== false) {
    throw new InvalidInputError(
      'External-client draft creation requires runSideEffects: false'
    );
  }

  const intent = await loadSigningIntent(
    { intentId: data.intentId, intentDigest: data.intentDigest },
    walletId,
  );
  await assertIntentDraftable(walletId, intent);
  if (unsignedPsbtSha256(data.psbtBase64) !== intent.unsignedPsbtSha256) {
    throw new InvalidInputError('Draft PSBT does not match the server-issued signing intent');
  }
  if (!intent.signingContext) {
    throw new InvalidInputError('Draft signing intent has no authenticated account binding');
  }
  const request = parseCreateDraftInput(data);
  // Derived once (the same derivation broadcast makes) and reused for policy.
  const spend = await deriveIntentSpend(walletId, intent.snapshot.network, intent.snapshot);
  // Assigned back to `data`: the binding normalises the selected UTXO ids, and
  // requiresApproval(data) is recomputed by the record builder and the
  // approval-request step below.
  data = assertDraftMatchesIntent(data, request, spend);
  data = await withServerPolicyEvaluation(data, walletId, userId, intent, spend);

  const initialSigningState = await validateInitialSigningState(walletId, data);
  const signingContext = intent.signingContext as Prisma.InputJsonValue;

  // One transaction locks the intent row, creates the draft, locks UTXOs and,
  // for an approval-required draft (born pending), sets up approval requests
  // exactly once. Any error propagates so the whole unit rolls back. An
  // external client is the caller's own transaction: the same steps run in it.
  const persist = async (client: CreateDraftDbClient): Promise<DraftTransaction> => {
    const created = await persistDraftWithLocks(walletId, userId, data, initialSigningState, signingContext, client);
    await createApprovalRequestsIfNeeded(created, walletId, userId, data, client);
    return created;
  };
  const draft = options.client === undefined
    ? await draftRepository.withTransaction(persist)
    : await persist(options.client);

  log.info('Created draft', { draftId: draft.id, walletId, userId, isRBF: data.isRBF ?? false });

  // External-client creation always defers side effects (checked above).
  // Approval setup already ran inside the transaction; the draft-created
  // notification carries the approval-required mark.
  if (options.runSideEffects !== false) {
    dispatchCreatedDraftNotification(walletId, userId, draft, data);
  }

  return draft;
}
