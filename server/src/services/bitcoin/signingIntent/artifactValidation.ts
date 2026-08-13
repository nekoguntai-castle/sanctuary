import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { InvalidInputError } from '../../../errors/ApiError';
import { finalizeMultisigInput } from '../psbtBuilder/multisigFinalization';
import { parseMultisigScript } from '../psbtBuilder/witnessScript';
import { authenticateIntentPrevouts } from './prevoutValidation';
import { loadSigningIntent } from './service';
import { assertWalletHardwareCapabilityById } from '../../hardwareWalletCapabilities';
import type {
  SigningIntentEnvelope,
  SigningIntentHandle,
  SigningIntentSnapshot,
  SigningIntentSnapshotV2,
} from './types';

bitcoin.initEccLib(ecc);

const validatedArtifactBrand: unique symbol = Symbol('ValidatedBroadcastArtifact');

export interface ValidatedBroadcastArtifact {
  readonly rawTx: string;
  readonly txid: string;
  readonly walletId: string;
  readonly network: SigningIntentSnapshot['network'];
  readonly intent: SigningIntentHandle;
  readonly snapshot: SigningIntentSnapshot;
  readonly actualFeeSats: number;
  readonly vsize: number;
  readonly feeRateSatsPerVbyte: number;
  readonly broadcastReplay?: SigningIntentEnvelope['broadcastReplay'];
  readonly [validatedArtifactBrand]: true;
}

type ValidatedBroadcastArtifactFields = Omit<
  ValidatedBroadcastArtifact,
  typeof validatedArtifactBrand
>;

type ValidatedBroadcastArtifactTestFields = Omit<
  ValidatedBroadcastArtifactFields,
  'actualFeeSats' | 'vsize' | 'feeRateSatsPerVbyte'
> & Partial<Pick<
  ValidatedBroadcastArtifactFields,
  'actualFeeSats' | 'vsize' | 'feeRateSatsPerVbyte'
>>;

const sealValidatedBroadcastArtifact = (
  fields: ValidatedBroadcastArtifactFields,
): ValidatedBroadcastArtifact => Object.freeze({
  ...fields,
  [validatedArtifactBrand]: true as const,
});

/**
 * Test-only constructor for exercising boundaries below signature validation.
 * Production callers must obtain this opaque type from validateSignedArtifact.
 */
export const createValidatedBroadcastArtifactForTest = (
  fields: ValidatedBroadcastArtifactTestFields,
): ValidatedBroadcastArtifact => {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Validated broadcast test artifacts are unavailable outside tests');
  }
  return sealValidatedBroadcastArtifact({
    actualFeeSats: 0,
    vsize: 1,
    feeRateSatsPerVbyte: 0,
    ...fields,
  });
};

export type SignedArtifactInput = SigningIntentHandle & {
  walletId: string;
  signedPsbtBase64?: string;
  rawTxHex?: string;
  draftId?: string;
};

const mismatch = (
  field: string,
  expected: unknown,
  actual: unknown,
): never => {
  throw new InvalidInputError('Signed transaction does not match the authorized intent', field, {
    reason: 'metadata_mismatch',
    expected,
    actual,
  });
};

const parsePsbt = (value: string, field: string): bitcoin.Psbt => {
  try {
    const bytes = Buffer.from(value, 'base64');
    if (bytes.length === 0 || bytes.toString('base64') !== value) throw new Error('non-canonical base64');
    return bitcoin.Psbt.fromBase64(value);
  } catch {
    throw new InvalidInputError('Invalid signed PSBT', field, { reason: 'invalid_psbt' });
  }
};

const parseRawTransaction = (value: string): bitcoin.Transaction => {
  try {
    if (!/^(?:[0-9a-fA-F]{2})+$/.test(value)) throw new Error('non-canonical hex');
    const transaction = bitcoin.Transaction.fromHex(value);
    /* v8 ignore next -- strict even full-hex parsing round-trips by construction in bitcoinjs */
    if (transaction.toHex() !== value.toLowerCase()) throw new Error('non-canonical transaction');
    return transaction;
  } catch {
    throw new InvalidInputError('Invalid raw transaction', 'rawTxHex', {
      reason: 'invalid_raw_transaction',
    });
  }
};

