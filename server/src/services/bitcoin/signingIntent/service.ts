import * as bitcoin from 'bitcoinjs-lib';
import { InvalidInputError } from '../../../errors/ApiError';
import { transactionSigningIntentRepository } from '../../../repositories/transactionSigningIntentRepository';
import { draftSigningIntentRepository } from '../../../repositories/draftSigningIntentRepository';
import { isBitcoinNetwork } from '../networks';
import {
  buildSigningIntentSnapshot,
  calculateSigningIntentDigest,
  defaultInputRoles,
  unsignedPsbtSha256,
} from './canonical';
import { authenticateIntentPrevouts } from './prevoutValidation';
import { toPrismaInputJson } from './json';
import { SigningIntentFeePolicySchema, SigningIntentSnapshotSchema } from './schema';
import { PsbtSigningContextSchema } from '@sanctuary/shared/schemas/psbtSigningContext';
import { assertPsbtMatchesSigningContext } from '../psbtSigningContextValidation';
import {
  SIGNING_INTENT_SNAPSHOT_VERSION,
  SIGNING_INTENT_SOURCE_VALUES,
  type CreateSigningIntentInput,
  type SigningIntentEnvelope,
  type SigningIntentHandle,
  type IssuedSigningIntentHandle,
  type SigningIntentSource,
} from './types';

const DEFAULT_INTENT_LIFETIME_MS = 24 * 60 * 60 * 1000;

const parsePsbt = (value: string, field: string): bitcoin.Psbt => {
  try {
    return bitcoin.Psbt.fromBase64(value);
  } catch {
    throw new InvalidInputError('Invalid PSBT', field, { reason: 'invalid_psbt' });
  }
};

const parseSource = (value: string): SigningIntentSource => {
  if (SIGNING_INTENT_SOURCE_VALUES.includes(value as SigningIntentSource)) {
    return value as SigningIntentSource;
  }
  throw new InvalidInputError('Stored signing intent has an unsupported source', 'intentId', {
    reason: 'missing_intent',
  });
};

export const createSigningIntent = async (
  input: CreateSigningIntentInput,
): Promise<IssuedSigningIntentHandle> => {
  const psbt = parsePsbt(input.unsignedPsbtBase64, 'psbtBase64');
  const signingContext = PsbtSigningContextSchema.parse(input.signingContext);
  const feePolicy = SigningIntentFeePolicySchema.parse(input.feePolicy);
  if (signingContext.walletId !== input.walletId || signingContext.network !== input.network) {
    throw new InvalidInputError('Signing context does not match signing intent scope');
  }
  const roles = input.inputRoles ?? defaultInputRoles(psbt.inputCount);
  assertPsbtMatchesSigningContext(psbt, signingContext, roles);
  const prevouts = await authenticateIntentPrevouts(
    input.walletId,
    input.network,
    psbt,
    roles,
    undefined,
    input.replacementTxid,
  );
  const snapshot = buildSigningIntentSnapshot(
    input.walletId,
    input.network,
    psbt,
    prevouts,
    feePolicy,
    input.replacementTxid,
  );
  const snapshotDigest = calculateSigningIntentDigest(snapshot, signingContext);
  const psbtHash = unsignedPsbtSha256(input.unsignedPsbtBase64);
  const record = await transactionSigningIntentRepository.create({
    walletId: input.walletId,
    createdByUserId: input.createdByUserId,
    network: input.network,
    source: input.source,
    snapshotVersion: SIGNING_INTENT_SNAPSHOT_VERSION,
    snapshot: toPrismaInputJson(snapshot),
    signingContext: toPrismaInputJson(signingContext),
    snapshotDigest,
    unsignedPsbtBase64: input.unsignedPsbtBase64,
    unsignedPsbtSha256: psbtHash,
    expiresAt: input.expiresAt ?? new Date(Date.now() + DEFAULT_INTENT_LIFETIME_MS),
    supersedesIntentId: input.supersedesIntentId,
  });
  return { intentId: record.id, intentDigest: record.snapshotDigest, signingContext };
};

const invalidIntent = (message: string, reason = 'missing_intent'): InvalidInputError =>
  new InvalidInputError(message, 'intentId', { reason });

type StoredSigningIntent = NonNullable<
  Awaited<ReturnType<typeof transactionSigningIntentRepository.findById>>
>;

const assertStoredIntentScope = (record: StoredSigningIntent, handle: SigningIntentHandle, walletId: string): void => {
  if (record.walletId !== walletId) throw invalidIntent('Signing intent was not found');
  if (record.snapshotDigest !== handle.intentDigest) throw invalidIntent('Signing intent digest does not match');
  if (record.snapshotVersion !== 1 && record.snapshotVersion !== SIGNING_INTENT_SNAPSHOT_VERSION) {
    throw invalidIntent('Signing intent version is unsupported');
  }
  if (record.supersededById) throw invalidIntent('Signing intent has been superseded', 'stale_intent');
  if (!isBitcoinNetwork(record.network)) throw invalidIntent('Signing intent network is invalid', 'wrong_network');
};

const resolveAuthenticatedReplay = (
  record: StoredSigningIntent,
  allowReplay: boolean,
): SigningIntentEnvelope['broadcastReplay'] | undefined => {
  if (!record.consumedAt) return undefined;
  const replayState = record.broadcastState === 'accepted' || record.broadcastState === 'complete'
    ? record.broadcastState
    : undefined;
  if (!allowReplay || !replayState || !record.broadcastTxid || !record.broadcastRawTx) {
    throw invalidIntent('Signing intent has already been consumed', 'duplicate_submission');
  }
  return {
    state: replayState,
    txid: record.broadcastTxid,
    rawTx: record.broadcastRawTx,
  };
};

const authenticateStoredSnapshot = (record: StoredSigningIntent, walletId: string) => {
  const parsed = SigningIntentSnapshotSchema.safeParse(record.snapshot);
  if (!parsed.success) throw invalidIntent('Signing intent snapshot is malformed');
  if (parsed.data.version !== record.snapshotVersion) {
    throw invalidIntent('Signing intent snapshot version does not match its stored version');
  }
  if (parsed.data.walletId !== walletId || parsed.data.network !== record.network) {
    throw invalidIntent('Signing intent identity does not match its stored scope');
  }
  return parsed.data;
};

const assertStoredPsbtAuthentic = (record: StoredSigningIntent): void => {
  if (unsignedPsbtSha256(record.unsignedPsbtBase64) !== record.unsignedPsbtSha256) {
    throw invalidIntent('Signing intent PSBT authentication failed');
  }
};

export const loadSigningIntent = async (
  handle: SigningIntentHandle,
  walletId: string,
  options: { allowConsumedBroadcastReplay?: boolean } = {},
): Promise<SigningIntentEnvelope> => {
  const record = await transactionSigningIntentRepository.findById(handle.intentId);
  if (!record) throw invalidIntent('Signing intent was not found');
  assertStoredIntentScope(record, handle, walletId);
  const broadcastReplay = resolveAuthenticatedReplay(
    record,
    options.allowConsumedBroadcastReplay === true,
  );
  if (!broadcastReplay && record.expiresAt.getTime() <= Date.now()) {
    throw invalidIntent('Signing intent has expired', 'stale_intent');
  }
  const snapshot = authenticateStoredSnapshot(record, walletId);
  const signingContext = PsbtSigningContextSchema.safeParse(record.signingContext);
  if (!signingContext.success || signingContext.data.walletId !== walletId) {
    throw invalidIntent('Signing intent account binding is malformed');
  }
  if (calculateSigningIntentDigest(snapshot, signingContext.data) !== record.snapshotDigest) {
    throw invalidIntent('Signing intent snapshot or account binding authentication failed');
  }
  assertStoredPsbtAuthentic(record);

  return {
    intentId: record.id,
    intentDigest: record.snapshotDigest,
    snapshot,
    unsignedPsbtBase64: record.unsignedPsbtBase64,
    unsignedPsbtSha256: record.unsignedPsbtSha256,
    source: parseSource(record.source),
    expiresAt: record.expiresAt,
    signingContext: signingContext.data,
    ...(broadcastReplay && { broadcastReplay }),
  };
};

/**
 * Resolve the draft linked to a signing intent without exposing repository
 * ownership to HTTP adapters.
 */
export const findDraftBySigningIntent = (
  walletId: string,
  signingIntentId: string,
) => draftSigningIntentRepository.findDraftByWalletAndSigningIntent(walletId, signingIntentId);