export const assertTransactionMatchesSnapshot = (
  transaction: bitcoin.Transaction,
  snapshot: SigningIntentSnapshot,
): void => {
  const expected = snapshot.transaction;
  if (transaction.version !== expected.version) {
    mismatch('transaction.version', expected.version, transaction.version);
  }
  if (transaction.locktime !== expected.locktime) {
    mismatch('transaction.locktime', expected.locktime, transaction.locktime);
  }
  if (transaction.ins.length !== expected.inputs.length) {
    mismatch('transaction.inputs.length', expected.inputs.length, transaction.ins.length);
  }
  if (transaction.outs.length !== expected.outputs.length) {
    mismatch('transaction.outputs.length', expected.outputs.length, transaction.outs.length);
  }

  expected.inputs.forEach((input, index) => {
    const actual = transaction.ins[index];
    const txid = Buffer.from(actual.hash).reverse().toString('hex');
    if (txid !== input.txid) mismatch(`transaction.inputs.${index}.txid`, input.txid, txid);
    if (actual.index !== input.vout) mismatch(`transaction.inputs.${index}.vout`, input.vout, actual.index);
    if (actual.sequence !== input.sequence) {
      mismatch(`transaction.inputs.${index}.sequence`, input.sequence, actual.sequence);
    }
  });
  expected.outputs.forEach((output, index) => {
    const actual = transaction.outs[index];
    const amount = BigInt(actual.value).toString();
    const script = Buffer.from(actual.script).toString('hex');
    if (amount !== output.amountSats) {
      mismatch(`transaction.outputs.${index}.amountSats`, output.amountSats, amount);
    }
    if (script !== output.scriptPubKeyHex) {
      mismatch(`transaction.outputs.${index}.scriptPubKeyHex`, output.scriptPubKeyHex, script);
    }
  });
};

interface FinalizedFeeMetrics {
  actualFeeSats: number;
  vsize: number;
  feeRateSatsPerVbyte: number;
}

const safeSnapshotSats = (value: string, field: string): bigint => {
  const amount = BigInt(value);
  if (amount < 0n || amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new InvalidInputError('Signing intent fee evidence is invalid', field, {
      reason: 'unknown_input_value',
    });
  }
  return amount;
};

const sumSnapshotSats = (
  values: string[],
  field: 'inputs' | 'outputs',
): bigint => values.reduce(
  (sum, value, index) => sum + safeSnapshotSats(value, `${field}.${index}.amountSats`),
  0n,
);

const calculateAuthenticatedFee = (snapshot: SigningIntentSnapshot): bigint => {
  const inputTotal = sumSnapshotSats(
    snapshot.transaction.inputs.map(input => input.prevout.amountSats),
    'inputs',
  );
  const outputTotal = sumSnapshotSats(
    snapshot.transaction.outputs.map(output => output.amountSats),
    'outputs',
  );
  const fee = inputTotal - outputTotal;
  if (fee < 0n || fee > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new InvalidInputError('Finalized transaction fee is invalid', 'fee', {
      reason: fee < 0n ? 'fee_too_low' : 'fee_too_high',
    });
  }
  return fee;
};

const requireFeePolicy = (snapshot: SigningIntentSnapshot): SigningIntentSnapshotV2['feePolicy'] => {
  if (snapshot.version !== 2) {
    throw new InvalidInputError('Signing intent has no authenticated fee policy', 'intentId', {
      reason: 'stale_intent',
    });
  }
  return snapshot.feePolicy;
};

const feePolicyFailure = (
  reason: 'fee_too_high' | 'fee_too_low',
  actualFeeSats: number,
  expectedFeeSats: number,
  requestedFeeSatsAtFinalVsize: number,
  toleranceSats: number,
): never => {
  throw new InvalidInputError('Finalized transaction fee is outside the authorized policy', 'fee', {
    reason,
    actualFeeSats,
    expectedFeeSats,
    requestedFeeSatsAtFinalVsize,
    roundingToleranceSats: toleranceSats,
  });
};

const validateFinalizedFeePolicy = (
  transaction: bitcoin.Transaction,
  snapshot: SigningIntentSnapshot,
): FinalizedFeeMetrics => {
  const fee = calculateAuthenticatedFee(snapshot);

  const vsize = transaction.virtualSize();
  if (!Number.isSafeInteger(vsize) || vsize <= 0) {
    throw new InvalidInputError('Finalized transaction virtual size is invalid', 'vsize', {
      reason: 'invalid_raw_transaction',
    });
  }

  const policy = requireFeePolicy(snapshot);
  const requestedFeeSatsAtFinalVsize = Math.ceil(policy.requestedFeeRateSatsPerVbyte * vsize);
  if (!Number.isSafeInteger(requestedFeeSatsAtFinalVsize) || requestedFeeSatsAtFinalVsize < 0) {
    throw new InvalidInputError('Authorized fee policy is outside the supported range', 'feePolicy', {
      reason: 'fee_too_high',
    });
  }

  const actualFeeSats = Number(fee);
  const policyDeltaSats = policy.expectedFeeSats - requestedFeeSatsAtFinalVsize;
  if (Math.abs(policyDeltaSats) > policy.roundingToleranceSats) {
    feePolicyFailure(
      policyDeltaSats < 0 ? 'fee_too_low' : 'fee_too_high',
      actualFeeSats,
      policy.expectedFeeSats,
      requestedFeeSatsAtFinalVsize,
      policy.roundingToleranceSats,
    );
  }
  if (actualFeeSats !== policy.expectedFeeSats) {
    feePolicyFailure(
      actualFeeSats < policy.expectedFeeSats ? 'fee_too_low' : 'fee_too_high',
      actualFeeSats,
      policy.expectedFeeSats,
      requestedFeeSatsAtFinalVsize,
      policy.roundingToleranceSats,
    );
  }

  return {
    actualFeeSats,
    vsize,
    feeRateSatsPerVbyte: actualFeeSats / vsize,
  };
};

const legacyReplayFeeMetrics = (
  transaction: bitcoin.Transaction,
  snapshot: SigningIntentSnapshot,
): FinalizedFeeMetrics => {
  const fee = calculateAuthenticatedFee(snapshot);
  const vsize = transaction.virtualSize();
  if (!Number.isSafeInteger(vsize) || vsize <= 0) {
    throw new InvalidInputError('Finalized transaction virtual size is invalid', 'vsize', {
      reason: 'invalid_raw_transaction',
    });
  }
  const actualFeeSats = Number(fee);
  return { actualFeeSats, vsize, feeRateSatsPerVbyte: actualFeeSats / vsize };
};

const normalizePsbtValue = (value: unknown): unknown => {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { bytes: Buffer.from(value).toString('hex') };
  }
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(normalizePsbtValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalizePsbtValue(nested)]),
    );
  }
  return value;
};

const serializedPsbtValue = (value: unknown): string => JSON.stringify(normalizePsbtValue(value));

const SIGNATURE_INPUT_FIELDS = new Set([
  'partialSig',
  'finalScriptSig',
  'finalScriptWitness',
  'tapKeySig',
]);

const immutableInputFields = (input: object): Record<string, unknown> =>
  Object.fromEntries(Object.entries(input).filter(([key]) => !SIGNATURE_INPUT_FIELDS.has(key)));

const isFinalized = (input: bitcoin.Psbt['data']['inputs'][number]): boolean =>
  input.finalScriptSig !== undefined || input.finalScriptWitness !== undefined;

const isP2trScript = (script: Uint8Array | undefined): boolean => (
  Boolean(script && script.length === 34 && script[0] === 0x51 && script[1] === 0x20)
);

const hasTaprootInputFields = (
  input: bitcoin.Psbt['data']['inputs'][number],
): boolean => Boolean(
  input.tapKeySig
  || input.tapBip32Derivation?.length
  || input.tapInternalKey
  || input.tapLeafScript?.length
  || input.tapScriptSig?.length
  || input.tapMerkleRoot
);

const assertTaprootKeyPathInput = (
  input: bitcoin.Psbt['data']['inputs'][number],
  index: number,
): void => {
  if (input.bip32Derivation?.length || input.redeemScript || input.witnessScript
    || input.tapLeafScript?.length || input.tapScriptSig?.length || input.tapMerkleRoot) {
    throw new InvalidInputError('Taproot script-path or mixed metadata is not accepted', `inputs.${index}`, {
      reason: 'unsupported_taproot_script_path',
    });
  }
  const derivations = input.tapBip32Derivation;
  if (!input.tapInternalKey || derivations?.length !== 1) {
    throw new InvalidInputError('Taproot key-path metadata is incomplete', `inputs.${index}`, {
      reason: 'invalid_taproot_key_path',
    });
  }
  // bitcoinjs rejects these invalid BIP371 key lengths while parsing. Keep the
  // explicit check as defense in depth for any future in-memory callers.
  if (input.tapInternalKey.length !== 32 || derivations[0].pubkey.length !== 32) {
    throw new InvalidInputError('Taproot key-path metadata is incomplete', `inputs.${index}`, {
      reason: 'invalid_taproot_key_path',
    });
  }
  if (derivations[0].leafHashes.length !== 0
    || !Buffer.from(derivations[0].pubkey).equals(Buffer.from(input.tapInternalKey))) {
    throw new InvalidInputError('Taproot key-path metadata is incomplete', `inputs.${index}`, {
      reason: 'invalid_taproot_key_path',
    });
  }
};

const assertSignatureFamily = (
  input: bitcoin.Psbt['data']['inputs'][number],
  index: number,
): boolean => {
  const taproot = isP2trScript(input.witnessUtxo?.script);
  if (taproot) {
    assertTaprootKeyPathInput(input, index);
    if (input.partialSig?.length) {
      throw new InvalidInputError('Taproot key-path signatures must use tapKeySig', `inputs.${index}`, {
        reason: 'invalid_taproot_signature_field',
      });
    }
    return Boolean(input.tapKeySig);
  }
  if (hasTaprootInputFields(input)) {
    throw new InvalidInputError('Non-Taproot input contains Taproot fields', `inputs.${index}`, {
      reason: 'mixed_signature_family',
    });
  }
  return Boolean(input.partialSig?.length);
};

const assertImmutableInputMap = (
  original: object,
  candidate: object,
  index: number,
): void => {
  const originalFields = immutableInputFields(original);
  const candidateFields = immutableInputFields(candidate);
  if (serializedPsbtValue(candidateFields) !== serializedPsbtValue(originalFields)) {
    mismatch(`psbt.inputs.${index}`, originalFields, candidateFields);
  }
};

const assertPsbtMapsPreserved = (original: bitcoin.Psbt, candidate: bitcoin.Psbt): void => {
  /* v8 ignore next -- bitcoinjs-lib rejects PSBTs whose map count differs from the unsigned transaction */
  if (candidate.data.inputs.length !== original.data.inputs.length) {
    mismatch('psbt.inputs.length', original.data.inputs.length, candidate.data.inputs.length);
  }
  original.data.inputs.forEach((input, index) => {
    assertImmutableInputMap(input, candidate.data.inputs[index], index);
  });
  if (serializedPsbtValue(candidate.data.outputs) !== serializedPsbtValue(original.data.outputs)) {
    mismatch('psbt.outputs', original.data.outputs, candidate.data.outputs);
  }
  const originalGlobal = { ...original.data.globalMap, unsignedTx: undefined };
  const candidateGlobal = { ...candidate.data.globalMap, unsignedTx: undefined };
  if (serializedPsbtValue(candidateGlobal) !== serializedPsbtValue(originalGlobal)) {
    mismatch('psbt.globalMap', originalGlobal, candidateGlobal);
  }
};

const validatePresentSignatures = (psbt: bitcoin.Psbt, requireEveryInput = true): void => {
  const validator = (pubkey: Uint8Array, hash: Uint8Array, signature: Uint8Array): boolean => {
    /* v8 ignore next -- Schnorr validation activates with the gated Core-accepted P2TR vector */
    if (pubkey.length === 32) return ecc.verifySchnorr(hash, pubkey, signature);
    return ecc.verify(hash, pubkey, signature);
  };
  for (let index = 0; index < psbt.inputCount; index += 1) {
    const input = psbt.data.inputs[index];
    if (isFinalized(input)) {
      throw new InvalidInputError('Pre-finalized PSBT inputs are not accepted', `inputs.${index}`, {
        reason: 'unverifiable_witness',
      });
    }
    const hasSignature = assertSignatureFamily(input, index);
    if (!hasSignature && requireEveryInput) {
      throw new InvalidInputError('Every PSBT input requires verifiable signature evidence', `inputs.${index}`, {
        reason: 'missing_witness_data',
      });
    }
    if (!hasSignature) continue;
    const taprootOutputKey = isP2trScript(input.witnessUtxo?.script)
      ? input.witnessUtxo!.script.subarray(2, 34)
      : undefined;
    if (!psbt.validateSignaturesOfInput(index, validator, taprootOutputKey)) {
      throw new InvalidInputError('PSBT contains an invalid signature', `inputs.${index}`, {
        reason: 'invalid_signature',
      });
    }
  }
};

const finalizePsbt = (candidate: bitcoin.Psbt): bitcoin.Transaction => {
  validatePresentSignatures(candidate);
  try {
    candidate.data.inputs.forEach((input, index) => {
      const parsed = input.witnessScript ? parseMultisigScript(input.witnessScript) : null;
      if (parsed?.isMultisig && input.partialSig?.length) {
        finalizeMultisigInput(candidate, index);
      } else {
        candidate.finalizeInput(index);
      }
    });
    return candidate.extractTransaction();
  } catch {
    throw new InvalidInputError('Signed PSBT is not finalizable', 'signedPsbtBase64', {
      reason: 'not_finalizable',
    });
  }
};

const assertPrevoutsStillMatch = async (
  envelope: SigningIntentEnvelope,
  original: bitcoin.Psbt,
  draftId?: string,
): Promise<void> => {
  const roles = envelope.snapshot.transaction.inputs.map(input => input.prevout.role);
  const authenticated = await authenticateIntentPrevouts(
    envelope.snapshot.walletId,
    envelope.snapshot.network,
    original,
    roles,
    draftId,
    envelope.snapshot.transaction.replacementTxid,
  );
  authenticated.forEach((prevout, index) => {
    const expected = envelope.snapshot.transaction.inputs[index].prevout;
    if (serializedPsbtValue(prevout) !== serializedPsbtValue(expected)) {
      mismatch(`transaction.inputs.${index}.prevout`, expected, prevout);
    }
  });
};

const resolveFinalTransaction = (
  input: SignedArtifactInput,
  envelope: SigningIntentEnvelope,
  originalPsbt: bitcoin.Psbt,
): bitcoin.Transaction => {
  const sourceCount = Number(Boolean(input.signedPsbtBase64)) + Number(Boolean(input.rawTxHex));
  if (sourceCount !== 1) {
    throw new InvalidInputError('Provide exactly one signed artifact', 'signedPsbtBase64', {
      reason: 'missing_witness_data',
    });
  }
  if (input.rawTxHex) {
    // Raw-only hardware responses do not carry enough information to prove the
    // witness against the authorized PSBT. Adapters must return a signed PSBT
    // (or a future device-attested proof) before this boundary can accept them.
    parseRawTransaction(input.rawTxHex);
    throw new InvalidInputError('Raw-only signed artifacts require verifiable adapter proof', 'rawTxHex', {
      reason: 'unverifiable_witness',
    });
  }

  const candidate = parsePsbt(input.signedPsbtBase64!, 'signedPsbtBase64');
  const unsignedCandidate = bitcoin.Transaction.fromBuffer(
    candidate.data.globalMap.unsignedTx.toBuffer(),
  );
  assertTransactionMatchesSnapshot(unsignedCandidate, envelope.snapshot);
  assertPsbtMapsPreserved(originalPsbt, candidate);
  return finalizePsbt(candidate);
};

export const validateSignedArtifact = async (
  input: SignedArtifactInput,
): Promise<ValidatedBroadcastArtifact> => {
  // Reject before parsing externally signed material; finalization is distinct
  // evidence from producing or importing a partial signature.
  await assertWalletHardwareCapabilityById(input.walletId, 'finalize');
  const envelope = await loadSigningIntent(input, input.walletId, {
    allowConsumedBroadcastReplay: true,
  });
  const originalPsbt = parsePsbt(envelope.unsignedPsbtBase64, 'intentId');
  const unsignedOriginal = bitcoin.Transaction.fromBuffer(
    originalPsbt.data.globalMap.unsignedTx.toBuffer(),
  );
  assertTransactionMatchesSnapshot(unsignedOriginal, envelope.snapshot);
  if (!envelope.broadcastReplay) {
    await assertPrevoutsStillMatch(envelope, originalPsbt, input.draftId);
  }
  // Fail before bitcoinjs finalization/extraction can collapse a negative fee
  // into a generic not-finalizable error. Prevouts were authenticated above.
  calculateAuthenticatedFee(envelope.snapshot);
  const transaction = resolveFinalTransaction(input, envelope, originalPsbt);
  assertTransactionMatchesSnapshot(transaction, envelope.snapshot);
  if (envelope.broadcastReplay
    && (transaction.getId() !== envelope.broadcastReplay.txid
      || transaction.toHex() !== envelope.broadcastReplay.rawTx)) {
    mismatch('broadcastReplay', {
      txid: envelope.broadcastReplay.txid,
      rawTx: envelope.broadcastReplay.rawTx,
    }, {
      txid: transaction.getId(),
      rawTx: transaction.toHex(),
    });
  }
  const feeMetrics = envelope.snapshot.version === 1 && envelope.broadcastReplay
    ? legacyReplayFeeMetrics(transaction, envelope.snapshot)
    : validateFinalizedFeePolicy(transaction, envelope.snapshot);

  return sealValidatedBroadcastArtifact({
    rawTx: transaction.toHex(),
    txid: transaction.getId(),
    walletId: input.walletId,
    network: envelope.snapshot.network,
    intent: { intentId: input.intentId, intentDigest: input.intentDigest },
    snapshot: envelope.snapshot,
    ...feeMetrics,
    ...(envelope.broadcastReplay && { broadcastReplay: envelope.broadcastReplay }),
  });
};

export const validatePartialSignedPsbt = async (
  input: SigningIntentHandle & {
    walletId: string;
    signedPsbtBase64: string;
    draftId?: string;
  },
): Promise<void> => {
  // Reject before ingesting any partial signature into the intent workflow.
  await assertWalletHardwareCapabilityById(input.walletId, 'sign');
  const envelope = await loadSigningIntent(input, input.walletId);
  requireFeePolicy(envelope.snapshot);
  const originalPsbt = parsePsbt(envelope.unsignedPsbtBase64, 'intentId');
  const candidate = parsePsbt(input.signedPsbtBase64, 'signedPsbtBase64');
  const unsignedCandidate = bitcoin.Transaction.fromBuffer(
    candidate.data.globalMap.unsignedTx.toBuffer(),
  );
  assertTransactionMatchesSnapshot(unsignedCandidate, envelope.snapshot);
  assertPsbtMapsPreserved(originalPsbt, candidate);
  validatePresentSignatures(candidate, false);
  await assertPrevoutsStillMatch(envelope, originalPsbt, input.draftId);
};
